# BLAZE backend — FastAPI + SSE replay. Build from the REPO ROOT:
#   docker build -f backend/Dockerfile -t blaze-backend .
#
# backend/api/config.py resolves REPO_ROOT to parents[2], so the code must live
# at /app/backend/api/ for /app to be the repo root. contracts/ and data/ are
# read at runtime (schemas, scenario, audio manifest) and must ship with it.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first — only backend/pyproject.toml invalidates this layer.
COPY backend/pyproject.toml /app/backend/pyproject.toml
RUN pip install --no-cache-dir /app/backend

# Application code + the repo files read at runtime.
COPY backend/ /app/backend/
COPY speech/ /app/speech/
COPY contracts/ /app/contracts/
COPY data/ /app/data/

ENV BACKEND_PORT=8080
EXPOSE 8080

# No .env in the image: Dokploy injects the environment. pydantic-settings
# simply skips a missing env_file, so the defaults in config.py apply.
CMD ["sh", "-c", "uvicorn backend.api.main:app --host 0.0.0.0 --port ${BACKEND_PORT}"]
