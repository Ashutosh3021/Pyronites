
# PyroCore Deployment Guide

This guide covers deploying PyroCore locally with Docker and to Render's free tier.

## Local Docker Deployment

### Prerequisites
- Docker and Docker Compose installed

### Steps
1. Copy `.env.example` to `.env` and modify if needed:
   ```bash
   cp .env.example .env
   ```
2. Start the service with Docker Compose:
   ```bash
   docker-compose up -d --build
   ```
3. Verify it's running by checking the health endpoint:
   ```bash
   curl http://localhost:8000/health
   ```
4. Check logs if needed:
   ```bash
   docker-compose logs -f pyrocore
   ```
5. Stop the service:
   ```bash
   docker-compose down
   ```

## Deploy to Render (Free Tier)

Render is a Platform-as-a-Service with a free tier suitable for small projects.

### Steps
1. Create a Render account at https://render.com
2. Create a new **Web Service**
3. Connect your GitHub repository
4. Configure the service:
   - **Runtime**: Docker
   - **Branch**: main (or your deployment branch)
   - **Region**: Choose the nearest to you
5. Add a **Disk** (for persistent storage):
   - **Name**: `pyrocore-data`
   - **Mount Path**: `/data`
   - **Size**: 1 GB (free tier max)
6. Click "Create Web Service"
7. Once deployed, you can access your API at the provided Render URL

### Persistence on Render
- The `/data` disk you created will store:
  - `pyrocore.db` (SQLite database)
  - `storage_files/` (uploaded files)
  - `backups/` (database backups)
- This data will survive service restarts and deployments

## First Boot Behavior
When PyroCore starts for the first time (empty volume):
1. Runs all pending database migrations automatically
2. Initializes the `storage_files` and `backups` directories
3. Starts the API server

## Backups
You can create and restore backups using the PyroCore CLI inside the container (locally) or by downloading/uploading the backup file from Render's disk.
