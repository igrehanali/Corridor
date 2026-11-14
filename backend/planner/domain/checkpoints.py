"""Place weather checkpoints along a route and give each its ETA."""

from __future__ import annotations

from dataclasses import dataclass

from .geo import interpolate, point_at_mile
from .hos import elapsed_for_drive
from .route import Route

ALLOWED_INTERVALS = (10, 25, 50)


@dataclass(frozen=True, slots=True)
class CheckpointPlan:
    index: int
    mile: float
    lat: float
    lon: float
    drive_s: float
    elapsed_s: float
    # Route miles this checkpoint stands for: half the gap to each neighbour.
    # Summed over all checkpoints this equals the route length exactly.
    segment_mi: float


def checkpoint_miles(total_mi: float, interval_mi: float) -> list[float]:
    """0, N, 2N, … plus the destination."""
    if interval_mi <= 0:
        raise ValueError("interval must be positive")
    miles: list[float] = []
    m = 0.0
    # Skip a regular checkpoint that would sit within 0.05 mi of the
    # destination, so we never sample the same place twice.
    while m < total_mi - 0.05:
        miles.append(m)
        m += interval_mi
    miles.append(total_mi)
    return miles


def plan_checkpoints(route: Route, interval_mi: float, hos: bool) -> list[CheckpointPlan]:
    miles = checkpoint_miles(route.distance_mi, interval_mi)
    out: list[CheckpointPlan] = []
    last = len(miles) - 1
    for i, mile in enumerate(miles):
        left = (mile - miles[i - 1]) / 2 if i > 0 else 0.0
        right = (miles[i + 1] - mile) / 2 if i < last else 0.0
        lat, lon = point_at_mile(route.points, route.cum_miles, mile)
        drive_s = interpolate(route.cum_miles, route.cum_drive_s, mile)
        out.append(
            CheckpointPlan(
                index=i,
                mile=mile,
                lat=lat,
                lon=lon,
                drive_s=drive_s,
                elapsed_s=elapsed_for_drive(drive_s, hos),
                segment_mi=left + right,
            )
        )
    return out
