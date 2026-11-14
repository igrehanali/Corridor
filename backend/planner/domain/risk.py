"""Weather risk classification.

Single source of truth for the assessment's risk table and load rules.
Every threshold lives in this module so the rules are reviewable in one place.

Band edges
----------
The brief's table shares edge values between columns (rain 0.25 is listed under
both "Moderate" and "High"). We resolve this with lower-inclusive bands: a value
equal to a band's lower edge belongs to that band. "No Travel" for rain and snow
is written as strictly greater than the top edge (">1.00", ">3.0"), so exactly
1.00 in/hr of rain is still Severe. Wind "No Travel" is written as "≥55", so 55
mph is No Travel.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class RiskLevel(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return _LABELS[self]

    @property
    def key(self) -> str:
        return self.name.lower()


_LABELS = {
    RiskLevel.LOW: "Low",
    RiskLevel.MODERATE: "Moderate",
    RiskLevel.HIGH: "High",
    RiskLevel.SEVERE: "Severe",
    RiskLevel.NO_TRAVEL: "No Travel",
}

# Load-rule weight limits, in pounds (strictly greater than).
NO_TRAVEL_LOAD_LB = 30_000  # 45–54 mph + >30,000 lb -> No Travel
SEVERE_LOAD_LB = 40_000  # 35–44 mph + >40,000 lb -> Severe

# Rounding applied to raw inputs before comparison, so float noise from unit
# conversion (e.g. 0.09999999) never shifts a value across a band edge.
_PRECISION = 3


def classify_wind(mph: float) -> RiskLevel:
    v = round(mph, _PRECISION)
    if v >= 55:
        return RiskLevel.NO_TRAVEL
    if v >= 45:
        return RiskLevel.SEVERE
    if v >= 35:
        return RiskLevel.HIGH
    if v >= 25:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def classify_rain(in_per_hr: float) -> RiskLevel:
    v = round(in_per_hr, _PRECISION)
    if v > 1.0:
        return RiskLevel.NO_TRAVEL
    if v >= 0.5:
        return RiskLevel.SEVERE
    if v >= 0.25:
        return RiskLevel.HIGH
    if v >= 0.10:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def classify_snow(in_per_hr: float) -> RiskLevel:
    v = round(in_per_hr, _PRECISION)
    if v > 3.0:
        return RiskLevel.NO_TRAVEL
    if v >= 2.0:
        return RiskLevel.SEVERE
    if v >= 1.0:
        return RiskLevel.HIGH
    if v >= 0.5:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def apply_load_rules(wind_level: RiskLevel, load_lb: float) -> RiskLevel:
    """Escalate the wind level for heavy loads.

    ≥55 mph is already No Travel for any load (handled by ``classify_wind``).
    The wind bands map one-to-one onto the brief's mph ranges:
    SEVERE == 45–54 mph and HIGH == 35–44 mph.
    """
    if wind_level == RiskLevel.SEVERE and load_lb > NO_TRAVEL_LOAD_LB:
        return RiskLevel.NO_TRAVEL
    if wind_level == RiskLevel.HIGH and load_lb > SEVERE_LOAD_LB:
        return RiskLevel.SEVERE
    return wind_level


@dataclass(frozen=True, slots=True)
class Conditions:
    wind_mph: float
    gust_mph: float
    rain_in_hr: float
    snow_in_hr: float


@dataclass(frozen=True, slots=True)
class Assessment:
    level: RiskLevel
    wind: RiskLevel  # after load rules
    rain: RiskLevel
    snow: RiskLevel
    load_escalated: bool
    reason: str


def assess(conditions: Conditions, load_lb: float) -> Assessment:
    """Classify one point in time/space. The overall level is the worst factor."""
    base_wind = classify_wind(conditions.wind_mph)
    wind = apply_load_rules(base_wind, load_lb)
    rain = classify_rain(conditions.rain_in_hr)
    snow = classify_snow(conditions.snow_in_hr)
    level = max(wind, rain, snow)
    escalated = wind != base_wind
    return Assessment(
        level=level,
        wind=wind,
        rain=rain,
        snow=snow,
        load_escalated=escalated,
        reason=_reason(conditions, load_lb, level, wind, rain, snow, escalated),
    )


def risk_level(conditions: Conditions, load_lb: float) -> RiskLevel:
    """Same result as ``assess(...).level`` without building the explanation.

    Used for the heatmap, which classifies thousands of cell-hours per request.
    """
    return max(
        apply_load_rules(classify_wind(conditions.wind_mph), load_lb),
        classify_rain(conditions.rain_in_hr),
        classify_snow(conditions.snow_in_hr),
    )


def _reason(
    c: Conditions,
    load_lb: float,
    level: RiskLevel,
    wind: RiskLevel,
    rain: RiskLevel,
    snow: RiskLevel,
    escalated: bool,
) -> str:
    if level == RiskLevel.LOW:
        return "Conditions within normal limits"
    parts: list[str] = []
    if wind == level:
        text = f"Wind {c.wind_mph:.0f} mph"
        if escalated:
            text += f" with {load_lb:,.0f} lb load (load rule)"
        parts.append(text)
    if rain == level:
        parts.append(f"Rain {c.rain_in_hr:.2f} in/hr")
    if snow == level:
        parts.append(f"Snow {c.snow_in_hr:.2f} in/hr")
    return " · ".join(parts)


RULES_TABLE = {
    "levels": [lvl.key for lvl in RiskLevel],
    "conditions": [
        {"key": "wind", "unit": "mph", "bands": ["<25", "25–34", "35–44", "45–54", "≥55"]},
        {"key": "rain", "unit": "in/hr", "bands": ["<0.10", "0.10–0.25", "0.25–0.50", "0.50–1.00", ">1.00"]},
        {"key": "snow", "unit": "in/hr", "bands": ["<0.5", "0.5–1.0", "1.0–2.0", "2.0–3.0", ">3.0"]},
    ],
    "load_rules": [
        "≥55 mph → No Travel for any load",
        f"45–54 mph + >{NO_TRAVEL_LOAD_LB:,} lb → No Travel",
        f"35–44 mph + >{SEVERE_LOAD_LB:,} lb → Severe",
    ],
}
