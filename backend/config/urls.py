from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path


def spa_index(request, *args, **kwargs):
    """Serve the React app for any non-API path (client-side routing)."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        raise Http404("Frontend build not found; run the Vite dev server instead.")
    response = FileResponse(index.open("rb"), content_type="text/html")
    response["Cache-Control"] = "no-cache"
    return response


def api_not_found(request, *args, **kwargs):
    return JsonResponse({"error": {"code": "not_found", "message": "Unknown API endpoint."}}, status=404)


urlpatterns = [
    path("api/", include("planner.api.urls")),
    re_path(r"^api/", api_not_found),
    re_path(r"^(?!api/).*$", spa_index),
]
