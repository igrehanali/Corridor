"""Uniform error envelope: ``{"error": {"code", "message", "fields"?}}``."""

from __future__ import annotations

import logging

from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler

from ..providers.http import UpstreamError

log = logging.getLogger(__name__)


def _first_message(detail) -> str:
    if isinstance(detail, dict):
        for key, value in detail.items():
            msg = _first_message(value)
            return msg if key == "non_field_errors" else f"{key.replace('_', ' ').capitalize()}: {msg}"
    if isinstance(detail, list) and detail:
        return _first_message(detail[0])
    return str(detail)


def exception_handler(exc, context):
    if isinstance(exc, UpstreamError):
        log.warning("upstream error %s: %s", exc.code, exc)
        return Response({"error": {"code": exc.code, "message": exc.public_message}}, status=exc.status_code)
    if isinstance(exc, exceptions.ValidationError):
        return Response(
            {"error": {"code": "invalid_request", "message": _first_message(exc.detail), "fields": exc.detail}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    response = drf_handler(exc, context)
    if response is not None:
        code = getattr(exc, "default_code", "error")
        response.data = {"error": {"code": code, "message": _first_message(response.data.get("detail", ""))}}
        return response
    log.exception("Unhandled error", exc_info=exc)
    return Response(
        {"error": {"code": "internal_error", "message": "Something went wrong while planning this trip."}},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
