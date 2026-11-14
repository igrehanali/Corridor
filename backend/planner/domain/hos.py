"""Hours-of-service (HOS) model for property-carrying drivers.

A simplified, deterministic version of the US FMCSA rules that matter for an
ETA: a 30-minute break after 8 hours of driving, and a 10-hour off-duty rest
after 11 hours of driving (which also resets the 8-hour break clock).

The 14-hour on-duty window and the 60/70-hour weekly limits are not modelled;
with breaks taken exactly at the limits, 11 h driving + 0.5 h break never
exceeds the 14-hour window.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

HOUR = 3600.0
BREAK_AFTER_S = 8 * HOUR
BREAK_S = 0.5 * HOUR
DRIVE_LIMIT_S = 11 * HOUR
OFF_DUTY_S = 10 * HOUR


def elapsed_for_drive(drive_s: float, enabled: bool = True) -> float:
    """Wall-clock seconds since departure when the truck has driven ``drive_s``.

    A rest is added only once driving *continues past* a limit, so a point
    reached at exactly 11 h of driving has no trailing rest.
    """
    if not enabled or drive_s <= 0:
        return max(drive_s, 0.0)
    cycles = math.ceil(drive_s / DRIVE_LIMIT_S) - 1  # completed 11 h cycles before this point
    remainder = drive_s - cycles * DRIVE_LIMIT_S
    rest = cycles * (BREAK_S + OFF_DUTY_S)
    if remainder > BREAK_AFTER_S:
        rest += BREAK_S
    return drive_s + rest


@dataclass(frozen=True, slots=True)
class RestStop:
    kind: str  # "break" | "off_duty"
    drive_s: float  # driving time at which the stop starts
    start_s: float  # elapsed seconds since departure when it starts
    duration_s: float


def rest_stops(total_drive_s: float, enabled: bool = True) -> list[RestStop]:
    if not enabled:
        return []
    stops: list[RestStop] = []
    cycle = 0
    while True:
        base = cycle * DRIVE_LIMIT_S
        for kind, at, dur in (
            ("break", base + BREAK_AFTER_S, BREAK_S),
            ("off_duty", base + DRIVE_LIMIT_S, OFF_DUTY_S),
        ):
            if at >= total_drive_s:
                return stops
            stops.append(RestStop(kind, at, elapsed_for_drive(at), dur))
        cycle += 1
