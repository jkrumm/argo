#!/usr/bin/env bash
# Dev seed: copy the LIVE `argo` schema from the Mac mini into this machine's local `shared` database and prove it.
#
#   bun db:sync   (= make db-sync; secrets arrive through secrets-run + apps/api/.env.local.tpl)
#
# 1. On the mini (over `ssh mini`), ONE psql session opens a REPEATABLE READ READ ONLY snapshot, runs pg_dump against
#    that snapshot and computes a per-table row count + md5 checksum in the same snapshot, so the live Argo writing in
#    between cannot make the two disagree. Every source session runs with default_transaction_read_only=on and a 30 s
#    lock timeout: that rules out an accidental write, though it is a session setting, not a privilege boundary (the
#    source role `argo` owns the schema).
# 2. The dump is restored into the local `shared.argo` as role `argo` (schema-level DDL stripped: the schema exists and
#    argo owns it, `make postgres-setup` in ~/SourceRoot/vps) inside ONE transaction, which also computes the same
#    checksums locally.
# 3. The transaction COMMITs only when every table matches in rows and md5; otherwise it ROLLBACKs, so a bad copy never
#    replaces the local schema.
#
# DESTRUCTIVE to the local `shared.argo`: the restore drops every table in it (RESTRICT: an object outside the schema that
# depends on one fails the run instead of being dropped), then recreates the source's. The restored schema is marked
# 'argo dev copy ...'. A target marked 'argo live' (the mini itself) is refused unconditionally; production is restored
# from the homelab dump, never from here. A target that holds tables and carries neither a dev-copy nor the old
# rehearsal mark is refused unless FORCE=1. Independently of any comment, a target that is the source database itself
# (same cluster system_identifier, same connected database) is refused before anything is dumped.
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
# Keepalives make a wedged host or a half-open tailnet link fail the run instead of hanging it (and the snapshot with it).
on_source() {
  if [ "${SOURCE_SSH}" = "local" ]; then bash -c "$1"; return; fi
  ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
    "${SOURCE_SSH}" "bash -c $(printf '%q' "$1")"
}

# The dump holds the whole schema in plaintext: whatever way the run ends, it must not stay on the source host.
cleanup() {
  rm -rf "${WORK}"
  [ -n "${REMOTE_DIR}" ] || return 0
  on_source "rm -rf '${REMOTE_DIR}'" </dev/null >/dev/null 2>&1 \
    || echo "WARNING: could not remove ${REMOTE_DIR} on ${SOURCE_SSH}; remove it by hand" >&2
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

SOURCE_PSQL='export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; IFS= read -r PGPASSWORD; export PGPASSWORD PGOPTIONS="-c default_transaction_read_only=on -c lock_timeout=30s -c transaction_timeout=15min"; umask 077; exec psql -X -h 127.0.0.1 -U argo -d shared -qAt -v ON_ERROR_STOP=1'
# The password travels on stdin (first line), never on a command line; psql reads the SQL from the rest of stdin.
source_sql() { { printf '%s\n' "${ARGO_DB_PASSWORD}"; cat; } | on_source "${SOURCE_PSQL}"; }

target() { PGPASSWORD="${ARGO_DB_PASSWORD}" PGOPTIONS="-c lock_timeout=30s" psql -X -h "${TARGET_HOST}" -U argo -d "${TARGET_DB}" -v ON_ERROR_STOP=1 "$@"; }
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
# Comment-independent: the same cluster and the same connected database is the source itself, whatever TARGET_DB says.
IDENTITY_SQL="SELECT system_identifier || '/' || current_database() FROM pg_control_system()"
source_id=$(echo "${IDENTITY_SQL};" | source_sql)
target_id=$(target -qAt -c "${IDENTITY_SQL}")
[ -n "${source_id}" ] && [ -n "${target_id}" ] || { echo "ERROR: could not read the identity of source or target" >&2; exit 1; }
if [ "${source_id}" = "${target_id}" ]; then
  echo "ERROR: the target is the source database itself (${target_id}). db:sync never writes to it." >&2
  exit 1
fi

# --- 1. Dump + checksums from one read-only snapshot on the mini ----------------
# A run cut off before its cleanup (SIGKILL, a dropped link) leaves a dump behind: sweep those first.
remote_dir=$(on_source 'find /tmp/ -maxdepth 1 -name "argo-sync.*" -user "$(id -un)" -mmin +60 -exec rm -rf {} + 2>/dev/null; umask 077 && mktemp -d /tmp/argo-sync.XXXXXX' </dev/null)
[[ "${remote_dir}" =~ ^/tmp/argo-sync\.[A-Za-z0-9]{6}$ ]] || { echo "ERROR: could not create a work dir on ${SOURCE_SSH}: ${remote_dir}" >&2; exit 1; }
REMOTE_DIR="${remote_dir}"

log "Dumping schema argo from ${SOURCE_SSH} (read-only, snapshot-consistent)..."
# A failing `\!` does not trip ON_ERROR_STOP: the dump.ok marker is what proves pg_dump succeeded.
source_sql >/dev/null <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS snap \gset
\setenv SNAP :snap
\! pg_dump -h 127.0.0.1 -U argo -d shared --schema=argo --clean --if-exists --no-owner --no-privileges --lock-wait-timeout=30s --snapshot="\$SNAP" -f ${REMOTE_DIR}/dump.sql && touch ${REMOTE_DIR}/dump.ok
\o ${REMOTE_DIR}/source.sums
$(cat "${HERE}/db-sync-checksums.sql")
\o
COMMIT;
SQL

on_source "test -f '${REMOTE_DIR}/dump.ok'" </dev/null || { echo "ERROR: pg_dump failed on ${SOURCE_SSH} (no dump.ok marker)" >&2; exit 1; }
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
  # Tables the source no longer has (a dropped or renamed table) would otherwise survive the --clean restore and fail
  # the checksum comparison forever.
  echo "DO \$\$ DECLARE l text; BEGIN SELECT string_agg(format('argo.%I', tablename), ', ') INTO l FROM pg_tables WHERE schemaname = 'argo'; IF l IS NOT NULL THEN EXECUTE 'DROP TABLE ' || l || ' RESTRICT'; END IF; END \$\$;"
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
