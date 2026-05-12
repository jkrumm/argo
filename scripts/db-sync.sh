#!/usr/bin/env bash
# Pull a fresh dump of the `argo` schema from the VPS Postgres into the local
# dev Postgres (the shared one in ~/SourceRoot/vps/compose.dev.yml).
#
# Prereqs:
#   - `cd ~/SourceRoot/vps && make up` (local dev infra running)
#   - SSH access to the `vps` host
#   - 1Password CLI signed into the `tkrumm` account

set -euo pipefail

OP_FLAGS=(--account tkrumm)

POSTGRES_DB=$(op read "op://vps/config/POSTGRES_DB" "${OP_FLAGS[@]}")
ARGO_PASSWORD=$(op read "op://vps/argo/DB_PASSWORD" "${OP_FLAGS[@]}")

echo "→ Dumping argo schema from VPS..."
# pg_dump --clean emits a `DROP SCHEMA argo` which the `argo` role can't execute
# (the schema is owned by the cluster superuser, the role only owns tables in it).
# Strip schema-level DDL — the schema already exists locally from `make postgres-setup`,
# we only want to swap its contents.
ssh vps "docker exec postgres pg_dump -U argo -d ${POSTGRES_DB} \
  --schema=argo --clean --if-exists --no-owner --no-privileges" \
  | grep -v -E '^(DROP|CREATE|COMMENT ON|ALTER) SCHEMA' \
  | docker exec -i \
      -e PGPASSWORD="${ARGO_PASSWORD}" \
      postgres psql -U argo -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1

echo "✓ Local argo schema synced from VPS"
