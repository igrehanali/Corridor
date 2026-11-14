from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from ..domain.checkpoints import ALLOWED_INTERVALS

MAX_LOAD_LB = 80_000  # US federal gross limit; no legal cargo load exceeds it
MAX_DEPARTURE_AHEAD = timedelta(days=10)
DEPARTURE_GRACE = timedelta(hours=1)


class PlaceSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=200)
    lat = serializers.FloatField(min_value=-90, max_value=90, required=False)
    lon = serializers.FloatField(min_value=-180, max_value=180, required=False)

    def validate(self, attrs):
        if ("lat" in attrs) != ("lon" in attrs):
            raise serializers.ValidationError("Provide both lat and lon, or neither to search by label.")
        return attrs


class PlanRequestSerializer(serializers.Serializer):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    departure = serializers.DateTimeField()
    load_lb = serializers.FloatField(min_value=0, max_value=MAX_LOAD_LB)
    interval_mi = serializers.ChoiceField(choices=ALLOWED_INTERVALS, default=25)
    hos = serializers.BooleanField(default=True)

    def validate_departure(self, value):
        now = timezone.now()
        if value < now - DEPARTURE_GRACE:
            raise serializers.ValidationError("Departure can't be in the past.")
        if value > now + MAX_DEPARTURE_AHEAD:
            raise serializers.ValidationError("Departure must be within the next 10 days (forecast range).")
        return value


class GeocodeQuerySerializer(serializers.Serializer):
    q = serializers.CharField(min_length=2, max_length=120)
