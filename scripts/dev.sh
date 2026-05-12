#!/usr/bin/env bash
# Local dev entry — assembles DATABASE_URL from op-resolved components, then
# runs the API + dashboard concurrently. Invoked by `bun dev`.
#
# Expects ARGO_DB_PASSWORD, POSTGRES_DB, API_SECRET to already be in the env
# (apps/api/.env.local.tpl + `op run` provides them). URL-encodes the password
# in case it contains characters that would break URL parsing.

set -euo pipefail

: "${ARGO_DB_PASSWORD:?must be set (op run --env-file=apps/api/.env.local.tpl)}"
: "${POSTGRES_DB:?must be set}"

# URL-encode the password
ENCODED_PASSWORD=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$ARGO_DB_PASSWORD")

export DATABASE_URL="postgresql://argo:${ENCODED_PASSWORD}@localhost:5432/${POSTGRES_DB}?schema=argo"

exec ./node_modules/.bin/concurrently \
  --names api,web \
  --prefix-colors blue,magenta \
  "bun run --cwd apps/api dev" \
  "bun run --cwd apps/dashboard dev"
