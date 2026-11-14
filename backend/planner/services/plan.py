"""Trip planning: routes → checkpoints → weather → risk → recommendation → heatmap.

``build_plan`` is the only entry point the API calls. It returns a plain dict
shaped for the frontend (see ``frontend/src/lib/types.ts``).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from ..domain.checkpoints import CheckpointPlan, plan_checkpoints
from ..domain.corridor import CorridorGrid, build_corridor_grid
from ..domain.geo import LatLon, interpolate, point_at_mile, simplify_indices
from ..domain.hos import elapsed_for_drive, rest_stops
from ..domain.ranking import RouteScore, recommend
from ..domain.risk import RiskLevel, assess, risk_level
from ..domain.route import Route
from ..domain.weather import HourlySeries, floor_hour, window
from ..providers.geocoding import Place
from ..providers.weather import fetch_series, snap
from .routes import generate_routes

log = logging.getLogger(__name__)

HEATMAP_HOURS = 48
ROUTE_IDS = ("A", "B", "C")
GEOMETRY_TOLERANCE_DEG = 0.0006  # ≈ 60 m; invisible at highway zoom levels


@dataclass(frozen=True, slots=True)
class PlanRequest:
    origin: Place
    destination: Place
    departure: datetime  # timezone-aware
    load_lb: float
    interval_mi: int
    hos: bool = True


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def build_plan(req: PlanRequest) -> dict:
    t0 = time.perf_counter()
    origin: LatLon = (req.origin.lat, req.origin.lon)
    dest: LatLon = (req.destination.lat, req.destination.lon)
    routes, route_warnings = generate_routes(origin, dest, req.load_lb)
    warnings = list(route_warnings)
    t_routes = time.perf_counter()

    checkpoints = {
        rid: plan_checkpoints(r, req.interval_mi, req.hos) for rid, r in zip(ROUTE_IDS, routes, strict=False)
    }
    longest_h = max(cps[-1].elapsed_s for cps in checkpoints.values()) / 3600
    grid = build_corridor_grid([r.points for r in routes])
    start, hours = window(req.departure, max(HEATMAP_HOURS + 1, longest_h))

    cp_points = {snap((cp.lat, cp.lon)) for cps in checkpoints.values() for cp in cps}
    grid_points = [grid.center(c) for c in grid.cells]
    series = fetch_series([*cp_points, *grid_points], start, hours)
    t_weather = time.perf_counter()

    routes_out = []
    scores = []
    for rid, route in zip(ROUTE_IDS, routes, strict=False):
        out, score = _route_payload(rid, route, checkpoints[rid], series, req)
        routes_out.append(out)
        scores.append(score)
    _disambiguate_names(routes_out)
    rec = recommend(scores)
    for r in routes_out:
        r["rank"] = rec.order.index(r["id"]) + 1
        r["recommended"] = r["id"] == rec.route_id

    if all(r["summary"]["miles_by_level"]["no_travel"] > 0 for r in routes_out):
        warnings.append(
            "Every route crosses No Travel conditions at this departure time. Use the forecast slider to "
            "find a safer window, or delay departure."
        )

    heatmap = _heatmap_payload(grid, series, start, req)
    t_done = time.perf_counter()
    log.info(
        "plan %s→%s: routes %.2fs, weather %.2fs, compute %.2fs, %d weather points",
        req.origin.label,
        req.destination.label,
        t_routes - t0,
        t_weather - t_routes,
        t_done - t_weather,
        len(cp_points) + len(grid_points),
    )
    return {
        "request": {
            "origin": _place(req.origin),
            "destination": _place(req.destination),
            "departure": _iso(req.departure),
            "load_lb": req.load_lb,
            "interval_mi": req.interval_mi,
            "hos": req.hos,
        },
        "generated_at": _iso(datetime.now(UTC)),
        "routes": sorted(routes_out, key=lambda r: r["id"]),
        "recommendation": {
            "route_id": rec.route_id,
            "order": rec.order,
            "decided_by": rec.decided_by,
            "reason": rec.reason,
        },
        "heatmap": heatmap,
        "warnings": warnings,
        "timing_ms": {
            "routing": round((t_routes - t0) * 1000),
            "weather": round((t_weather - t_routes) * 1000),
            "compute": round((t_done - t_weather) * 1000),
        },
    }


def _place(p: Place) -> dict:
    return {"label": p.label, "lat": p.lat, "lon": p.lon}


def _disambiguate_names(routes_out: list[dict]) -> None:
    names = [r["name"] for r in routes_out]
    for r in routes_out:
        if names.count(r["name"]) > 1 and len(r["roads"]) > 2:
            r["name"] = " · ".join(r["roads"][:3])


def _route_payload(
    rid: str,
    route: Route,
    cps: list[CheckpointPlan],
    series: dict[LatLon, HourlySeries],
    req: PlanRequest,
) -> tuple[dict, RouteScore]:
    miles = {lvl: 0.0 for lvl in RiskLevel}
    weighted = 0.0
    cp_out = []
    for cp in cps:
        eta = req.departure + timedelta(seconds=cp.elapsed_s)
        cond = series[snap((cp.lat, cp.lon))].at(eta)
        a = assess(cond, req.load_lb)
        miles[a.level] += cp.segment_mi
        weighted += int(a.level) * cp.segment_mi
        cp_out.append(
            {
                "i": cp.index,
                "mile": round(cp.mile, 1),
                "lat": round(cp.lat, 5),
                "lon": round(cp.lon, 5),
                "eta": _iso(eta),
                "elapsed_s": round(cp.elapsed_s),
                "segment_mi": round(cp.segment_mi, 2),
                "wind_mph": round(cond.wind_mph, 1),
                "gust_mph": round(cond.gust_mph, 1),
                "rain_in_hr": round(cond.rain_in_hr, 3),
                "snow_in_hr": round(cond.snow_in_hr, 3),
                "risk": a.level.key,
                "factors": {"wind": a.wind.key, "rain": a.rain.key, "snow": a.snow.key},
                "load_escalated": a.load_escalated,
                "reason": a.reason,
            }
        )
    total = route.distance_mi
    trip_s = cps[-1].elapsed_s
    avg = weighted / total if total else 0.0
    worst = max((RiskLevel[c["risk"].upper()] for c in cp_out), default=RiskLevel.LOW)

    keep = simplify_indices(route.points, GEOMETRY_TOLERANCE_DEG)
    stops = rest_stops(route.drive_time_s, req.hos)
    timeline = [[round(elapsed_for_drive(route.cum_drive_s[i], req.hos)), round(route.cum_miles[i], 2)] for i in keep]
    stops_out = []
    for s in stops:
        mile = interpolate(route.cum_drive_s, route.cum_miles, s.drive_s)
        lat, lon = _point(route, mile)
        timeline += [[round(s.start_s), round(mile, 2)], [round(s.start_s + s.duration_s), round(mile, 2)]]
        stops_out.append(
            {
                "kind": s.kind,
                "mile": round(mile, 1),
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "start": _iso(req.departure + timedelta(seconds=s.start_s)),
                "duration_min": round(s.duration_s / 60),
            }
        )
    timeline.sort(key=lambda p: (p[0], p[1]))

    out = {
        "id": rid,
        "name": route.label(),
        "roads": route.roads,
        "provider": route.provider,
        "profile": route.profile,
        "geometry": [[round(route.points[i][1], 5), round(route.points[i][0], 5)] for i in keep],
        "geometry_miles": [round(route.cum_miles[i], 2) for i in keep],
        "timeline": timeline,
        "checkpoints": cp_out,
        "rest_stops": stops_out,
        "summary": {
            "distance_mi": round(total, 1),
            "drive_time_s": round(route.drive_time_s),
            "trip_time_s": round(trip_s),
            "arrival": _iso(req.departure + timedelta(seconds=trip_s)),
            "miles_by_level": {lvl.key: round(m, 1) for lvl, m in miles.items()},
            "avg_risk": round(avg, 3),
            "max_risk": worst.key,
            "checkpoint_count": len(cp_out),
        },
    }
    score = RouteScore(
        route_id=rid,
        name=f"Route {rid}",
        no_travel_mi=miles[RiskLevel.NO_TRAVEL],
        severe_mi=miles[RiskLevel.SEVERE],
        high_mi=miles[RiskLevel.HIGH],
        avg_risk=avg,
        trip_time_s=trip_s,
    )
    return out, score


def _point(route: Route, mile: float) -> LatLon:
    return point_at_mile(route.points, route.cum_miles, mile)


def _heatmap_payload(grid: CorridorGrid, series: dict[LatLon, HourlySeries], start: datetime, req: PlanRequest) -> dict:
    """Cell-major flat arrays: value for (cell c, hour h) is at ``c * hours + h``."""
    first = floor_hour(req.departure)
    offset = int((first - start).total_seconds() // 3600)
    hours = HEATMAP_HOURS + 1  # 0 … 48 inclusive
    risk: list[int] = []
    wind: list[int] = []
    rain: list[int] = []
    snow: list[int] = []
    for cell in grid.cells:
        s = series[grid.center(cell)]
        for h in range(hours):
            c = s.hour_conditions(offset + h)
            risk.append(int(risk_level(c, req.load_lb)))
            wind.append(round(c.wind_mph))
            rain.append(round(c.rain_in_hr * 100))
            snow.append(round(c.snow_in_hr * 100))
    return {
        "start": _iso(first),
        "hours": hours,
        "step_deg": grid.step,
        "nx": grid.nx,
        "ny": grid.ny,
        "bounds": grid.bounds,
        "cells": [list(c) for c in grid.cells],
        "risk": risk,
        "wind_mph": wind,
        "rain_hundredths": rain,
        "snow_hundredths": snow,
    }
