import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-key")

from .settings import *  # noqa: F403

REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": {"plan": "1000/min", "geocode": "1000/min"}}  # noqa: F405
