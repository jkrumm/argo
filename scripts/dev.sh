#!/usr/bin/env bash
# Local dev entry — assembles DATABASE_URL from op-resolved components, then
# runs the API + dashboard concurrently. Invoked by `bun dev`.
#
# Expects ARGO_DB_PASSWORD, POSTGRES_DB, API_SECRET to already be in the env
# (apps/api/.env.local.tpl + `op run` provides them). URL-encodes the password
# in case it contains characters that would break URL parsing.
#
# OTel ingest needs no auth in dev — local ClickStack exposes :4319 unauthed,
# matching prod. OTEL_EXPORTER_OTLP_ENDPOINT in .env.local.tpl already points
# there.

set -euo pipefail

: "${ARGO_DB_PASSWORD:?must be set (op run --env-file=apps/api/.env.local.tpl)}"
: "${POSTGRES_DB:?must be set}"

# URL-encode the password
ENCODED_PASSWORD=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$ARGO_DB_PASSWORD")

export DATABASE_URL="postgresql://argo:${ENCODED_PASSWORD}@localhost:5432/shared?schema=argo"

# On the mini, `shared.argo` is the LIVE database since the cutover (2026-10-30): a dev API booted on it would apply its
# unreleased migrations to production and run every cron beside the live process. `db-rehearse` marks the live schema
# 'argo live ...'; refuse it unless the run is deliberate. (On the MacBook the local cluster holds a copy, so no mark.)
LIVE_MARK=$(PGPASSWORD="$ARGO_DB_PASSWORD" psql -X -qAt -h localhost -U argo -d shared \
  -c "SELECT coalesce(obj_description('argo'::regnamespace, 'pg_namespace'), '')" 2>/dev/null || true)
if [[ "$LIVE_MARK" == "argo live"* && "${ARGO_DEV_ON_LIVE:-}" != "1" ]]; then
  echo "dev.sh: shared.argo on this host is the live Argo database ('$LIVE_MARK')." >&2
  echo "        Develop against a local copy (MacBook), or rerun with ARGO_DEV_ON_LIVE=1 to accept migrations and crons on live data." >&2
  exit 1
fi
# Crons belong to the live process; a dev API never runs them.
export CRONS_ENABLED=false

# Free both ports so re-runs don't trip the dashboard's --strictPort or leave
# a zombie API. Errors are tolerated (nothing was running on the port).
npx --yes kill-port 4040 7715 >/dev/null 2>&1 || true

exec ./node_modules/.bin/concurrently \
  --names api,web \
  --prefix-colors blue,magenta \
  "bun run --cwd apps/api dev" \
  "bun run --cwd apps/dashboard dev"
