#!/usr/bin/env bash
# Logical backup of the whole database (all tenants) in PostgreSQL custom format.
# Usage: BACKUP_DATABASE_URL=postgres://owner@host/db ./scripts/backup.sh [output-dir]
# Schedule daily; keep 7 daily + 4 weekly + 12 monthly copies off-site, encrypted
# (managed Postgres point-in-time recovery is still recommended in addition).
set -euo pipefail
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(TZ=Asia/Kolkata date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/cba-$STAMP.dump"
pg_dump --format=custom --no-owner --compress=9 --file="$FILE" "$BACKUP_DATABASE_URL"
sha256sum "$FILE" > "$FILE.sha256"
# Optional encryption at rest: set BACKUP_GPG_RECIPIENT to a public key id.
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --recipient "$BACKUP_GPG_RECIPIENT" --encrypt "$FILE" && rm "$FILE"
  echo "Encrypted backup: $FILE.gpg"
else
  echo "Backup written: $FILE"
fi
