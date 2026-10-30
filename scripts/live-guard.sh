#!/usr/bin/env bash
# Sourced by scripts/dev.sh and scripts/db-migrate.sh: refuse to point a dev workflow at the LIVE Argo database.
#
# Since the 2026-10-30 cutover `shared.argo` on the mini is production; `scripts/db-rehearse.sh` marks it
# 'argo live ...' (schema comment). Booting a dev API on it would apply unreleased migrations to production, and
# `bun db:migrate` would do the same directly. Fails CLOSED: if the mark cannot be read (psql missing, database
# down, wrong password) the answer is "refuse", not "probably fine". ARGO_DEV_ON_LIVE=1 overrides on purpose.
#
# Needs ARGO_DB_PASSWORD in the environment (apps/api/.env.local.tpl through secrets-run).
refuse_if_live() {
  [ "${ARGO_DEV_ON_LIVE:-}" = "1" ] && return 0
  export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
  if ! command -v psql >/dev/null 2>&1; then
    echo "live-guard: psql not found, cannot tell whether shared.argo is the live database (brew install postgresql@18, or ARGO_DEV_ON_LIVE=1)." >&2
    return 1
  fi
  local mark
  if ! mark=$(PGPASSWORD="${ARGO_DB_PASSWORD:?}" psql -X -qAt -h localhost -U argo -d shared \
    -c "SELECT coalesce((SELECT obj_description(oid, 'pg_namespace') FROM pg_namespace WHERE nspname = 'argo'), '')" 2>&1); then
    echo "live-guard: could not read the schema mark of shared.argo, refusing (is Postgres up? ARGO_DEV_ON_LIVE=1 skips this check): ${mark}" >&2
    return 1
  fi
  if [[ "$mark" == "argo live"* ]]; then
    echo "live-guard: shared.argo on this host is the live Argo database ('${mark}')." >&2
    echo "            Develop against a local copy (MacBook), or set ARGO_DEV_ON_LIVE=1 to accept migrations on live data." >&2
    return 1
  fi
  return 0
}
