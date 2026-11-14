from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field

from .geo import LatLon, cumulative_miles


@dataclass(slots=True)
class Route:
    """A drivable path with the drive time to reach every vertex.

    ``cum_drive_s`` is pure driving time from the routing provider (no rest
    breaks); hours-of-service breaks are layered on separately in ``hos``.
    """

    points: list[LatLon]
    cum_drive_s: list[float]
    roads: list[str]
    provider: str
    profile: str
    cum_miles: list[float] = field(default_factory=list)

    def __post_init__(self) -> None:
        if len(self.points) < 2:
            raise ValueError("A route needs at least two points")
        if len(self.points) != len(self.cum_drive_s):
            raise ValueError("points and cum_drive_s must be the same length")
        if not self.cum_miles:
            self.cum_miles = cumulative_miles(self.points)

    @property
    def distance_mi(self) -> float:
        return self.cum_miles[-1]

    @property
    def drive_time_s(self) -> float:
        return self.cum_drive_s[-1]

    def label(self) -> str:
        return " · ".join(self.roads[:2]) if self.roads else "Local roads"


_HIGHWAY = re.compile(r"^(I|US|SR|CA|TX|[A-Z]{2})[- ]?\d+[A-Z]?\b")
_INTERSTATE_SPACE = re.compile(r"^(I|US|SR)\s+(\d+[A-Z]?)\b")


def normalize_road(name: str) -> str:
    name = name.strip()
    name = _INTERSTATE_SPACE.sub(lambda m: f"{m.group(1)}-{m.group(2)}", name)
    # Drop direction suffixes like "I-25 North" so segments aggregate together.
    return re.sub(r"\s+(North|South|East|West|N|S|E|W)$", "", name)


def major_roads(segments: Iterable[tuple[str, float]], limit: int = 3) -> list[str]:
    """Rank road names by miles driven on them, preferring numbered highways."""
    totals: dict[str, float] = defaultdict(float)
    for name, miles in segments:
        if name:
            totals[normalize_road(name)] += miles
    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    highways = [n for n, _ in ranked if _HIGHWAY.match(n)]
    others = [n for n, _ in ranked if not _HIGHWAY.match(n)]
    return (highways + others)[:limit]
