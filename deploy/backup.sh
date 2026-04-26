#!/bin/bash
# =============================================================================
# backup.sh — Daily backup: PostgreSQL database + uploaded product images
#
# INSTALL:
#   1. Copy to the server:
#        scp deploy/backup.sh root@YOUR_SERVER_IP:/home/deploy/backup.sh
#   2. Make it executable:
#        chmod +x /home/deploy/backup.sh
#   3. Add it to the deploy user's crontab (runs at 02:00 every night):
#        crontab -u deploy -e
#        # Add this line:
#        0 2 * * * /home/deploy/backup.sh >> /home/deploy/app/logs/backup.log 2>&1
#
# WHAT IT DOES:
#   1. Dumps the entire cosmetics_db to a compressed .sql.gz file
#   2. Archives the uploaded product images to a compressed .tar.gz file
#   3. Keeps the last 7 days of both types of backup (older files auto-deleted)
#   4. Writes timestamped log entries so you can verify backups ran
#
# OUTPUT FILES (both land in BACKUP_DIR):
#   cosmetics_db_YYYYMMDD_HHMMSS.sql.gz   — PostgreSQL dump
#   uploads_YYYYMMDD_HHMMSS.tar.gz        — product image archive
# =============================================================================

set -e  # Exit immediately if any command fails (see uploads section for exception)

# ── Config ────────────────────────────────────────────────────────────────────
BACKUP_DIR="/home/deploy/backups"
DB_NAME="cosmetics_db"
DB_USER="cosmetics_user"
UPLOADS_SRC="/home/deploy/app/backend/uploads/products"
KEEP_DAYS=7   # how many daily backups to retain (applies to both DB and uploads)

# ── Create backup directory if it doesn't exist ───────────────────────────────
mkdir -p "${BACKUP_DIR}"

# ── Shared timestamp — both backup files get the same stamp so they pair up ───
DATE=$(date +%Y%m%d_%H%M%S)

# ── Source app .env for DB credentials ───────────────────────────────────────
# PGPASSWORD, DB_HOST, DB_PORT, DB_PASSWORD are read from here.
source /home/deploy/app/backend/.env

# =============================================================================
# Part 1 — PostgreSQL backup
# =============================================================================

DB_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE}.sql.gz"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting database backup → ${DB_FILE}"

PGPASSWORD="${DB_PASSWORD}" pg_dump \
  --host="${DB_HOST:-localhost}" \
  --port="${DB_PORT:-5432}" \
  --username="${DB_USER}" \
  --no-password \
  --format=plain \
  "${DB_NAME}" \
  | gzip > "${DB_FILE}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Database backup complete. Size: $(du -sh "${DB_FILE}" | cut -f1)"

# ── Prune old database backups ────────────────────────────────────────────────
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pruning database backups older than ${KEEP_DAYS} days..."
find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Database pruning done."

# =============================================================================
# Part 2 — Uploaded product images backup
# =============================================================================

UPLOADS_FILE="${BACKUP_DIR}/uploads_${DATE}.tar.gz"

# Check for the uploads directory before attempting the archive.
# If it is missing (e.g. first boot before any images were uploaded, or a
# misconfigured path), log a warning and skip — do NOT exit the script.
if [ ! -d "${UPLOADS_SRC}" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: Uploads directory not found at ${UPLOADS_SRC} — skipping uploads backup."
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting uploads backup → ${UPLOADS_FILE}"

  # -C changes into the parent directory so the archive contains "products/..."
  # rather than an absolute path, making it easy to restore anywhere.
  tar -czf "${UPLOADS_FILE}" \
    -C "$(dirname "${UPLOADS_SRC}")" \
    "$(basename "${UPLOADS_SRC}")"

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uploads backup complete. Size: $(du -sh "${UPLOADS_FILE}" | cut -f1)"

  # ── Prune old uploads backups ─────────────────────────────────────────────
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pruning uploads backups older than ${KEEP_DAYS} days..."
  find "${BACKUP_DIR}" -name "uploads_*.tar.gz" -mtime "+${KEEP_DAYS}" -delete
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uploads pruning done."
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] All backups finished."
