"""Produce three meaningfully different candidate routes.

Routing APIs return "alternates" only when good ones exist — often 0 or 1. To
always offer the driver three real choices we:

1. ask the provider for its own alternates;
2. if still short, route through *via points* offset perpendicular to the trip
   at its midpoint (left and right, at growing distances);
3. keep a candidate only if it is genuinely different (shares < 80 % of its
   road cells with every accepted route), is not an absurd detour (≤ 1.5× the
   fastest drive time), and does not "spur" into the via point and back out.
"""

from __future__ import annotations

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor

from django.core.cache import cache

from ..domain.geo import (
    LatLon,
    bearing_deg,
    destination,
    haversine_mi,
    point_at_mile,
    resample,
)
from ..domain.route import Route
from ..providers.http import UpstreamError
from ..providers.routing import NoRouteFound, OsrmProvider, RouteTooLong, RoutingProvider, ValhallaProvider

log = logging.getLogger(__name__)

TARGET = 3
MAX_DETOUR = 1.5
MAX_OVERLAP = 0.8
SIGNATURE_DEG = 0.02  # ≈1.4 mi cells for overlap comparison
VIA_FRACTIONS = (0.18, 0.32, 0.5)  # of the straight-line trip distance
CACHE_TTL_S = 60 * 60


def _signature(route: Route) -> frozenset[tuple[int, int]]:
    pts = resample(route.points, route.cum_miles, 1.0)
    return frozenset((round(lat / SIGNATURE_DEG), round(lon / SIGNATURE_DEG)) for lat, lon in pts)


def _overlap(a: frozenset, b: frozenset) -> float:
    return len(a & b) / max(1, min(len(a), len(b)))


def _has_spur(route: Route, via: LatLon) -> bool:
    """True if the route drives into the via point and back out the same way."""
    nearest = min(range(len(route.points)), key=lambda i: haversine_mi(route.points[i], via))
    m = route.cum_miles[nearest]
    before = point_at_mile(route.points, route.cum_miles, m - 4)
    after = point_at_mile(route.points, route.cum_miles, m + 4)
    return haversine_mi(before, after) < 1.5


def _via_candidates(base: Route, origin: LatLon, dest: LatLon) -> list[list[LatLon]]:
    """Batches of via points (left/right pairs), nearest offsets first."""
    crow = haversine_mi(origin, dest)
    mid = point_at_mile(base.points, base.cum_miles, base.distance_mi / 2)
    brg = bearing_deg(origin, dest)
    batches = []
    for frac in VIA_FRACTIONS:
        dist = min(max(frac * crow, 15.0), 250.0)
        batches.append([destination(mid, (brg + side) % 360, dist) for side in (90, 270)])
    return batches


class _Accepted:
    def __init__(self) -> None:
        self.routes: list[Route] = []
        self.sigs: list[frozenset] = []

    def offer(self, route: Route) -> bool:
        if self.routes and route.drive_time_s > MAX_DETOUR * min(r.drive_time_s for r in self.routes):
            return False
        sig = _signature(route)
        if any(_overlap(sig, s) >= MAX_OVERLAP for s in self.sigs):
            return False
        self.routes.append(route)
        self.sigs.append(sig)
        return True


def _primary(origin: LatLon, dest: LatLon, load_lb: float) -> tuple[RoutingProvider, list[Route], list[str]]:
    truck = ValhallaProvider()
    try:
        return truck, truck.routes(origin, dest, load_lb=load_lb, alternates=2), []
    except NoRouteFound:
        raise
    except RouteTooLong:
        note = (
            "Long-haul trip: beyond the free truck router's 930-mile limit, routes come from a car router "
            "with segment speeds capped at truck speed. Truck-specific restrictions are not applied."
        )
    except UpstreamError as exc:
        log.warning("Valhalla failed (%s); falling back to OSRM", exc)
        note = "The truck router was unavailable, so routes come from a car router capped at truck speed."
    car = OsrmProvider()
    return car, car.routes(origin, dest, load_lb=load_lb, alternates=2), [note]


def generate_routes(origin: LatLon, dest: LatLon, load_lb: float) -> tuple[list[Route], list[str]]:
    key = (
        "routes:"
        + hashlib.sha1(
            f"{origin[0]:.5f},{origin[1]:.5f}|{dest[0]:.5f},{dest[1]:.5f}|{round(load_lb, -3)}".encode()
        ).hexdigest()
    )
    if (hit := cache.get(key)) is not None:
        return hit

    if haversine_mi(origin, dest) < 1:
        raise NoRouteFound("Origin and destination are the same place.", code="same_place")

    provider, candidates, warnings = _primary(origin, dest, load_lb)
    accepted = _Accepted()
    for r in sorted(candidates, key=lambda r: r.drive_time_s):
        accepted.offer(r)

    if len(accepted.routes) < TARGET:
        base = accepted.routes[0]
        for batch in _via_candidates(base, origin, dest):
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda via: _try_via(provider, origin, dest, via, load_lb), batch))
            for via, route in zip(batch, results, strict=True):
                if route and not _has_spur(route, via):
                    accepted.offer(route)
                if len(accepted.routes) >= TARGET:
                    break
            if len(accepted.routes) >= TARGET:
                break

    routes = sorted(accepted.routes, key=lambda r: r.drive_time_s)[:TARGET]
    if len(routes) < TARGET:
        warnings.append(
            f"Only {len(routes)} distinct route{'s' if len(routes) != 1 else ''} exist between these points "
            "without a long detour."
        )
    result = (routes, warnings)
    cache.set(key, result, CACHE_TTL_S)
    return result


def _try_via(provider: RoutingProvider, origin: LatLon, dest: LatLon, via: LatLon, load_lb: float) -> Route | None:
    try:
        found = provider.routes(origin, dest, load_lb=load_lb, via=via)
    except UpstreamError as exc:
        log.info("via %s rejected: %s", via, exc)
        return None
    return found[0] if found else None
