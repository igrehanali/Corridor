# Corridor — weather-aware truck routing

A React + Django app that helps a truck driver choose the safest of three routes, based on the forecast weather the truck will actually drive into, its load weight and its travel time.

- **Three real route options** come from a truck router. Extra options are generated when the router returns fewer.
- **Checkpoint weather:** forecasts are read every 10, 25 or 50 miles, at the hour the truck is expected to reach each checkpoint. Hours-of-service rest stops are included in those times.
- **Risk scoring:** each checkpoint is scored with the brief's risk table and load rules. Routes are then ranked by the brief's order of preference, and the app explains the result in plain language.
- **Map:** routes are coloured by risk, with checkpoints, rest stops and ETAs, plus a live truck position for any forecast hour.
- **Heatmap:** a weather heatmap covers the corridor around the routes. A 0–48 hour slider plays it back at 60 fps, showing risk, wind, rain or snow.

> Demo trips are one click away in the empty state (Denver → Salt Lake City, Seattle → Boise, …).

---

## Quick start

Requirements: Python 3.11+, Node 20+. No API keys are needed.

```bash
# API  (http://127.0.0.1:8000)
cd backend
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
DJANGO_DEBUG=1 python manage.py runserver

# Web  (http://localhost:5173, proxies /api to Django)
cd frontend
npm ci
npm run dev
```

Tests and checks:

```bash
cd backend && pytest && ruff check .      # 79 tests: risk rules, HOS, ranking, corridor, API (upstreams mocked)
cd frontend && npm test && npm run typecheck
```

### Production

The `Dockerfile` builds the React app and serves it from Django (WhiteNoise), so one container is the whole product:

```bash
docker build -t corridor .
docker run -p 8000:8000 -e DJANGO_SECRET_KEY=change-me corridor
```

`render.yaml` deploys that image to Render as a Blueprint. For a free host with no card, `deploy/huggingface/` holds a Hugging Face Spaces (Docker) setup: create a Docker Space, add its two files, and set the `DJANGO_SECRET_KEY` secret. The Space clones this repo and builds it. To host the frontend separately (e.g. on Vercel), build it with `VITE_API_URL=https://your-api` and add that origin to `CORS_ALLOWED_ORIGINS`. All settings are listed in `.env.example`.

---

## How it works

```
POST /api/plan
  │
  ├─ routes      Valhalla truck routing (weight-aware) ──► 3 distinct routes
  │              └ >930 mi: OSRM fallback, re-timed at truck speed
  │              └ <3 options: via-point detours, de-duplicated by overlap
  ├─ checkpoints every N mi; ETA = per-vertex drive time + HOS rest
  ├─ weather     Open-Meteo hourly forecast, batched + cached per (cell, window)
  ├─ risk        classify wind/rain/snow → worst factor → load rules
  ├─ rank        no-travel → severe → high → avg risk → time
  └─ heatmap     regular lat/lon lattice over the corridor × 49 hours
```

| Layer | Where | Notes |
|---|---|---|
| Risk rules | `backend/planner/domain/risk.py` | Every threshold in one file; exhaustive edge-case tests |
| Checkpoints & ETAs | `domain/checkpoints.py`, `domain/hos.py` | Per-vertex drive time from the router, so ETAs follow real speed changes |
| Recommendation | `domain/ranking.py` | Lexicographic sort key + human-readable reason |
| Heatmap grid | `domain/corridor.py` | Adaptive lattice under a cell budget, enclosed gaps filled |
| Providers | `planner/providers/` | Valhalla, OSRM, Photon (geocoding), Open-Meteo; retries, timeouts, typed errors |
| Orchestration | `planner/services/plan.py` | The only thing the API view calls |
| Map | `frontend/src/map/MapView.tsx` | MapLibre + deck.gl, interleaved so weather draws under labels |
| Heatmap rendering | `frontend/src/lib/heatmap.ts` | One pixel per cell, GPU bilinear filtering, cross-fade between hours |

### Decisions and assumptions

The brief leaves a few things open. Each choice below is deliberate and tested:

- **Shared band edges:** the table lists 0.25 in/hr rain as both Moderate and High. Bands include their lower edge, so 0.25 is High. "No Travel" for rain and snow is strictly above the top edge, so exactly 1.00 in/hr of rain is Severe. Wind ≥55 mph is No Travel, as written.
- **Checkpoint risk:** a checkpoint takes the worst of wind, rain and snow. Load rules apply to wind only, as in the brief:
  - over 30,000 lb, 45–54 mph wind is No Travel;
  - over 40,000 lb, 35–44 mph wind is Severe.
- **Wind measure:** sustained 10 m wind is scored. Gusts are shown but not scored, because the table gives one wind value and sustained wind is the standard for operational limits.
- **Rain:** rain includes convective showers.
- **Miles per checkpoint:** each checkpoint stands for half the distance to each neighbour, so a route's Low…No Travel miles always add up exactly to its length.
- **Weather timing:** wind is interpolated between hours. Precipitation is taken from the forecast hour that contains the ETA, because Open-Meteo stamps precipitation as a total for the *preceding* hour.
- **No Travel ranks first:** the brief's list doesn't mention No Travel. A route with No Travel miles is ranked below any route without them, before Severe miles are compared.
- **Average risk:** average risk is a miles-weighted mean on a 0–4 scale (Low 0 … No Travel 4).
- **Travel time:** travel time is door to door, including rest when HOS is on.
- **Recommendation text:** if the recommended route isn't the fastest, the reason explains why not the fastest ("Avoids 42 mi of severe weather vs Route A"). That is the question a driver actually asks.
- **HOS rest:** HOS is on by default, because a 20-hour trip without rest gives wrong ETAs and therefore wrong weather. It adds a 30-minute break after 8 hours of driving and a 10-hour rest after 11 hours. It can be switched off.
- **Load weight:** load weight is cargo only. The router receives cargo plus 35,000 lb of tractor-trailer (`TRUCK_TARE_LB`), so bridge and road weight limits apply.

### Providers and limits

Every provider is free and needs no key, which keeps the project runnable by anyone:

- **Valhalla** (FOSSGIS public server): truck costing with gross weight. It caps routes at 1,500 km (about 930 mi).
  - Longer trips switch to **OSRM**, re-timed so no segment is faster than 65 mph. The UI says when this happens.
- **Open-Meteo:** hourly forecasts in mph and inches, many locations per request. The free tier allows about 600 location lookups per minute, so the backend:
  - snaps checkpoints to a 0.1° lattice (forecast models are no finer) and removes duplicates across routes;
  - caps the heatmap at 200 cells;
  - caches each location's forecast for 30 minutes, keyed to 6-hour windows, so changing the interval or nudging the departure re-uses data;
  - honours `Retry-After` on HTTP 429 responses.

  Setting `OPEN_METEO_API_KEY` switches to the commercial endpoint.
- **Photon:** place search for the autocomplete, proxied and cached by the backend.

### Performance

- A typical plan takes 3–8 s cold and well under 1 s from cache.
- The response is about 250 KB of JSON (about 50 KB gzipped).
- Geometry is simplified with Douglas–Peucker to about 60 m. Heatmap values are packed as flat integer arrays.
- Scrubbing or playing the slider repaints a raster of about 200 pixels and moves three markers. Nothing is fetched, and route geometry is never rebuilt.

### API

| Method | Path | |
|---|---|---|
| `POST` | `/api/plan` | `{origin:{label,lat?,lon?}, destination, departure (ISO), load_lb, interval_mi: 10\|25\|50, hos}` |
| `GET` | `/api/geocode?q=` | Place autocomplete |
| `GET` | `/api/rules` | The risk table and load rules as data |
| `GET` | `/api/health` | Liveness |

Errors always come back as `{"error": {"code", "message", "fields?"}}`, with a status code that matches the cause:

| Status | Cause |
|---|---|
| 400 | Validation failed |
| 422 | No route exists between the places |
| 502 | An upstream service failed |
| 503 | An upstream service is rate limited |
