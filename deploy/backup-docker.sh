#!/bin/bash
# =============================================================================
# backup-docker.sh — Daily backup for the production Docker Compose stack
#
# Backs up:
#   1. PostgreSQL  — pg_dump runs inside the live db container (no downtime)
#   2. Uploads     — a throwaway Alpine container reads the product_uploads
#                    named volume and streams a tar archive to the host
#
# This script is the Docker equivalent of deploy/backup.sh (which is for
# PM2 / bare-VPS deployments). Both write to the same BACKUP_DIR so you
# can use either script depending on which deployment path you chose.
#
# RUN MANUALLY (from the project root):
#   bash deploy/backup-docker.sh
#
# INSTALL AS A CRON JOB (runs at 02:00 every night):
#   crontab -e
#   # Add this line — adjust the project path if needed:
#   0 2 * * * cd /home/deploy/app && bash deploy/backup-docker.sh >> /home/deploy/app/logs/backup-docker.log 2>&1
#
# PREREQUISITES:
#   - Docker and Docker Compose v2 must be installed and in PATH
#   - The production stack must be running:
#       docker compose -f docker-compose.prod.yml up -d
#   - backend/.env must exist (it is the source of DB credentials)
#
# OUTPUT FILES (both in BACKUP_DIR):
#   cosmetics_db_YYYYMMDD_HHMMSS.sql.gz   — PostgreSQL dump
#   uploads_YYYYMMDD_HHMMSS.tar.gz        — product image archive
#
# See the RESTORE REFERENCE section at the bottom of this file.
# =============================================================================

set -e  # Exit immediately on error — a failed half-backup is worse than none

# ── Resolve paths relative to this script ────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
ENV_FILE="${PROJECT_ROOT}/backend/.env"

# ── Config ────────────────────────────────────────────────────────────────────
BACKUP_DIR="/home/deploy/backups"    # same location as backup.sh — keeps both in one place
UPLOADS_VOLUME="product_uploads"     # named volume declared in docker-compose.prod.yml
KEEP_DAYS=7                          # days to retain backups before pruning

# =============================================================================
# Preflight checks — fail loudly before touching anything
# =============================================================================

if ! command -v docker &>/dev/null; then
  echo "ERROR: 'docker' is not installed or not in PATH." >&2
  echo "       Install Docker: https://docs.docker.com/engine/install/" >&2
  exit 1
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "ERROR: Compose file not found: ${COMPOSE_FILE}" >&2
  echo "       Run this script from the project root, or verify the path." >&2
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: backend/.env not found: ${ENV_FILE}" >&2
  echo "       Copy backend/.env.production.example → backend/.env and fill in values." >&2
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running preflight checks..."

# Verify the db container is running by exec-ing a no-op command inside it.
# This catches: container stopped, stack not started, service name mismatch.
if ! docker compose -f "${COMPOSE_FILE}" exec -T db true 2>/dev/null; then
  echo "ERROR: The 'db' container is not running or unreachable." >&2
  echo "       Start the stack: docker compose -f ${COMPOSE_FILE} up -d" >&2
  exit 1
fi

# Verify the uploads volume exists — it is created on first `docker compose up`.
if ! docker volume inspect "${UPLOADS_VOLUME}" &>/dev/null; then
  echo "ERROR: Docker volume '${UPLOADS_VOLUME}' does not exist." >&2
  echo "       Start the stack at least once: docker compose -f ${COMPOSE_FILE} up -d" >&2
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Preflight checks passed."

# ── Setup ─────────────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

# Source the backend .env to get DB_NAME, DB_USER, DB_PASSWORD.
# These are the same credentials the db container was initialised with.
# shellcheck source=/dev/null
source "${ENV_FILE}"

# Both backup files share the same timestamp so they are easy to pair up.
DATE=$(date +%Y%m%d_%H%M%S)

# =============================================================================
# Part 1 — PostgreSQL backup
#
# How it works:
#   `docker compose exec -T` runs pg_dump inside the live db container.
#   -T disables pseudo-TTY allocation so stdout can be piped cleanly.
#   -e PGPASSWORD passes the password as an environment variable to the exec'd
#   process — Docker handles it safely without exposing it on the command line.
#   The plain-SQL dump streams out of the container and is compressed by the
#   host's gzip before landing on disk.
# =============================================================================

DB_FILE="${BACKUP_DIR}/cosmetics_db_${DATE}.sql.gz"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting database backup → ${DB_FILE}"

docker compose -f "${COMPOSE_FILE}" exec -T \
  -e PGPASSWORD="${DB_PASSWORD}" \
  db \
  pg_dump \
    --host=localhost \
    --username="${DB_USER}" \
    --no-password \
    "${DB_NAME}" \
  | gzip > "${DB_FILE}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Database backup complete. Size: $(du -sh "${DB_FILE}" | cut -f1)"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pruning database backups older than ${KEEP_DAYS} days..."
find "${BACKUP_DIR}" -name "cosmetics_db_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Database pruning done."

# =============================================================================
# Part 2 — Uploaded product images backup
#
# How it works:
#   A throwaway Alpine container is started with the product_uploads volume
#   mounted read-only at /data. `tar -czf - -C /data .` writes the compressed
#   archive to stdout; the host shell redirects that stream into a file.
#   The container is removed automatically (--rm) when tar finishes.
#   No downtime, no intermediate files, and the backend container is never
#   paused — both can run simultaneously because the volume is read-only here.
# =============================================================================

UPLOADS_FILE="${BACKUP_DIR}/uploads_${DATE}.tar.gz"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting uploads backup → ${UPLOADS_FILE}"

docker run --rm \
  --volume "${UPLOADS_VOLUME}:/data:ro" \
  alpine \
  tar -czf - -C /data . \
  > "${UPLOADS_FILE}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uploads backup complete. Size: $(du -sh "${UPLOADS_FILE}" | cut -f1)"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pruning uploads backups older than ${KEEP_DAYS} days..."
find "${BACKUP_DIR}" -name "uploads_*.tar.gz" -mtime "+${KEEP_DAYS}" -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uploads pruning done."

echo "[$(date '+%Y-%m-%d %H:%M:%S')] All Docker backups finished."

# =============================================================================
# RESTORE REFERENCE
# =============================================================================
#
# ── Restore PostgreSQL ────────────────────────────────────────────────────────
#
# 1. Make sure the db container is running (start the stack if not).
# 2. Drop and recreate the database (this wipes current data — be certain):
#
#    docker compose -f docker-compose.prod.yml exec -T db \
#      sh -c "dropdb --username=\${DB_USER} \${DB_NAME} && \
#             createdb --username=\${DB_USER} \${DB_NAME}"
#
# 3. Stream the backup into the container:
#
#    gunzip -c /home/deploy/backups/cosmetics_db_TIMESTAMP.sql.gz \
#      | docker compose -f docker-compose.prod.yml exec -T \
#          -e PGPASSWORD="${DB_PASSWORD}" \
#          db \
#          psql --host=localhost --username="${DB_USER}" "${DB_NAME}"
#
# ── Restore uploads ───────────────────────────────────────────────────────────
#
# Spin up a throwaway container with the volume mounted read-write,
# then extract the archive into it:
#
#    docker run --rm \
#      --volume product_uploads:/data \
#      --volume /home/deploy/backups:/backup:ro \
#      alpine \
#      tar -xzf /backup/uploads_TIMESTAMP.tar.gz -C /data
#
# The backend container does not need to be stopped — it can continue
# serving existing files while the restore runs.
# =============================================================================
