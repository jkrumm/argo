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

# Google (Gmail + Calendar) is INTENTIONALLY NOT wired locally.
#
# Reason: Google OAuth tokens grant ~6 months of Gmail + Calendar read access
# via the refresh token. On prod they live behind container isolation + VPS
# root; on a laptop they would live in plain JSON owned by the user, readable
# by any process running as that user (other dev tooling, IDE extensions,
# stray deps). The marginal value of `bun dev` calling Google directly does
# not justify the extra attack surface.
#
# For Google-backed features (calendar, gmail, /summary), use `bun dev:prod-api`
# instead — the local dashboard proxies /api/* to argo.jkrumm.com which holds
# the prod tokens. The local /calendar endpoint will return 503 under `bun dev`
# and the dashboard alert prompts re-auth (intentional behavior).

# Atlassian (Jira) — IU work tenant. Read-only basic auth via PAT.
ATLASSIAN_BASE_URL=op://vps/argo/ATLASSIAN_BASE_URL
JIRA_EMAIL=op://vps/argo/ATLASSIAN_EMAIL
JIRA_API_TOKEN=op://vps/argo/ATLASSIAN_API
JIRA_BOARD_ID=272

# GitLab — IU work on gitlab.com (iu-group/*). Read-only PAT with scopes
# `read_api` + `read_user` (the latter required for /events).
GITLAB_BASE_URL=https://gitlab.com
GITLAB_TOKEN=op://vps/argo/GITLAB_TOKEN
