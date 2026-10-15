#!/usr/bin/env bash
# Grants platform super-admin rights to an account that already registered in the web app.
#   ./make-admin.sh you@your-domain.in
set -euo pipefail
cd "$(dirname "$0")"
EMAIL="${1:?usage: ./make-admin.sh <email>}"
set -a; . ./.env; set +a
docker compose run --rm -e MIGRATION_DATABASE_URL="postgres://cba_owner:${DB_OWNER_PASSWORD}@db:5432/cba" migrate \
  pnpm --filter @cba/server exec tsx scripts/create-admin.ts "$EMAIL"
