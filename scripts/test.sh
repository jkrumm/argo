#!/usr/bin/env bash
# Run the API test suite against the local dev Postgres.
# Invoked by `bun test:api`. Assembles DATABASE_URL from op-resolved components
# (the .env.local.tpl only carries op:// refs — op run can't interpolate a ref
# inside the larger DATABASE_URL string, so it's built here, same as dev.sh).
#
# Prereq: local dev Postgres up (cd ~/SourceRoot/vps && make up) and provisioned
# (make postgres-setup). Integration tests hit a live database.

set -euo pipefail

: "${ARGO_DB_PASSWORD:?must be set (op run --env-file=apps/api/.env.local.tpl)}"
: "${POSTGRES_DB:?must be set}"

ENCODED_PASSWORD=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$ARGO_DB_PASSWORD")
export DATABASE_URL="postgresql://argo:${ENCODED_PASSWORD}@localhost:5432/${POSTGRES_DB}?schema=argo"

exec bun test --cwd apps/api "$@"
