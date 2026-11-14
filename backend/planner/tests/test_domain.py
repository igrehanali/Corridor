from datetime import UTC, datetime, timedelta

import pytest

from planner.domain.checkpoints import checkpoint_miles, plan_checkpoints
from planner.domain.corridor import build_corridor_grid
from planner.domain.geo import (
    cumulative_miles,
    decode_polyline,
    destination,
    haversine_mi,
    point_at_mile,
    simplify_indices,
)
from planner.domain.hos import HOUR, elapsed_for_drive, rest_stops
from planner.domain.ranking import RouteScore, recommend
from planner.domain.route import Route, major_roads, normalize_road
from planner.domain.weather import HourlySeries, window


def straight_route(miles: float = 100, mph: float = 50) -> Route:
    """A due-north line starting at (35, -100) driven at constant speed."""
    end = destination((35.0, -100.0), 0, miles)
    pts = [(35.0 + (end[0] - 35.0) * i / 100, -100.0) for i in range(101)]
    cum = cumulative_miles(pts)
    return Route(points=pts, cum_drive_s=[m / mph * HOUR for m in cum], roads=["I-35"], provider="t", profile="truck")


# --- geo -------------------------------------------------------------------


def test_decode_polyline_precision6():
    # Google's reference polyline (precision 5)
    pts = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision=5)
    assert pts == [
        pytest.approx((38.5, -120.2)),
        pytest.approx((40.7, -120.95)),
        pytest.approx((43.252, -126.453)),
    ]


def test_haversine_known_distance():
    # Denver -> Salt Lake City, great-circle ≈ 371 mi
    assert haversine_mi((39.7392, -104.9903), (40.7608, -111.891)) == pytest.approx(371, abs=3)


def test_point_at_mile_interpolates():
    r = straight_route(100)
    lat, lon = point_at_mile(r.points, r.cum_miles, 50)
    assert haversine_mi(r.points[0], (lat, lon)) == pytest.approx(50, abs=0.01)


def test_simplify_keeps_ends_and_drops_collinear():
    pts = [(0.0, float(i)) for i in range(10)]
    assert simplify_indices(pts, 0.001) == [0, 9]


# --- checkpoints -----------------------------------------------------------


def test_checkpoint_miles_includes_destination():
    assert checkpoint_miles(53, 25) == [0, 25, 50, 53]
    assert checkpoint_miles(50, 25) == [0, 25, 50]


@pytest.mark.parametrize("interval", [10, 25, 50])
def test_segment_miles_sum_to_route_length(interval):
    r = straight_route(237)
    cps = plan_checkpoints(r, interval, hos=False)
    assert sum(c.segment_mi for c in cps) == pytest.approx(r.distance_mi)


def test_checkpoint_eta_follows_route_speed():
    r = straight_route(100, mph=50)
    cps = plan_checkpoints(r, 25, hos=False)
    assert [round(c.elapsed_s / HOUR, 2) for c in cps] == [0, 0.5, 1.0, 1.5, 2.0]


# --- HOS -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("drive_h", "elapsed_h"),
    [
        (0, 0),
        (7.9, 7.9),
        (8, 8),  # break starts once driving continues past 8 h
        (8.1, 8.6),
        (11, 11.5),
        (11.1, 11.1 + 0.5 + 10),
        (19.1, 19.1 + 0.5 + 10 + 0.5),
        (22.5, 22.5 + 2 * (0.5 + 10)),
    ],
)
def test_hos_elapsed(drive_h, elapsed_h):
    assert elapsed_for_drive(drive_h * HOUR) / HOUR == pytest.approx(elapsed_h)


def test_hos_disabled_is_identity():
    assert elapsed_for_drive(20 * HOUR, enabled=False) == 20 * HOUR


def test_rest_stops_sequence():
    stops = rest_stops(20 * HOUR)
    assert [(s.kind, s.drive_s / HOUR) for s in stops] == [("break", 8), ("off_duty", 11), ("break", 19)]
    assert stops[1].start_s / HOUR == pytest.approx(11.5)


# --- weather time lookup ---------------------------------------------------


def test_series_interpolates_wind_and_uses_hour_containing_eta_for_precip():
    start = datetime(2026, 1, 1, tzinfo=UTC)
    s = HourlySeries(
        start=start,
        wind=(10, 20, 30),
        gust=(15, 25, 35),
        rain=(0.0, 0.1, 0.4),
        snow=(0.0, 0.0, 0.0),
    )
    c = s.at(start + timedelta(minutes=30))
    assert c.wind_mph == pytest.approx(15)
    assert c.rain_in_hr == 0.1  # value stamped 01:00 covers 00:00–01:00
    c = s.at(start + timedelta(hours=1))
    assert c.wind_mph == 20 and c.rain_in_hr == 0.1
    c = s.at(start + timedelta(hours=1, minutes=1))
    assert c.rain_in_hr == 0.4
    assert s.at(start + timedelta(hours=9)).wind_mph == 30  # clamps past the end


def test_window_covers_trip_with_margin():
    dep = datetime(2026, 1, 1, 10, 40, tzinfo=UTC)
    start, hours = window(dep, 48)
    assert start == datetime(2026, 1, 1, 5, tzinfo=UTC)  # 6-hour block (06:00) minus 1 h
    assert window(dep - timedelta(hours=3), 48) == (start, hours)  # same block → same cache key
    last = start + timedelta(hours=hours - 1)
    # Heatmap reads precipitation one hour past its last slider hour (dep hour + 48).
    assert last >= datetime(2026, 1, 1, 10, tzinfo=UTC) + timedelta(hours=49)
    # A checkpoint ETA at departure + 48 h reads the hour-ending stamp after it.
    assert last >= dep + timedelta(hours=48, minutes=20)


# --- ranking ---------------------------------------------------------------


def score(rid, nt=0, sev=0, high=0, avg=0.0, t=3600):
    return RouteScore(rid, f"Route {rid}", nt, sev, high, avg, t)


def test_rank_prefers_fewest_severe_over_time():
    rec = recommend([score("A", sev=20, t=3600), score("B", sev=0, high=90, t=9000)])
    assert rec.route_id == "B" and rec.decided_by == "severe"
    assert "20 mi fewer severe" in rec.reason


def test_rank_no_travel_dominates_severe():
    rec = recommend([score("A", nt=5), score("B", sev=300)])
    assert rec.route_id == "B" and rec.decided_by == "no_travel"


def test_rank_falls_through_to_time():
    rec = recommend([score("A", high=10, avg=0.5, t=5000), score("B", high=10, avg=0.5, t=4000)])
    assert rec.route_id == "B" and rec.decided_by == "time"
    assert "17 min faster" in rec.reason


def test_rank_ignores_float_noise_in_average():
    rec = recommend([score("A", avg=0.3000001, t=100), score("B", avg=0.3, t=200)])
    assert rec.route_id == "A"


def test_reason_explains_why_not_the_fastest_route():
    rec = recommend([score("A", sev=30, t=1000), score("B", sev=0, high=5, t=3000), score("C", sev=0, high=5, t=4000)])
    assert rec.order == ["B", "C", "A"]
    assert rec.decided_by == "severe" and "than Route A" in rec.reason


def test_rank_average_before_time():
    rec = recommend([score("A", avg=0.4, t=100), score("B", avg=0.2, t=200)])
    assert rec.route_id == "B" and rec.decided_by == "avg_risk"


# --- roads & corridor ------------------------------------------------------


def test_major_roads_prefers_numbered_highways():
    segs = [("Main Street", 50), ("I 80 West", 300), ("I-80", 100), ("US 6", 120)]
    assert major_roads(segs) == ["I-80", "US-6", "Main Street"]
    assert normalize_road("I 25 North") == "I-25"


def test_corridor_grid_respects_budget_and_covers_route():
    r = straight_route(600)
    grid = build_corridor_grid([r.points], buffer_mi=35, max_cells=200)
    assert 0 < len(grid.cells) <= 200
    centers = [grid.center(c) for c in grid.cells]
    for p in (r.points[0], r.points[50], r.points[-1]):
        assert min(haversine_mi(p, c) for c in centers) < grid.step * 69
    _west, south, _east, north = grid.bounds
    assert south < r.points[0][0] and north > r.points[-1][0]


def test_corridor_fills_area_enclosed_by_alternative_routes():
    # Two routes that split apart and rejoin enclose an area wider than the buffer.
    a = [(40.0, -100.0 + i * 0.1) for i in range(41)]
    b = [(40.0 + min(i, 40 - i) * 0.1, -100.0 + i * 0.1) for i in range(41)]  # peaks 2° north
    grid = build_corridor_grid([a, b], buffer_mi=20, max_cells=10_000)
    centers = {grid.center(c) for c in grid.cells}
    # A point midway between the two routes, > 20 mi from both, is still covered.
    mid = (40.6, -98.0)
    assert min(haversine_mi(mid, c) for c in centers) <= grid.step * 69
