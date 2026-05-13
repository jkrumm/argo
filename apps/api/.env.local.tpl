# Local dev — connects to the shared VPS dev Postgres + ClickStack running locally
# from ~/SourceRoot/vps (start with `cd ~/SourceRoot/vps && make up`).
#
# Run from repo root: `bun dev` (auto-wraps with `op run --account tkrumm`).
#
# Note: op run only substitutes values that ARE an op:// reference — it does
# not interpolate refs inside larger strings. So DATABASE_URL is assembled at
# runtime by scripts/dev.sh from the components below.

ARGO_DB_PASSWORD=op://vps/argo/DB_PASSWORD
POSTGRES_DB=op://vps/config/POSTGRES_DB
API_SECRET=op://common/api/SECRET

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
# Local ClickStack rejects un-authed OTLP ingest (401). The HyperDX ingestion
# key is generated at https://hyperdx.test → Team Settings → Ingestion API Keys.
# Stored at op://vps/argo/HYPERDX_API_KEY_LOCAL.
#
# `op run` only substitutes values that ARE an op:// reference — it does NOT
# interpolate refs inside larger strings. So we expose the bare key here and let
# scripts/dev.sh build the OTEL_EXPORTER_OTLP_HEADERS string at runtime.
HYPERDX_API_KEY_LOCAL=op://vps/argo/HYPERDX_API_KEY_LOCAL
OTEL_SERVICE_NAME=argo-api

NODE_ENV=development
