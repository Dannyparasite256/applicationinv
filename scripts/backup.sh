#!/bin/sh
# PostgreSQL backup script for Enterprise IMS
# Usage: ./scripts/backup.sh
set -e

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="enterprise_ims_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Creating backup: $FILENAME"
PGPASSWORD="${DB_PASSWORD:-ims_secret}" pg_dump \
  -h "${DB_HOST:-localhost}" \
  -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-ims}" \
  -d "${DB_NAME:-enterprise_ims}" \
  | gzip > "$BACKUP_DIR/$FILENAME"

echo "Backup saved to $BACKUP_DIR/$FILENAME"

# Cleanup old backups
find "$BACKUP_DIR" -name "enterprise_ims_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
echo "Done. Retention: ${RETENTION_DAYS} days"
