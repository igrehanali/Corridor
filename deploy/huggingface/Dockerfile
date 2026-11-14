# Hugging Face Spaces (Docker SDK) build.
# The Space holds only this file and README.md; the app source is cloned from
# GitHub at build time, so the Space never needs the code pushed to it.
# Use "Factory rebuild" in the Space settings to pick up new commits.

FROM node:20-alpine AS src
RUN apk add --no-cache git
ARG REPO=https://github.com/igrehanali/Corridor.git
ARG REF=main
RUN git clone --depth 1 --branch ${REF} ${REPO} /src
WORKDIR /src/frontend
RUN npm ci --no-audit --no-fund && npm run build

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRONTEND_DIST=/app/frontend/dist \
    PORT=7860
# Spaces run the container as uid 1000.
RUN useradd --create-home --uid 1000 user
WORKDIR /app
COPY --from=src /src/backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt
COPY --from=src --chown=user /src/backend backend/
COPY --from=src --chown=user /src/frontend/dist frontend/dist
USER user
WORKDIR /app/backend
EXPOSE 7860
CMD gunicorn config.wsgi:application --bind 0.0.0.0:${PORT} --workers 1 --threads 8 --timeout 120 --access-logfile -
