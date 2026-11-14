"""Time lookup into an hourly forecast series.

Open-Meteo semantics: wind is an instantaneous value at the timestamp;
precipitation (rain, snowfall) is the total over the *preceding* hour. So the
precipitation rate a truck experiences at 14:20 is the value stamped 15:00 —
the hour that contains the ETA.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from .risk import Conditions


def floor_hour(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


@dataclass(frozen=True, slots=True)
class HourlySeries:
    start: datetime  # UTC, on the hour; index 0
    wind: tuple[float, ...]
    gust: tuple[float, ...]
    rain: tuple[float, ...]  # liquid precipitation (rain + showers), in/hr
    snow: tuple[float, ...]  # snowfall, in/hr

    def __len__(self) -> int:
        return len(self.wind)

    def _clamp(self, i: int) -> int:
        return max(0, min(len(self) - 1, i))

    def at(self, when: datetime) -> Conditions:
        x = (when - self.start).total_seconds() / 3600
        lo = self._clamp(math.floor(x))
        hi = self._clamp(math.ceil(x))
        t = 0.0 if hi == lo else x - math.floor(x)
        precip_i = hi  # the hour-ending stamp that contains ``when``
        return Conditions(
            wind_mph=self.wind[lo] + t * (self.wind[hi] - self.wind[lo]),
            gust_mph=self.gust[lo] + t * (self.gust[hi] - self.gust[lo]),
            rain_in_hr=self.rain[precip_i],
            snow_in_hr=self.snow[precip_i],
        )

    def hour_conditions(self, i: int) -> Conditions:
        """Conditions for the hour starting at index ``i`` (used by the heatmap)."""
        p = self._clamp(i + 1)
        w = self._clamp(i)
        return Conditions(self.wind[w], self.gust[w], self.rain[p], self.snow[p])


def window(departure: datetime, needed_hours: float) -> tuple[datetime, int]:
    """Forecast window covering departure → departure + ``needed_hours``.

    The window is aligned to 6-hour UTC blocks and sized in whole days so that
    nearby departure times (and every checkpoint interval) produce the same
    window and therefore hit the same cached forecasts. It starts one hour
    before the block so interpolation never clamps at the start, and keeps at
    least two hours of margin for the precipitation look-ahead.
    """
    dep_hour = floor_hour(departure)
    start = dep_hour.replace(hour=dep_hour.hour - dep_hour.hour % 6) - timedelta(hours=1)
    span = (dep_hour - start).total_seconds() / 3600 + needed_hours + 2
    hours = math.ceil(span / 24) * 24
    return start, hours
