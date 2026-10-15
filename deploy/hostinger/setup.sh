#!/usr/bin/env bash
# One-command install on a fresh Hostinger VPS (Ubuntu 22.04/24.04, 2 GB+ RAM).
#   git clone https://github.com/venuikkada/Business-app.git && cd Business-app/deploy/hostinger
#   ./setup.sh app.your-domain.in admin.your-domain.in you@your-domain.in
# Safe to re-run: it keeps existing secrets and just rebuilds / restarts.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if [[ ! -f .env ]]; then
  APP_DOMAIN="${1:?usage: ./setup.sh <app-domain> <admin-domain> <email>}"
  ADMIN_DOMAIN="${2:?admin domain}"
  ACME_EMAIL="${3:?email for HTTPS certificates}"
  gen() { openssl rand -hex "$1"; }
  sed -e "s|^APP_DOMAIN=.*|APP_DOMAIN=$APP_DOMAIN|" \
      -e "s|^ADMIN_DOMAIN=.*|ADMIN_DOMAIN=$ADMIN_DOMAIN|" \
      -e "s|^ACME_EMAIL=.*|ACME_EMAIL=$ACME_EMAIL|" \
      -e "s|^DB_OWNER_PASSWORD=.*|DB_OWNER_PASSWORD=$(gen 24)|" \
      -e "s|^CBA_APP_PASSWORD=.*|CBA_APP_PASSWORD=$(gen 24)|" \
      -e "s|^CBA_PLATFORM_PASSWORD=.*|CBA_PLATFORM_PASSWORD=$(gen 24)|" \
      -e "s|^APP_SECRET=.*|APP_SECRET=$(gen 32)|" \
      -e "s|^CRON_SECRET=.*|CRON_SECRET=$(gen 32)|" \
      .env.example > .env
  chmod 600 .env
  echo "Created .env with generated secrets. Back it up somewhere safe (password manager)."
fi

# Only SSH + web traffic from the internet.
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null || true
fi

docker compose up -d --build
docker compose ps
set -a; . ./.env; set +a
echo
echo "Done. Open https://$APP_DOMAIN (HTTPS certificates can take a minute)."
echo "Make yourself a super admin after registering in the web app:"
echo "  ./make-admin.sh you@your-domain.in"
