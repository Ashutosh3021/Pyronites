
# Dockerfile for PyroCore
# Multi-stage build to keep final image small

# Stage 1: Build dependencies
FROM python:3.11-slim AS builder

WORKDIR /app

# Install system dependencies for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy pyproject.toml and install dependencies
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e ".[dev]"

# Stage 2: Production image
FROM python:3.11-slim

# Set environment variables (match CLI defaults)
ENV DATABASE_PATH=/data/pyrocore.db \
    MIGRATIONS_DIR=/app/backend/migrations \
    STORAGE_ROOT=/data/storage_files \
    HOST=0.0.0.0 \
    PORT=8000

WORKDIR /app

# Install system dependencies: curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Pre-create the persistent-volume layout.  On a fresh deploy the platform
# mounts an EMPTY volume at /data; creating the dirs here (as root, which is
# also the runtime user — see note below) guarantees the app can write its
# database, storage, and backups on first boot regardless of the volume's
# ownership.
RUN mkdir -p /data/storage_files /data/backups && chmod -R 777 /data

# Copy only necessary files from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy our code (preserve package directories so `backend.app` is importable)
COPY backend /app/backend
COPY cli /app/cli
COPY connectors /app/connectors
COPY __init__.py /app/__init__.py

# Expose port (platforms inject their own $PORT at runtime; see HEALTHCHECK)
EXPOSE 8000

# Healthcheck using /health endpoint.
# IMPORTANT: use ${PORT:-8000} so the probe hits the SAME port the app actually
# binds.  Platforms (Render/Fly) override $PORT at runtime — if this were
# hard-coded to 8000 the healthcheck would fail on any platform-assigned port
# and the instance would be marked unhealthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f "http://localhost:${PORT:-8000}/health" || exit 1

# Run the app (shell form to expand env vars).
#
# NOTE ON USER: this container runs as root.  This is a deliberate choice for a
# single-tenant, self-hosted SQLite app that writes to a platform-mounted
# volume: platform-created volume roots are owned by root, and a non-root uid
# (e.g. 1000) cannot write them, which would make every deploy start with a
# 500 on the first write.  Running as root sidesteps that entire failure class.
# If you need to harden this later, pre-chown the mounted volume to your
# chosen uid and add a `USER` switch + an entrypoint that `chown`s /data.
CMD exec python -m uvicorn backend.app:app --host ${HOST} --port ${PORT}
