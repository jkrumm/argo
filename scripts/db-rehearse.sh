#!/usr/bin/env bash
# Rehearsal of the database cutover: copy Argo's `argo` schema from the VPS into the mini's `shared`
# database and prove it. Wave 6 repeats exactly this for the real cutover.
#
#   make db-rehearse            (secrets arrive through secrets-run + apps/api/.env.local.tpl)
#
# 1. On the VPS, ONE psql session opens a REPEATABLE READ snapshot, runs pg_dump against that snapshot
#    and computes a per-table row count + md5 checksum in the same snapshot, so a live Argo writing in
#    between (snapshot pushes every 10 min) cannot make the two disagree.
# 2. The dump is restored into `shared` as role `argo` (schema-level DDL stripped: the schema exists and
#    argo owns it) inside ONE transaction, which also computes the same checksums on `shared`.
# 3. The transaction COMMITs only when every table matches in rows and md5; otherwise it ROLLBACKs, so a bad
#    copy never replaces the schema and never gets the rehearsal mark.
#
# Excluded from the copy: the five legacy usage tables (usage_record, quota_sample, account_pick,
# iu_portal_cost, iu_portal_total). Usage lives in schema `usage` now; the VPS keeps its copy until the
# cutover wave drops them. Everything else, including the drizzle journal, is copied, so Argo's boot
# migration on the mini finds nothing to apply.
#
# DESTRUCTIVE to `shared.argo`: the restore drops and recreates its tables. A schema comment marks it as a
# rehearsal copy; once the mini serves live traffic the comment is replaced, and this script then refuses
# unless FORCE=1 (the cutover sets it deliberately, after stopping Argo on the mini).
set -euo pipefail

: "${ARGO_DB_PASSWORD:?must be set (secrets-run --env-file=apps/api/.env.local.tpl)}"
: "${POSTGRES_DB:?must be set}"

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
command -v psql >/dev/null 2>&1 || { echo "ERROR: host psql not found (brew install postgresql@18)"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET_DB=shared
TARGET_HOST=127.0.0.1
LEGACY=(usage_record quota_sample account_pick iu_portal_cost iu_portal_total)
MARK='argo rehearsal copy'
WORK="$(mktemp -d)"
# The dump holds the whole schema in plaintext: whatever way the run ends, it must not stay in the VPS container.
cleanup() {
  rm -rf "${WORK}"
  ssh -o BatchMode=yes vps "docker exec postgres rm -f /tmp/argo-rehearse.sql /tmp/argo-rehearse.sums" >/dev/null 2>&1 \
    || echo "WARNING: could not remove /tmp/argo-rehearse.* in the VPS postgres container; remove them by hand" >&2
}
trap cleanup EXIT

target() { PGPASSWORD="${ARGO_DB_PASSWORD}" psql -X -h "${TARGET_HOST}" -U argo -d "${TARGET_DB}" -v ON_ERROR_STOP=1 "$@"; }
log() { echo "[$(date +%H:%M:%S)] $*"; }

# --- Guard -------------------------------------------------------------------
tables_on_target=$(target -qAt -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'argo'")
comment=$(target -qAt -c "SELECT coalesce(obj_description('argo'::regnamespace, 'pg_namespace'), '')")
if [ "${tables_on_target}" != "0" ] && [[ "${comment}" != "${MARK}"* ]] && [ "${FORCE:-}" != "1" ]; then
  echo "ERROR: ${TARGET_DB}.argo holds ${tables_on_target} tables and is not marked '${MARK}': it may be live." >&2
  echo "       Stop Argo on the mini and rerun with FORCE=1 to replace it." >&2
  exit 1
fi

# --- 1. Dump + checksums from one VPS snapshot --------------------------------
EXCLUDES=""; NOT_IN=""
for t in "${LEGACY[@]}"; do EXCLUDES+=" --exclude-table=argo.${t}"; NOT_IN+="'${t}',"; done
NOT_IN="${NOT_IN%,}"

CHECKSUMS_SQL=$(sed "s/@@EXCLUDE@@/${NOT_IN}/" "${HERE}/db-rehearse-checksums.sql")
log "Dumping schema argo from the VPS (snapshot-consistent, legacy usage tables excluded)..."
ssh vps "docker exec -i postgres psql -X -U argo -d '${POSTGRES_DB}' -qAt -v ON_ERROR_STOP=1 >/dev/null" <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS snap \gset
\setenv SNAP :snap
\! umask 077 && pg_dump -U argo -d '${POSTGRES_DB}' --schema=argo --clean --if-exists --no-owner --no-privileges --snapshot="\$SNAP" ${EXCLUDES} -f /tmp/argo-rehearse.sql
\o /tmp/argo-rehearse.sums
${CHECKSUMS_SQL}
\o
COMMIT;
SQL
ssh vps "docker exec postgres cat /tmp/argo-rehearse.sql" > "${WORK}/dump.sql"
ssh vps "docker exec postgres cat /tmp/argo-rehearse.sums" > "${WORK}/source.sums"
[ -s "${WORK}/dump.sql" ] && [ -s "${WORK}/source.sums" ] || { echo "ERROR: empty dump or checksum file from the VPS" >&2; exit 1; }
log "Dump: $(wc -c < "${WORK}/dump.sql" | tr -d ' ') bytes, $(wc -l < "${WORK}/source.sums" | tr -d ' ') tables."

# --- 2. Restore into shared.argo, verified before it commits -------------------
log "Restoring into ${TARGET_DB}.argo and verifying before COMMIT..."
grep -v -E '^(DROP|CREATE|COMMENT ON|ALTER) SCHEMA' "${WORK}/dump.sql" > "${WORK}/restore.sql"
{
  echo '\set ON_ERROR_STOP on'
  echo 'BEGIN;'
  echo "\\i ${WORK}/restore.sql"
  echo "COMMENT ON SCHEMA argo IS '${MARK} $(date -u +%Y-%m-%dT%H:%MZ)';"
  echo "\\o ${WORK}/target.sums"
  echo "${CHECKSUMS_SQL}"
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
  awk -F'|' '{ rows += $2 } END { printf "REHEARSAL PASS: %d tables, %d rows, per-table row counts and md5 identical\n", NR, rows }' "${WORK}/source.sums"
  column -t -s'|' "${WORK}/source.sums"
else
  echo "REHEARSAL FAIL (rolled back, ${TARGET_DB}.argo unchanged): source (<) vs ${TARGET_DB} (>)" >&2
  cat "${WORK}/diff.txt" >&2
  exit 1
fi
