"""Vercel entry point: exposes the Django WSGI app as a Python function.

vercel.json rewrites every /api/* request here; Django receives the original
path, so its URL routing works unchanged.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from config.wsgi import application  # noqa: E402

app = application
