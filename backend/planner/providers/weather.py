"""Hourly forecasts from Open-Meteo, batched and cached.

Units are requested natively (mph, inches) so no conversion happens here.
Locations are fetched up to ``BATCH`` per request, a few requests in parallel,
and each (location, window) is cached so re-planning the same trip — for
example switching the checkpoint interval — only fetches what is new.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import requests
from django.conf import settings
from django.core.cache import cache

from ..domain.geo import LatLon
from ..domain.weather import HourlySeries
from .http import UpstreamError, UpstreamRateLimited, session, timeout

log = logging.getLogger(__name__)

BATCH = 100
PARALLEL = 4
CACHE_TTL_S = 30 * 60  # forecasts update hourly; 30 min keeps data fresh
HOURLY_VARS = "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"
# Checkpoint coordinates are snapped to this lattice (≈7 mi). Forecast models
# are no finer than ~3 km, so this loses nothing and lets nearby checkpoints
# on overlapping routes share one lookup.
SNAP_DEG = 0.1


def snap(p: LatLon, step: float = SNAP_DEG) -> LatLon:
    return (round(round(p[0] / step) * step, 4), round(round(p[1] / step) * step, 4))


def _cache_key(p: LatLon, start: datetime, hours: int) -> str:
    return f"wx:{p[0]:.4f},{p[1]:.4f}:{start:%Y%m%d%H}:{hours}"


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M")


def _values(raw: Sequence[float | None], n: int) -> tuple[float, ...]:
    """Null-safe: models occasionally return null at the far end of a window."""
    vals = [0.0 if v is None else float(v) for v in raw[:n]]
    return tuple(vals + [vals[-1] if vals else 0.0] * (n - len(vals)))


def _parse(item: dict, start: datetime, hours: int) -> HourlySeries:
    h = item["hourly"]
    rain = _values(h["rain"], hours)
    showers = _values(h.get("showers") or [0.0] * hours, hours)
    return HourlySeries(
        start=start,
        wind=_values(h["wind_speed_10m"], hours),
        gust=_values(h["wind_gusts_10m"], hours),
        rain=tuple(round(r + s, 3) for r, s in zip(rain, showers, strict=True)),
        snow=_values(h["snowfall"], hours),
    )


def _fetch_batch(points: list[LatLon], start: datetime, hours: int) -> list[HourlySeries]:
    params = {
        "latitude": ",".join(f"{p[0]:.4f}" for p in points),
        "longitude": ",".join(f"{p[1]:.4f}" for p in points),
        "hourly": HOURLY_VARS,
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "GMT",
        "start_hour": _fmt(start),
        "end_hour": _fmt(start + timedelta(hours=hours - 1)),
    }
    base = settings.PLANNER["OPEN_METEO_URL"].rstrip("/")
    if key := settings.PLANNER["OPEN_METEO_API_KEY"]:
        params["apikey"] = key
        base = base.replace("://api.", "://customer-api.")
    try:
        resp = session().get(f"{base}/v1/forecast", params=params, timeout=timeout())
    except requests.RequestException as exc:
        raise UpstreamError("Couldn't reach the weather service.", code="weather_unreachable") from exc
    if resp.status_code == 429:
        raise UpstreamRateLimited(
            "The weather service's free-tier limit was reached. Please retry in a minute.",
            code="weather_rate_limited",
        )
    if resp.status_code >= 400:
        reason = ""
        with contextlib.suppress(ValueError):
            reason = resp.json().get("reason", "")
        raise UpstreamError("The weather service rejected the request.", code="weather_failed", detail=reason)
    data = resp.json()
    items = data if isinstance(data, list) else [data]
    if len(items) != len(points):
        raise UpstreamError("The weather service returned incomplete data.", code="weather_failed")
    return [_parse(item, start, hours) for item in items]


def fetch_series(points: Iterable[LatLon], start: datetime, hours: int) -> dict[LatLon, HourlySeries]:
    """Forecast series for each (already snapped) point, keyed by that point."""
    unique = list(dict.fromkeys(points))
    keys = {p: _cache_key(p, start, hours) for p in unique}
    cached = cache.get_many(list(keys.values()))
    result: dict[LatLon, HourlySeries] = {}
    missing: list[LatLon] = []
    for p in unique:
        hit = cached.get(keys[p])
        if hit is not None:
            result[p] = hit
        else:
            missing.append(p)
    if missing:
        batches = [missing[i : i + BATCH] for i in range(0, len(missing), BATCH)]
        log.info("weather: %d cached, fetching %d in %d batches", len(result), len(missing), len(batches))
        with ThreadPoolExecutor(max_workers=min(PARALLEL, len(batches))) as pool:
            fetched = list(pool.map(lambda b: _fetch_batch(b, start, hours), batches))
        to_cache = {}
        for batch, series_list in zip(batches, fetched, strict=True):
            for p, series in zip(batch, series_list, strict=True):
                result[p] = series
                to_cache[keys[p]] = series
        cache.set_many(to_cache, CACHE_TTL_S)
    return result
