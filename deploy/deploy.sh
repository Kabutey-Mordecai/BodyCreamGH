#!/bin/bash
# =============================================================================
# deploy.sh — Pull latest code and restart the API with zero downtime.
#
# RUN FROM THE SERVER as the deploy user:
#   ssh deploy@YOUR_SERVER_IP
#   bash /home/deploy/app/deploy/deploy.sh
#
# Or add a GitHub Actions workflow that SSH-es in and runs this script
# automatically on every push to main.
#
# WHAT IT DOES:
#   1. Pull the latest code from GitHub (main branch)
#   2. Install any new npm dependencies
#   3. Run any new database migrations (safe — all use IF NOT EXISTS)
#   4. Reload the PM2 process with zero downtime (cluster reload)
#   5. Print a summary
# =============================================================================

set -e  # Stop on any error — safer than silently continuing

APP_DIR="/home/deploy/app"

echo "=== Deploy started at $(date '+%Y-%m-%d %H:%M:%S') ==="

# ── 1. Pull latest code ───────────────────────────────────────────────────────
echo ">>> Pulling latest code from GitHub..."
cd "${APP_DIR}"
git fetch origin main
git reset --hard origin/main  # discard any local changes (this is a server, not a workspace)

# ── 2. Install/update dependencies ───────────────────────────────────────────
# --omit=dev skips nodemon and other devDependencies on the production server
echo ">>> Installing dependencies..."
cd "${APP_DIR}/backend"
npm install --omit=dev

# ── 3. Run migrations ─────────────────────────────────────────────────────────
# The runner is idempotent (all SQL uses IF NOT EXISTS), so re-running is safe.
# It will skip tables/indexes that already exist and only apply new files.
echo ">>> Running database migrations..."
npm run migrate

# ── 4. Zero-downtime reload ───────────────────────────────────────────────────
# PM2 cluster reload sends SIGINT to one instance at a time, waits for it to
# drain, then starts a new one — the API stays available throughout.
echo ">>> Reloading PM2 process..."
pm2 reload ecosystem.config.js --update-env

# ── 5. Summary ───────────────────────────────────────────────────────────────
echo ""
echo "=== Deploy complete at $(date '+%Y-%m-%d %H:%M:%S') ==="
pm2 list    # shows running processes and their memory / uptime
echo ""
echo "Tail logs: pm2 logs cosmetics-api"
