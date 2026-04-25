#!/bin/bash
# =============================================================================
# backup.sh — Daily PostgreSQL backup
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
#   - Dumps the entire cosmetics_db to a compressed .sql.gz file
#   - Keeps the last 7 days of backups (older files are deleted automatically)
#   - Writes a timestamped log entry so you can verify backups ran
# =============================================================================

set -e

# ── Config ────────────────────────────────────────────────────────────────────
BACKUP_DIR="/home/deploy/backups"
DB_NAME="cosmetics_db"
DB_USER="cosmetics_user"
KEEP_DAYS=7   # how many daily backups to retain

# ── Create backup directory if it doesn't exist ───────────────────────────────
mkdir -p "${BACKUP_DIR}"

# ── Generate a timestamped filename ───────────────────────────────────────────
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="${BACKUP_DIR}/${DB_NAME}_${DATE}.sql.gz"

# ── Dump and compress in one pipe ─────────────────────────────────────────────
# pg_dump → gzip keeps disk usage low. The PGPASSWORD env var is read from
# the .pgpass file or the environment — we source the app .env to pick it up.
source /home/deploy/app/backend/.env

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup → ${FILENAME}"

PGPASSWORD="${DB_PASSWORD}" pg_dump \
  --host="${DB_HOST:-localhost}" \
  --port="${DB_PORT:-5432}" \
  --username="${DB_USER}" \
  --no-password \
  --format=plain \
  "${DB_NAME}" \
  | gzip > "${FILENAME}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete. Size: $(du -sh "${FILENAME}" | cut -f1)"

# ── Delete backups older than KEEP_DAYS ───────────────────────────────────────
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pruning backups older than ${KEEP_DAYS} days..."
find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -mtime +${KEEP_DAYS} -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done."
