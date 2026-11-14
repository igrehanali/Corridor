"""Shared HTTP session for upstream APIs: pooled connections, retries, timeouts."""

from __future__ import annotations

import threading

import requests
from django.conf import settings
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_local = threading.local()


class UpstreamError(Exception):
    """An upstream provider failed. ``public_message`` is safe to show users."""

    status_code = 502

    def __init__(self, public_message: str, *, code: str = "upstream_error", detail: str = ""):
        super().__init__(detail or public_message)
        self.public_message = public_message
        self.code = code


class UpstreamRateLimited(UpstreamError):
    status_code = 503


def session() -> requests.Session:
    """One session per thread (requests.Session is not guaranteed thread-safe)."""
    s = getattr(_local, "session", None)
    if s is None:
        s = requests.Session()
        retry = Retry(
            total=2,
            backoff_factor=0.6,
            status_forcelist=(500, 502, 503, 504),
            allowed_methods=frozenset({"GET", "POST"}),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=16)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        s.headers["User-Agent"] = settings.PLANNER["USER_AGENT"]
        _local.session = s
    return s


def timeout() -> float:
    return settings.PLANNER["HTTP_TIMEOUT_S"]
