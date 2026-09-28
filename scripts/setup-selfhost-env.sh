#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  printf '.env already exists; refusing to overwrite it.\n' >&2
  exit 1
fi

read -r -p 'Google OAuth Client ID: ' GOOGLE_CLIENT_ID
read -r -s -p 'Google OAuth Client Secret (input hidden): ' GOOGLE_CLIENT_SECRET
printf '\n'
read -r -p 'Google email allowed to sign in: ' ALLOWED_EMAILS

POSTGRES_PASSWORD="$(openssl rand -hex 24)"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
INTERNAL_API_SECRET="$(openssl rand -hex 32)"
CRON_SECRET="$(openssl rand -hex 32)"

umask 077
cat > .env <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://hermy_hq:${POSTGRES_PASSWORD}@postgres:5432/hermy_hq?schema=public
POSTGRES_URL=postgresql://hermy_hq:${POSTGRES_PASSWORD}@postgres:5432/hermy_hq?schema=public
NEXTAUTH_URL=https://hq.joshbuilds.tech
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
ALLOWED_EMAILS=${ALLOWED_EMAILS}
NEXT_PUBLIC_OWNER_NAME=Josh
NEXT_PUBLIC_BASE_URL=https://hq.joshbuilds.tech
HERMES_BOARD=default
HERMES_BIN=/opt/data/home/.local/bin/hermes
HERMES_WIKI=
BRIEF_HOUR=7
INTERNAL_API_SECRET=${INTERNAL_API_SECRET}
CRON_SECRET=${CRON_SECRET}
EOF

printf 'Created .env with owner-only permissions. Secrets were not printed.\n'
