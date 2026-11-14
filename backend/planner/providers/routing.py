"""Routing providers.

* Valhalla (truck costing) is primary: it knows truck restrictions and takes the
  gross vehicle weight. The public FOSSGIS server caps routes at 1,500 km.
* OSRM (car profile) is the long-haul fallback. Its per-segment durations are
  re-timed with a truck speed cap so ETAs stay realistic.

Both return :class:`~planner.domain.route.Route` with drive time per vertex,
which is what makes checkpoint ETAs accurate (a truck slows through cities and
climbs; a constant-speed assumption would place weather lookups at the wrong hour).
"""

from __future__ import annotations

import logging
from typing import Protocol

import requests
from django.conf import settings

from ..domain.geo import METERS_PER_MILE, LatLon, cumulative_miles, decode_polyline
from ..domain.route import Route, major_roads
from .http import UpstreamError, UpstreamRateLimited, session, timeout

log = logging.getLogger(__name__)

LB_PER_METRIC_TON = 2204.62


class RouteTooLong(UpstreamError):
    pass


class NoRouteFound(UpstreamError):
    status_code = 422


class RoutingProvider(Protocol):
    name: str
    supports_alternates: bool

    def routes(
        self, origin: LatLon, destination: LatLon, *, load_lb: float, via: LatLon | None = None, alternates: int = 0
    ) -> list[Route]: ...


def _check_response(resp: requests.Response, provider: str) -> dict:
    if resp.status_code == 429:
        raise UpstreamRateLimited(
            f"The {provider} routing service is busy. Please retry in a minute.", code="routing_rate_limited"
        )
    try:
        data = resp.json()
    except ValueError as exc:
        raise UpstreamError(
            f"The {provider} routing service returned an invalid response.", code="routing_failed"
        ) from exc
    return data


class ValhallaProvider:
    name = "valhalla"
    supports_alternates = True

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.PLANNER["VALHALLA_URL"]).rstrip("/")

    def routes(self, origin, destination, *, load_lb, via=None, alternates=0):
        gross_lb = load_lb + settings.PLANNER["TRUCK_TARE_LB"]
        locations = [{"lat": origin[0], "lon": origin[1], "type": "break"}]
        if via:
            locations.append({"lat": via[0], "lon": via[1], "type": "through"})
        locations.append({"lat": destination[0], "lon": destination[1], "type": "break"})
        payload = {
            "locations": locations,
            "costing": "truck",
            "costing_options": {"truck": {"weight": round(gross_lb / LB_PER_METRIC_TON, 2)}},
            "units": "miles",
            "directions_options": {"units": "miles"},
        }
        if alternates and not via:
            payload["alternates"] = alternates
        try:
            resp = session().post(f"{self.base_url}/route", json=payload, timeout=timeout())
        except requests.RequestException as exc:
            raise UpstreamError("Couldn't reach the routing service.", code="routing_unreachable") from exc
        data = _check_response(resp, "Valhalla")
        if "trip" not in data:
            code = data.get("error_code")
            message = data.get("error", "Unknown routing error")
            if code == 154:
                raise RouteTooLong("Route exceeds the truck router's distance limit.", code="route_too_long")
            if code in (170, 171, 442, 443):
                raise NoRouteFound("No drivable truck route connects these locations.", code="no_route", detail=message)
            raise UpstreamError("The routing service couldn't plan this trip.", code="routing_failed", detail=message)
        trips = [data["trip"]] + [alt["trip"] for alt in data.get("alternates", [])]
        return [self._parse(t) for t in trips]

    def _parse(self, trip: dict) -> Route:
        points: list[LatLon] = []
        cum_drive: list[float] = []
        road_segments: list[tuple[str, float]] = []
        t0 = 0.0
        for leg in trip["legs"]:
            shape = decode_polyline(leg["shape"], 6)
            leg_cum_mi = cumulative_miles(shape)
            leg_time = [0.0] * len(shape)
            for m in leg["maneuvers"]:
                b, e = m["begin_shape_index"], m["end_shape_index"]
                road_segments.append(((m.get("street_names") or [""])[0], m.get("length", 0.0)))
                span = leg_cum_mi[e] - leg_cum_mi[b]
                base = leg_time[b]
                for i in range(b + 1, e + 1):
                    frac = (leg_cum_mi[i] - leg_cum_mi[b]) / span if span > 0 else (i - b) / max(e - b, 1)
                    leg_time[i] = base + m.get("time", 0.0) * frac
            # Legs share their joining vertex; skip the duplicate.
            skip = 1 if points else 0
            points.extend(shape[skip:])
            cum_drive.extend(t0 + t for t in leg_time[skip:])
            t0 = cum_drive[-1]
        return Route(
            points=points,
            cum_drive_s=cum_drive,
            roads=major_roads(road_segments),
            provider=self.name,
            profile="truck",
        )


class OsrmProvider:
    name = "osrm"
    supports_alternates = True

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.PLANNER["OSRM_URL"]).rstrip("/")
        self.max_mps = settings.PLANNER["TRUCK_MAX_MPH"] * METERS_PER_MILE / 3600

    def routes(self, origin, destination, *, load_lb, via=None, alternates=0):
        coords = [origin] + ([via] if via else []) + [destination]
        path = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in coords)
        params = {
            "overview": "full",
            "geometries": "polyline6",
            "annotations": "distance,duration",
            "steps": "true",
            "continue_straight": "true",
        }
        if alternates and not via:
            params["alternatives"] = str(alternates + 1)
        try:
            resp = session().get(f"{self.base_url}/route/v1/driving/{path}", params=params, timeout=timeout())
        except requests.RequestException as exc:
            raise UpstreamError("Couldn't reach the routing service.", code="routing_unreachable") from exc
        data = _check_response(resp, "OSRM")
        if data.get("code") != "Ok":
            if data.get("code") in ("NoRoute", "NoSegment"):
                raise NoRouteFound("No drivable route connects these locations.", code="no_route")
            raise UpstreamError(
                "The routing service couldn't plan this trip.", code="routing_failed", detail=str(data.get("message"))
            )
        return [self._parse(r) for r in data["routes"]]

    def _parse(self, r: dict) -> Route:
        points = decode_polyline(r["geometry"], 6)
        durations: list[float] = []
        road_segments: list[tuple[str, float]] = []
        for leg in r["legs"]:
            ann = leg["annotation"]
            for dist_m, dur in zip(ann["distance"], ann["duration"], strict=True):
                # Car speeds → truck speeds: never faster than the truck cap.
                durations.append(max(dur, dist_m / self.max_mps))
            for step in leg.get("steps", []):
                name = step.get("ref") or step.get("name") or ""
                road_segments.append((name.split(";")[0], step.get("distance", 0) / METERS_PER_MILE))
        # Geometry is the concatenation of legs, which share joining vertices,
        # so there is exactly one duration per consecutive pair of points.
        if len(durations) != len(points) - 1:
            log.warning("OSRM annotation/geometry mismatch: %s vs %s", len(durations), len(points) - 1)
            durations = (durations + [0.0] * len(points))[: len(points) - 1]
        cum = [0.0]
        for d in durations:
            cum.append(cum[-1] + d)
        return Route(
            points=points,
            cum_drive_s=cum,
            roads=major_roads(road_segments),
            provider=self.name,
            profile="car, truck-speed capped",
        )
