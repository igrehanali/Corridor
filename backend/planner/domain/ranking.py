"""Route recommendation.

The brief's preference order, as a lexicographic sort key:

  0. Fewest No Travel miles   (not in the brief's list; a route the rules say
                               must not be driven can never beat one that can)
  1. Fewest Severe miles
  2. Fewest High miles
  3. Lowest average risk      (miles-weighted, Low=0 … No Travel=4)
  4. Shortest travel time     (door to door, including HOS rest if enabled)

Miles are compared at 0.1 mi and average risk at 0.01 so float noise cannot
decide a recommendation.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RouteScore:
    route_id: str
    name: str
    no_travel_mi: float
    severe_mi: float
    high_mi: float
    avg_risk: float
    trip_time_s: float

    def key(self) -> tuple[float, float, float, float, float]:
        return (
            round(self.no_travel_mi, 1),
            round(self.severe_mi, 1),
            round(self.high_mi, 1),
            round(self.avg_risk, 2),
            round(self.trip_time_s),
        )


CRITERIA = ("no_travel", "severe", "high", "avg_risk", "time")


@dataclass(frozen=True, slots=True)
class Recommendation:
    order: list[str]  # route ids, best first
    route_id: str
    decided_by: str | None  # criterion behind ``reason``; None if only one route
    reason: str


def recommend(scores: list[RouteScore]) -> Recommendation:
    if not scores:
        raise ValueError("No routes to rank")
    ranked = sorted(scores, key=RouteScore.key)
    best = ranked[0]
    if len(ranked) == 1:
        return Recommendation([best.route_id], best.route_id, None, "Only route available")
    # Drivers default to the fastest route, so when we recommend something else
    # the useful explanation is "why not the fastest?". Otherwise explain why
    # the winner beats the runner-up.
    fastest = min(scores, key=lambda s: round(s.trip_time_s))
    other = fastest if fastest.route_id != best.route_id else ranked[1]
    criterion, reason = _explain(best, other)
    return Recommendation([s.route_id for s in ranked], best.route_id, criterion, reason)


def _fmt_mi(v: float) -> str:
    return f"{v:,.0f} mi" if v >= 10 else f"{v:,.1f} mi"


def _fmt_duration(seconds: float) -> str:
    minutes = round(seconds / 60)
    h, m = divmod(minutes, 60)
    if h and m:
        return f"{h} h {m} min"
    return f"{h} h" if h else f"{m} min"


def _explain(best: RouteScore, other: RouteScore) -> tuple[str, str]:
    a, b = best.key(), other.key()
    vs = f"than {other.name}"
    if a[0] != b[0]:
        if a[0] == 0:
            return "no_travel", f"Avoids the No Travel conditions on {other.name}"
        return "no_travel", f"{_fmt_mi(b[0] - a[0])} less No Travel exposure {vs}"
    if a[1] != b[1]:
        return "severe", f"{_fmt_mi(b[1] - a[1])} fewer severe-weather miles {vs}"
    if a[2] != b[2]:
        prefix = "Same severe exposure; " if a[1] == 0 else "Equal severe miles; "
        return "high", f"{prefix}{_fmt_mi(b[2] - a[2])} fewer high-risk miles {vs}"
    if a[3] != b[3]:
        return "avg_risk", f"Lower average weather risk ({a[3]:.2f} vs {b[3]:.2f}) {vs}"
    if a[4] != b[4]:
        return "time", f"Same weather risk; {_fmt_duration(b[4] - a[4])} faster {vs}"
    return "time", f"Identical risk and time to {other.name}"
