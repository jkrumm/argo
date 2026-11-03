#!/usr/bin/env bash
# Dev seed: copy the LIVE `argo` schema from the Mac mini into this machine's local `shared` database and prove it.
#
#   bun db:sync   (= make db-sync; secrets arrive through secrets-run + apps/api/.env.local.tpl)
#
# 1. On the mini (over `ssh mini`), ONE psql session opens a REPEATABLE READ READ ONLY snapshot, runs pg_dump against
#    that snapshot and computes a per-table row count + md5 checksum in the same snapshot, so the live Argo writing in
#    between cannot make the two disagree. Every source session runs with default_transaction_read_only=on: the sync
#    cannot write to production even by mistake.
# 2. The dump is restored into the local `shared.argo` as role `argo` (schema-level DDL stripped: the schema exists and
#    argo owns it, `make postgres-setup` in ~/SourceRoot/vps) inside ONE transaction, which also computes the same
#    checksums locally.
# 3. The transaction COMMITs only when every table matches in rows and md5; otherwise it ROLLBACKs, so a bad copy never
#    replaces the local schema.
#
# DESTRUCTIVE to the local `shared.argo`: the restore drops and recreates its tables. The restored schema is marked
# 'argo dev copy ...'. A target marked 'argo live' (the mini itself) is refused unconditionally; production is restored
# from the homelab dump, never from here. A target that holds tables and carries neither a dev-copy nor the old
# rehearsal mark is refused unless FORCE=1.
#
# Overrides: SOURCE_SSH (default `mini`; `local` runs the source side on this host, for testing on the mini against a
# scratch TARGET_DB), TARGET_DB (default `shared`).
set -euo pipefail

: "${ARGO_DB_PASSWORD:?must be set (secrets-run --env-file=apps/api/.env.local.tpl)}"

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
command -v psql >/dev/null 2>&1 || { echo "ERROR: host psql not found (brew install postgresql@18)"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
SOURCE_SSH="${SOURCE_SSH:-mini}"
TARGET_DB="${TARGET_DB:-shared}"
TARGET_HOST=127.0.0.1
MARK='argo dev copy'
OLD_MARK='argo rehearsal copy'
WORK="$(mktemp -d)"
REMOTE_DIR=""

# Runs a shell command on the source host, stdin passed through.
on_source() {
  if [ "${SOURCE_SSH}" = "local" ]; then bash -c "$1"; else ssh -o BatchMode=yes "${SOURCE_SSH}" "bash -c $(printf '%q' "$1")"; fi
}

# The dump holds the whole schema in plaintext: whatever way the run ends, it must not stay on the source host.
cleanup() {
  rm -rf "${WORK}"
  [ -n "${REMOTE_DIR}" ] || return 0
  on_source "rm -rf '${REMOTE_DIR}'" </dev/null >/dev/null 2>&1 \
    || echo "WARNING: could not remove ${REMOTE_DIR} on ${SOURCE_SSH}; remove it by hand" >&2
}
trap cleanup EXIT

target() { PGPASSWORD="${ARGO_DB_PASSWORD}" psql -X -h "${TARGET_HOST}" -U argo -d "${TARGET_DB}" -v ON_ERROR_STOP=1 "$@"; }
log() { echo "[$(date +%H:%M:%S)] $*"; }

# --- Guard -------------------------------------------------------------------
schema_exists=$(target -qAt -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'argo'")
[ "${schema_exists}" = "1" ] || { echo "ERROR: ${TARGET_DB} has no schema argo (run make postgres-setup in ~/SourceRoot/vps)" >&2; exit 1; }
tables_on_target=$(target -qAt -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'argo'")
comment=$(target -qAt -c "SELECT coalesce(obj_description('argo'::regnamespace, 'pg_namespace'), '')")
if [[ "${comment}" == "argo live"* ]]; then
  echo "ERROR: ${TARGET_DB}.argo on this host is the LIVE Argo database ('${comment}'). db:sync never writes to it." >&2
  exit 1
fi
if [ "${tables_on_target}" != "0" ] && [[ "${comment}" != "${MARK}"* ]] && [[ "${comment}" != "${OLD_MARK}"* ]] && [ "${FORCE:-}" != "1" ]; then
  echo "ERROR: ${TARGET_DB}.argo holds ${tables_on_target} tables and is not marked '${MARK}'. Rerun with FORCE=1 to replace it." >&2
  exit 1
fi

# --- 1. Dump + checksums from one read-only snapshot on the mini ----------------
REMOTE_DIR=$(on_source 'umask 077 && mktemp -d /tmp/argo-sync.XXXXXX' </dev/null)
[[ "${REMOTE_DIR}" == /tmp/argo-sync.* ]] || { echo "ERROR: could not create a work dir on ${SOURCE_SSH}: ${REMOTE_DIR}" >&2; exit 1; }

log "Dumping schema argo from ${SOURCE_SSH} (read-only, snapshot-consistent)..."
# The password travels on stdin (first line), never on a command line; psql reads the SQL from the rest of stdin.
{
  printf '%s\n' "${ARGO_DB_PASSWORD}"
  cat <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS snap \gset
\setenv SNAP :snap
\! pg_dump -h 127.0.0.1 -U argo -d shared --schema=argo --clean --if-exists --no-owner --no-privileges --snapshot="\$SNAP" -f ${REMOTE_DIR}/dump.sql
\o ${REMOTE_DIR}/source.sums
$(cat "${HERE}/db-sync-checksums.sql")
\o
COMMIT;
SQL
} | on_source 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; IFS= read -r PGPASSWORD; export PGPASSWORD PGOPTIONS="-c default_transaction_read_only=on"; umask 077; exec psql -X -h 127.0.0.1 -U argo -d shared -qAt -v ON_ERROR_STOP=1 >/dev/null'

on_source "cat '${REMOTE_DIR}/dump.sql'" </dev/null > "${WORK}/dump.sql"
on_source "cat '${REMOTE_DIR}/source.sums'" </dev/null > "${WORK}/source.sums"
[ -s "${WORK}/dump.sql" ] && [ -s "${WORK}/source.sums" ] || { echo "ERROR: empty dump or checksum file from ${SOURCE_SSH}" >&2; exit 1; }
log "Dump: $(wc -c < "${WORK}/dump.sql" | tr -d ' ') bytes, $(wc -l < "${WORK}/source.sums" | tr -d ' ') tables."

# --- 2. Restore into the local argo schema, verified before it commits ----------
log "Restoring into ${TARGET_DB}.argo and verifying before COMMIT..."
grep -v -E '^(DROP|CREATE|COMMENT ON|ALTER) SCHEMA' "${WORK}/dump.sql" > "${WORK}/restore.sql"
{
  echo '\set ON_ERROR_STOP on'
  echo 'BEGIN;'
  echo "\\i ${WORK}/restore.sql"
  echo "COMMENT ON SCHEMA argo IS '${MARK} (synced from the mini) $(date -u +%Y-%m-%dT%H:%MZ)';"
  echo "\\o ${WORK}/target.sums"
  cat "${HERE}/db-sync-checksums.sql"
  echo '\o'
  echo "\\set same \`diff -q ${WORK}/source.sums ${WORK}/target.sums >/dev/null && echo t || echo f\`"
  echo '\if :same'
  echo 'COMMIT;'
  echo '\else'
  echo 'ROLLBACK;'
  echo '\endif'
} > "${WORK}/run.sql"
target -qAt -o /dev/null -f "${WORK}/run.sql"

# --- 3. Report -----------------------------------------------------------------
if diff "${WORK}/source.sums" "${WORK}/target.sums" >"${WORK}/diff.txt"; then
  awk -F'|' '{ rows += $2 } END { printf "SYNC PASS: %d tables, %d rows, per-table row counts and md5 identical\n", NR, rows }' "${WORK}/source.sums"
  column -t -s'|' "${WORK}/source.sums"
else
  echo "SYNC FAIL (rolled back, ${TARGET_DB}.argo unchanged): source (<) vs ${TARGET_DB} (>)" >&2
  cat "${WORK}/diff.txt" >&2
  exit 1
fi
