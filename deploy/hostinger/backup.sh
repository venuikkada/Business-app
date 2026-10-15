#!/usr/bin/env bash
# Nightly database backup on the VPS. Add to root's crontab:
#   30 20 * * * /path/to/Business-app/deploy/hostinger/backup.sh   # 02:00 IST
# Copy ./backups off the server too (e.g. rclone to Google Drive / S3).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
STAMP="$(TZ=Asia/Kolkata date +%Y%m%d-%H%M%S)"
docker compose exec -T db pg_dump -U cba_owner --format=custom --no-owner --compress=9 cba > "backups/cba-$STAMP.dump"
sha256sum "backups/cba-$STAMP.dump" > "backups/cba-$STAMP.dump.sha256"
# Keep 14 days locally.
find backups -name 'cba-*.dump*' -mtime +14 -delete
echo "backups/cba-$STAMP.dump"
