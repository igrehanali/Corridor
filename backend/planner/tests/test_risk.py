import pytest

from planner.domain.risk import (
    Conditions,
    RiskLevel,
    apply_load_rules,
    assess,
    classify_rain,
    classify_snow,
    classify_wind,
)

L, M, H, S, NT = (
    RiskLevel.LOW,
    RiskLevel.MODERATE,
    RiskLevel.HIGH,
    RiskLevel.SEVERE,
    RiskLevel.NO_TRAVEL,
)


@pytest.mark.parametrize(
    ("mph", "level"),
    [(0, L), (24.9, L), (25, M), (34.9, M), (35, H), (44.9, H), (45, S), (54.9, S), (55, NT), (80, NT)],
)
def test_wind_bands(mph, level):
    assert classify_wind(mph) == level


@pytest.mark.parametrize(
    ("rate", "level"),
    [
        (0, L),
        (0.099, L),
        (0.10, M),
        (0.249, M),
        (0.25, H),  # shared edge resolves to the higher band
        (0.50, S),
        (1.00, S),  # "No Travel" is strictly > 1.00
        (1.001, NT),
    ],
)
def test_rain_bands(rate, level):
    assert classify_rain(rate) == level


@pytest.mark.parametrize(
    ("rate", "level"),
    [(0.49, L), (0.5, M), (1.0, H), (2.0, S), (3.0, S), (3.01, NT)],
)
def test_snow_bands(rate, level):
    assert classify_snow(rate) == level


def test_float_noise_does_not_cross_band_edge():
    assert classify_rain(0.1 + 1e-12) == M
    assert classify_rain(0.30000000000000004 - 0.2) == M  # 0.1 after float error


@pytest.mark.parametrize(
    ("wind_mph", "load", "level"),
    [
        (55, 0, NT),  # ≥55 is No Travel for any load
        (50, 30_000, S),  # not *more than* 30,000
        (50, 30_001, NT),
        (40, 40_000, H),
        (40, 40_001, S),
        (40, 39_000, H),
        (30, 80_000, M),  # load rules never touch the moderate band
    ],
)
def test_load_rules(wind_mph, load, level):
    assert apply_load_rules(classify_wind(wind_mph), load) == level


def test_assess_takes_worst_factor_and_explains_it():
    a = assess(Conditions(wind_mph=20, gust_mph=30, rain_in_hr=0.3, snow_in_hr=0.6), load_lb=10_000)
    assert a.level == H
    assert a.rain == H and a.snow == M and a.wind == L
    assert "Rain 0.30" in a.reason and "Snow" not in a.reason


def test_assess_flags_load_escalation():
    a = assess(Conditions(wind_mph=47, gust_mph=60, rain_in_hr=0, snow_in_hr=0), load_lb=35_000)
    assert a.level == NT
    assert a.load_escalated
    assert "load rule" in a.reason


def test_low_reason():
    a = assess(Conditions(5, 8, 0, 0), 20_000)
    assert a.level == L and a.reason == "Conditions within normal limits"
