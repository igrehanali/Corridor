"""Small, dependency-free geometry helpers. Coordinates are (lat, lon) tuples."""

from __future__ import annotations

import math
from bisect import bisect_left
from collections.abc import Sequence

LatLon = tuple[float, float]

EARTH_RADIUS_MI = 3958.7613
METERS_PER_MILE = 1609.344


def haversine_mi(a: LatLon, b: LatLon) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(h)))


def decode_polyline(encoded: str, precision: int = 6) -> list[LatLon]:
    """Decode a Google-style encoded polyline (Valhalla/OSRM use precision 6)."""
    coords: list[LatLon] = []
    index = lat = lon = 0
    factor = 10**precision
    length = len(encoded)
    while index < length:
        for is_lon in (False, True):
            result = shift = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lon:
                lon += delta
            else:
                lat += delta
        coords.append((lat / factor, lon / factor))
    return coords


def cumulative_miles(points: Sequence[LatLon]) -> list[float]:
    out = [0.0]
    for i in range(1, len(points)):
        out.append(out[-1] + haversine_mi(points[i - 1], points[i]))
    return out


def interpolate(xs: Sequence[float], ys: Sequence[float], x: float) -> float:
    """Piecewise-linear y(x) for a non-decreasing ``xs``; clamps at the ends."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = bisect_left(xs, x)
    x0, x1 = xs[i - 1], xs[i]
    if x1 == x0:
        return ys[i]
    t = (x - x0) / (x1 - x0)
    return ys[i - 1] + t * (ys[i] - ys[i - 1])


def point_at_mile(points: Sequence[LatLon], cum: Sequence[float], mile: float) -> LatLon:
    if mile <= 0:
        return points[0]
    if mile >= cum[-1]:
        return points[-1]
    i = bisect_left(cum, mile)
    seg = cum[i] - cum[i - 1]
    t = 0.0 if seg == 0 else (mile - cum[i - 1]) / seg
    (a_lat, a_lon), (b_lat, b_lon) = points[i - 1], points[i]
    return (a_lat + t * (b_lat - a_lat), a_lon + t * (b_lon - a_lon))


def bearing_deg(a: LatLon, b: LatLon) -> float:
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlon = math.radians(b[1] - a[1])
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def destination(origin: LatLon, bearing: float, distance_mi: float) -> LatLon:
    lat1, lon1 = map(math.radians, origin)
    brg = math.radians(bearing)
    d = distance_mi / EARTH_RADIUS_MI
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(brg))
    lon2 = lon1 + math.atan2(
        math.sin(brg) * math.sin(d) * math.cos(lat1), math.cos(d) - math.sin(lat1) * math.sin(lat2)
    )
    return (math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180)


def simplify_indices(points: Sequence[LatLon], tolerance_deg: float) -> list[int]:
    """Douglas–Peucker; returns the indices of kept vertices (first and last always kept).

    Returning indices (not points) lets callers carry parallel arrays such as
    cumulative miles and times through the simplification.
    """
    n = len(points)
    if n <= 2:
        return list(range(n))
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    tol2 = tolerance_deg * tolerance_deg
    while stack:
        start, end = stack.pop()
        (ay, ax), (by, bx) = points[start], points[end]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        max_d2, max_i = -1.0, -1
        for i in range(start + 1, end):
            py, px = points[i]
            if seg2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                d2 = (ax + t * dx - px) ** 2 + (ay + t * dy - py) ** 2
            if d2 > max_d2:
                max_d2, max_i = d2, i
        if max_d2 > tol2:
            keep[max_i] = True
            stack.append((start, max_i))
            stack.append((max_i, end))
    return [i for i, k in enumerate(keep) if k]


def resample(points: Sequence[LatLon], cum: Sequence[float], step_mi: float) -> list[LatLon]:
    """Points every ``step_mi`` along the line, always including both ends."""
    total = cum[-1]
    out = [point_at_mile(points, cum, m * step_mi) for m in range(int(total // step_mi) + 1)]
    if not out or out[-1] != points[-1]:
        out.append(points[-1])
    return out
