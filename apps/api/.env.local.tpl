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

# Atlassian (Jira) — IU work tenant. Read-only basic auth via PAT.
ATLASSIAN_BASE_URL=op://vps/argo/ATLASSIAN_BASE_URL
JIRA_EMAIL=op://vps/argo/ATLASSIAN_EMAIL
JIRA_API_TOKEN=op://vps/argo/ATLASSIAN_API
JIRA_BOARD_ID=272
