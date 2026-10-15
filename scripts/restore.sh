#!/usr/bin/env bash
# Restores a backup into an EMPTY database. The application roles must exist
# in the target cluster (they are created here if missing, without login;
# run `pnpm db:setup-roles` afterwards to set their passwords).
# Usage: RESTORE_DATABASE_URL=postgres://owner@host/newdb ./scripts/restore.sh backups/cba-XXXX.dump
set -euo pipefail
: "${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL}"
FILE="${1:?path to .dump file}"
if [[ -f "$FILE.sha256" ]]; then (cd "$(dirname "$FILE")" && sha256sum --check "$(basename "$FILE").sha256"); fi
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'cba_app') then create role cba_app nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'cba_platform') then create role cba_platform nologin; end if;
end \$\$;"
pg_restore --no-owner --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$FILE"
echo "Restore complete. Compare with the source using ./scripts/verify-restore.sh"
