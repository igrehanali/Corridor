"""Place search via Photon (OpenStreetMap data, built for type-ahead)."""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass

import requests
from django.conf import settings
from django.core.cache import cache

from .http import UpstreamError, UpstreamRateLimited, session, timeout

CACHE_TTL_S = 24 * 3600
# Bias results toward the continental US (mph / lb product) without excluding elsewhere.
BIAS_LAT, BIAS_LON = 39.5, -98.35


@dataclass(frozen=True, slots=True)
class Place:
    label: str
    lat: float
    lon: float
    kind: str = ""


def _label(props: dict) -> str:
    name = props.get("name") or props.get("street") or ""
    if props.get("housenumber") and props.get("street"):
        name = f"{props['housenumber']} {props['street']}"
    city = props.get("city") or props.get("county") or ""
    state = props.get("state") or ""
    country = props.get("countrycode", "")
    parts = [name]
    if city and city != name:
        parts.append(city)
    if state and state != name:
        parts.append(state)
    if country and country != "US":
        parts.append(props.get("country", country))
    return ", ".join(p for p in parts if p)


def search(query: str, limit: int = 6) -> list[Place]:
    query = " ".join(query.split())[:120]
    if len(query) < 2:
        return []
    key = "geo:" + hashlib.sha1(f"{query.lower()}|{limit}".encode()).hexdigest()
    hit = cache.get(key)
    if hit is not None:
        return [Place(**p) for p in hit]
    params = {"q": query, "limit": limit, "lang": "en", "lat": BIAS_LAT, "lon": BIAS_LON, "location_bias_scale": 0.2}
    try:
        resp = session().get(f"{settings.PLANNER['PHOTON_URL'].rstrip('/')}/api/", params=params, timeout=timeout())
    except requests.RequestException as exc:
        raise UpstreamError("Couldn't reach the place search service.", code="geocode_unreachable") from exc
    if resp.status_code == 429:
        raise UpstreamRateLimited("Place search is busy. Please retry shortly.", code="geocode_rate_limited")
    if resp.status_code >= 400:
        raise UpstreamError("Place search failed.", code="geocode_failed", detail=resp.text[:200])
    places: list[Place] = []
    seen: set[str] = set()
    for f in resp.json().get("features", []):
        lon, lat = f["geometry"]["coordinates"]
        props = f.get("properties", {})
        label = _label(props)
        if not label or label in seen:
            continue
        seen.add(label)
        places.append(Place(label=label, lat=round(lat, 6), lon=round(lon, 6), kind=props.get("osm_value", "")))
    cache.set(key, [asdict(p) for p in places], CACHE_TTL_S)
    return places
