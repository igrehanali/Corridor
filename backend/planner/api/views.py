from __future__ import annotations

from dataclasses import asdict

from rest_framework import serializers
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from ..domain.risk import RULES_TABLE
from ..providers import geocoding
from ..providers.geocoding import Place
from ..services.plan import PlanRequest, build_plan
from .serializers import GeocodeQuerySerializer, PlanRequestSerializer


class PlanThrottle(AnonRateThrottle):
    scope = "plan"


class GeocodeThrottle(AnonRateThrottle):
    scope = "geocode"


@api_view(["GET"])
def health(request: Request) -> Response:
    return Response({"status": "ok"})


@api_view(["GET"])
def rules(request: Request) -> Response:
    return Response(RULES_TABLE)


@api_view(["GET"])
@throttle_classes([GeocodeThrottle])
def geocode(request: Request) -> Response:
    params = GeocodeQuerySerializer(data=request.query_params)
    params.is_valid(raise_exception=True)
    places = geocoding.search(params.validated_data["q"])
    return Response({"results": [asdict(p) for p in places]})


def _resolve(data: dict, field: str) -> Place:
    """Use given coordinates, or look the label up when only text was sent."""
    if "lat" in data:
        return Place(label=data["label"], lat=data["lat"], lon=data["lon"])
    found = geocoding.search(data["label"], limit=1)
    if not found:
        raise serializers.ValidationError({field: [f"Couldn't find “{data['label']}”."]})
    return found[0]


@api_view(["POST"])
@throttle_classes([PlanThrottle])
def plan(request: Request) -> Response:
    body = PlanRequestSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    v = body.validated_data
    result = build_plan(
        PlanRequest(
            origin=_resolve(v["origin"], "origin"),
            destination=_resolve(v["destination"], "destination"),
            departure=v["departure"],
            load_lb=v["load_lb"],
            interval_mi=int(v["interval_mi"]),
            hos=v["hos"],
        )
    )
    return Response(result)
