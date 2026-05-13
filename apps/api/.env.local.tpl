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

# Local ClickStack from ~/SourceRoot/vps/compose.dev.yml exposes :4319 as an
# unauthed OTLP receiver (mirrors prod — see vps/docs/observability.md). No
# ingestion key needed in dev.
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4319
OTEL_SERVICE_NAME=argo-api

NODE_ENV=development

# M365 OAuth — local callback. The DCR registration includes both this URI and
# the prod one, so both envs work against the same client_id. The MCP base URL
# uses the env.ts default.
M365_OAUTH_REDIRECT_URI=http://localhost:4000/oauth/m365/callback
