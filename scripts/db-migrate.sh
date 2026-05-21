#!/usr/bin/env bash
# Apply pending Drizzle migrations against the local dev Postgres.
# Invoked by `bun db:migrate`. Assembles DATABASE_URL from op-resolved components.

set -euo pipefail

: "${ARGO_DB_PASSWORD:?must be set (op run --env-file=apps/api/.env.local.tpl)}"
: "${POSTGRES_DB:?must be set}"

ENCODED_PASSWORD=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$ARGO_DB_PASSWORD")
export DATABASE_URL="postgresql://argo:${ENCODED_PASSWORD}@localhost:5432/${POSTGRES_DB}?schema=argo"

# Relocate the migration journal into argo's schema first, so drizzle-kit reads
# the right journal (matches the API-boot path in runMigrations).
bun run apps/api/scripts/relocate-journal.ts

exec bun run --cwd apps/api db:migrate
