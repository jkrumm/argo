#!/usr/bin/env bash
# Run the API integration suite against a throwaway Postgres database.
# Invoked by `bun test:api`. The admin connection is the Postgres superuser:
#   - default (no ARGO_TEST_PG_PASSWORD): the unix socket in /tmp (ARGO_TEST_PG_SOCKET_DIR overrides) as the
#     OS user, no password. That is how the mini's native cluster admits its superuser (pg_hba `local ... trust`;
#     every TCP line is password-only and the superuser has no password).
#   - ARGO_TEST_PG_USER and ARGO_TEST_PG_PASSWORD both set: TCP on localhost:5432 with them (a service
#     container). ARGO_TEST_PG_HOST / ARGO_TEST_PG_PORT override the address.
#
# The app role `argo` can only SELECT on schema `usage` (owned by usage-tracker), so tests that seed
# usage rows must be admin. This script therefore:
#   1. creates a scratch database `argo_test_<12 hex>` (the only name it ever creates or drops),
#   2. applies usage-tracker's plain-SQL migrations (schema `usage`, same as its src/pg/migrate.ts:
#      sorted NNNN_*.sql, one transaction each; roles are cluster-wide and left alone),
#   3. creates schema `argo` and points DATABASE_URL at the database as admin (the tables come from the
#      tests' own runMigrations()),
#   4. runs `bun test --cwd apps/api "$@"`, and drops the database again.
#
# USAGE_MIGRATIONS_DIR overrides the migrations directory.

set -euo pipefail

MIGRATIONS_DIR="${USAGE_MIGRATIONS_DIR:-$HOME/SourceRoot/usage-tracker/migrations/pg}"
PG_PORT="${ARGO_TEST_PG_PORT:-5432}"
if [[ -n "${ARGO_TEST_PG_PASSWORD:-}" ]]; then
  : "${ARGO_TEST_PG_USER:?must be set together with ARGO_TEST_PG_PASSWORD}"
  PG_HOST="${ARGO_TEST_PG_HOST:-localhost}"
  PG_USER="$ARGO_TEST_PG_USER"
  export PGPASSWORD="$ARGO_TEST_PG_PASSWORD"
else
  PG_HOST="${ARGO_TEST_PG_SOCKET_DIR:-/tmp}"
  PG_USER="${ARGO_TEST_PG_USER:-$(id -un)}"
  unset PGPASSWORD
fi

if [[ ! -d "$MIGRATIONS_DIR" ]] || ! compgen -G "$MIGRATIONS_DIR/[0-9][0-9][0-9][0-9]_*.sql" >/dev/null; then
  echo "test.sh: no usage-tracker migrations in $MIGRATIONS_DIR (set USAGE_MIGRATIONS_DIR); the usage integration tests need the usage schema" >&2
  exit 1
fi
command -v psql >/dev/null || { echo "test.sh: psql not found" >&2; exit 1; }

# psql takes a host that starts with "/" as the socket directory.
psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$@"; }

# The admin role can drop anything on the shared server, so only names generated here reach DDL.
assert_scratch_name() {
  [[ "$1" =~ ^argo_test_[0-9a-f]{12}$ ]] || { echo "test.sh: refusing to create or drop database '$1': not argo_test_<12 hex>" >&2; exit 1; }
}

DB_NAME="argo_test_$(openssl rand -hex 6)"
assert_scratch_name "$DB_NAME"

cleanup() {
  assert_scratch_name "$DB_NAME"
  psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" >/dev/null 2>&1 || \
    echo "test.sh: could not drop scratch database $DB_NAME" >&2
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if ! psql_admin -d postgres -c "CREATE DATABASE $DB_NAME" 2>/dev/null; then
  echo "test.sh: cannot create a scratch database on $PG_HOST:$PG_PORT as $PG_USER (Postgres down? see ~/SourceRoot/dotfiles/docs/postgres.md)" >&2
  exit 1
fi

# `argo` is what make postgres-setup provisions before the app's first migration (runMigrations() needs it to exist).
# The app role runs with search_path=argo; some migrations use unqualified index names, so the admin gets the same.
psql_admin -d "$DB_NAME" -c "CREATE SCHEMA argo" -c "CREATE SCHEMA usage" -c "ALTER DATABASE $DB_NAME SET search_path = argo"
for file in $(ls "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql | sort); do
  psql_admin -d "$DB_NAME" --single-transaction -f "$file" >/dev/null
done

if [[ "$PG_HOST" == /* ]]; then
  # postgres.js cannot take a socket directory from a URL (a percent-encoded "/tmp" host stays a DNS name);
  # an empty URL host falls back to PGHOST, and a host starting with "/" is then the socket directory
  # (path <dir>/.s.PGSQL.<port>). User and port come from the environment the same way.
  export PGHOST="$PG_HOST" PGPORT="$PG_PORT" PGUSER="$PG_USER"
  export DATABASE_URL="postgresql:///${DB_NAME}?schema=argo"
else
  urlenc() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }
  export DATABASE_URL="postgresql://$(urlenc "$PG_USER"):$(urlenc "$PGPASSWORD")@${PG_HOST}:${PG_PORT}/${DB_NAME}?schema=argo"
fi
export API_SECRET="${API_SECRET:-argo-test-secret}"

status=0
bun test --cwd apps/api "$@" || status=$?
exit "$status"
