"""API tests with every upstream service mocked at the HTTP layer."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
import responses
from django.utils import timezone
from rest_framework.test import APIClient

VALHALLA = "https://valhalla1.openstreetmap.de/route"
OPEN_METEO = re.compile(r"https://api\.open-meteo\.com/v1/forecast.*")
PHOTON = re.compile(r"https://photon\.komoot\.io/api/.*")
OSRM = re.compile(r"https://router\.project-osrm\.org/route/v1/driving/.*")


def encode_polyline(points, precision=6):
    factor = 10**precision
    out, prev_lat, prev_lon = [], 0, 0
    for lat, lon in points:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for delta in (ilat - prev_lat, ilon - prev_lon):
            v = ~(delta << 1) if delta < 0 else delta << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)


ORIGIN = (39.74, -104.99)
DEST = (40.76, -111.89)


def line(lat_offset: float, n: int = 60):
    """Origin → bowed path (offset at the middle) → destination."""
    pts = []
    for i in range(n):
        t = i / (n - 1)
        bow = lat_offset * (1 - abs(2 * t - 1))
        pts.append((ORIGIN[0] + (DEST[0] - ORIGIN[0]) * t + bow, ORIGIN[1] + (DEST[1] - ORIGIN[1]) * t))
    return pts


def trip(lat_offset: float, hours: float, road: str):
    pts = line(lat_offset)
    return {
        "legs": [
            {
                "shape": encode_polyline(pts),
                "maneuvers": [
                    {
                        "begin_shape_index": 0,
                        "end_shape_index": len(pts) - 1,
                        "time": hours * 3600,
                        "length": 400,
                        "street_names": [road],
                    }
                ],
            }
        ],
        "summary": {"time": hours * 3600, "length": 400},
    }


def valhalla_three_routes(request):
    body = {
        "trip": trip(0.0, 8.0, "I 80"),
        "alternates": [{"trip": trip(0.8, 8.2, "US 40")}, {"trip": trip(-0.8, 8.4, "I 70")}],
    }
    return 200, {}, json.dumps(body)


def weather_callback(windy_box=None):
    """Calm everywhere, except 50 mph wind inside ``windy_box`` = (lat0, lat1, lon0, lon1)."""

    def cb(request):
        q = parse_qs(urlparse(request.url).query)
        lats = [float(v) for v in q["latitude"][0].split(",")]
        lons = [float(v) for v in q["longitude"][0].split(",")]
        start = datetime.fromisoformat(q["start_hour"][0])
        end = datetime.fromisoformat(q["end_hour"][0])
        n = int((end - start).total_seconds() // 3600) + 1
        items = []
        for lat, lon in zip(lats, lons, strict=True):
            windy = windy_box and windy_box[0] < lat < windy_box[1] and windy_box[2] < lon < windy_box[3]
            wind = 50.0 if windy else 8.0
            items.append(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "hourly": {
                        "time": [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(n)],
                        "wind_speed_10m": [wind] * n,
                        "wind_gusts_10m": [wind + 10] * n,
                        "rain": [0.0] * n,
                        "showers": [0.0] * n,
                        "snowfall": [0.0] * n,
                    },
                }
            )
        return 200, {}, json.dumps(items if len(items) > 1 else items[0])

    return cb


def plan_body(**overrides):
    body = {
        "origin": {"label": "Denver, CO", "lat": ORIGIN[0], "lon": ORIGIN[1]},
        "destination": {"label": "Salt Lake City, UT", "lat": DEST[0], "lon": DEST[1]},
        "departure": (timezone.now() + timedelta(hours=2)).isoformat(),
        "load_lb": 42_000,
        "interval_mi": 25,
        "hos": True,
    }
    body.update(overrides)
    return body


@pytest.fixture
def client():
    return APIClient()


@responses.activate
def test_plan_recommends_route_that_avoids_no_travel_wind(client):
    responses.add_callback(responses.POST, VALHALLA, callback=valhalla_three_routes)
    # Windy box sits on the fastest route's (A, offset 0) middle section only.
    responses.add_callback(responses.GET, OPEN_METEO, callback=weather_callback((40.0, 40.5, -109.2, -107.6)))

    res = client.post("/api/plan", plan_body(), format="json")
    assert res.status_code == 200, res.content
    data = res.json()

    routes = {r["id"]: r for r in data["routes"]}
    assert set(routes) == {"A", "B", "C"}
    a = routes["A"]["summary"]["miles_by_level"]
    assert a["no_travel"] > 0  # 50 mph + 42,000 lb → No Travel by load rule
    assert any(cp["load_escalated"] for cp in routes["A"]["checkpoints"])

    rec = data["recommendation"]
    assert rec["route_id"] == "B"  # B is faster than C and both are calm
    assert rec["decided_by"] == "no_travel"
    assert rec["order"] == ["B", "C", "A"]
    assert routes["B"]["recommended"] and routes["A"]["rank"] == 3

    for r in data["routes"]:
        assert sum(cp["segment_mi"] for cp in r["checkpoints"]) == pytest.approx(r["summary"]["distance_mi"], abs=0.5)
        assert len(r["geometry"]) == len(r["geometry_miles"])
        assert r["name"]

    hm = data["heatmap"]
    assert hm["hours"] == 49
    assert len(hm["risk"]) == len(hm["cells"]) * 49 == len(hm["wind_mph"])
    assert max(hm["risk"]) == 4


@responses.activate
def test_light_load_makes_same_wind_severe_not_no_travel(client):
    responses.add_callback(responses.POST, VALHALLA, callback=valhalla_three_routes)
    responses.add_callback(responses.GET, OPEN_METEO, callback=weather_callback((40.0, 40.5, -109.2, -107.6)))
    data = client.post("/api/plan", plan_body(load_lb=20_000), format="json").json()
    a = next(r for r in data["routes"] if r["id"] == "A")["summary"]["miles_by_level"]
    assert a["no_travel"] == 0 and a["severe"] > 0
    # Recommended route is not the fastest (A), so the reason explains why not A.
    assert data["recommendation"]["decided_by"] == "severe"
    assert "than Route A" in data["recommendation"]["reason"]


@responses.activate
def test_switching_interval_reuses_cached_routes_and_weather(client):
    responses.add_callback(responses.POST, VALHALLA, callback=valhalla_three_routes)
    responses.add_callback(responses.GET, OPEN_METEO, callback=weather_callback())
    client.post("/api/plan", plan_body(interval_mi=25), format="json")
    routing_calls = len([c for c in responses.calls if "valhalla" in c.request.url])
    client.post("/api/plan", plan_body(interval_mi=50), format="json")
    assert len([c for c in responses.calls if "valhalla" in c.request.url]) == routing_calls


@responses.activate
def test_long_route_falls_back_to_osrm_with_warning(client):
    responses.add(
        responses.POST,
        VALHALLA,
        json={"error_code": 154, "error": "Path distance exceeds the max distance limit"},
        status=400,
    )

    def osrm(request):
        routes = []
        for offset, hours in ((0.0, 8.0), (0.8, 8.3), (-0.8, 8.6)):
            pts = line(offset)
            n = len(pts) - 1
            routes.append(
                {
                    "geometry": encode_polyline(pts),
                    "legs": [
                        {
                            "annotation": {"distance": [10_000.0] * n, "duration": [hours * 3600 / n] * n},
                            "steps": [{"ref": "I 80", "name": "", "distance": 600_000}],
                        }
                    ],
                }
            )
        return 200, {}, json.dumps({"code": "Ok", "routes": routes})

    responses.add_callback(responses.GET, OSRM, callback=osrm)
    responses.add_callback(responses.GET, OPEN_METEO, callback=weather_callback())
    data = client.post("/api/plan", plan_body(), format="json").json()
    assert {r["provider"] for r in data["routes"]} == {"osrm"}
    assert any("Long-haul" in w for w in data["warnings"])


@responses.activate
def test_weather_rate_limit_is_a_clear_503(client):
    responses.add_callback(responses.POST, VALHALLA, callback=valhalla_three_routes)
    responses.add(responses.GET, OPEN_METEO, json={"reason": "Minutely API request limit exceeded"}, status=429)
    res = client.post("/api/plan", plan_body(), format="json")
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "weather_rate_limited"


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"load_lb": 90_000}, "load_lb"),
        ({"load_lb": -1}, "load_lb"),
        ({"interval_mi": 15}, "interval_mi"),
        ({"departure": (timezone.now() - timedelta(days=1)).isoformat()}, "departure"),
        ({"departure": (timezone.now() + timedelta(days=30)).isoformat()}, "departure"),
    ],
)
def test_plan_validation(client, override, field):
    res = client.post("/api/plan", plan_body(**override), format="json")
    assert res.status_code == 400
    err = res.json()["error"]
    assert err["code"] == "invalid_request" and field in err["fields"]


@responses.activate
def test_text_only_place_is_geocoded(client):
    responses.add(
        responses.GET,
        PHOTON,
        json={
            "features": [
                {
                    "geometry": {"coordinates": [-104.99, 39.74]},
                    "properties": {"name": "Denver", "state": "Colorado", "countrycode": "US", "osm_value": "city"},
                }
            ]
        },
    )
    responses.add_callback(responses.POST, VALHALLA, callback=valhalla_three_routes)
    responses.add_callback(responses.GET, OPEN_METEO, callback=weather_callback())
    res = client.post("/api/plan", plan_body(origin={"label": "Denver"}), format="json")
    assert res.status_code == 200
    assert res.json()["request"]["origin"]["label"] == "Denver, Colorado"


@responses.activate
def test_geocode_endpoint(client):
    responses.add(
        responses.GET,
        PHOTON,
        json={
            "features": [
                {
                    "geometry": {"coordinates": [-96.8, 32.78]},
                    "properties": {"name": "Dallas", "state": "Texas", "countrycode": "US"},
                },
                {
                    "geometry": {"coordinates": [-96.8, 32.78]},
                    "properties": {"name": "Dallas", "state": "Texas", "countrycode": "US"},
                },
            ]
        },
    )
    res = client.get("/api/geocode", {"q": "dallas"})
    assert res.status_code == 200
    assert res.json()["results"] == [{"label": "Dallas, Texas", "lat": 32.78, "lon": -96.8, "kind": ""}]


def test_rules_and_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert "load_rules" in client.get("/api/rules").json()


def test_unknown_api_path_is_json_404(client):
    res = client.get("/api/does-not-exist")
    assert res.status_code == 404 and res.json()["error"]["code"] == "not_found"
