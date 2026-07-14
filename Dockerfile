
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

# Create non-root user
RUN useradd -m -u 1000 pyrocore && \
    mkdir -p /data && \
    chown -R pyrocore:pyrocore /data /app

# Copy only necessary files from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy our code
COPY backend cli connectors __init__.py /app/

# Switch to non-root user
USER pyrocore

# Expose port
EXPOSE 8000

# Healthcheck using /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the app (shell form to expand env vars)
CMD exec python -m uvicorn backend.app:app --host ${HOST} --port ${PORT}
