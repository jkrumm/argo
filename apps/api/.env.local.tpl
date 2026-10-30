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

# Local API listen port. 4040 avoids colliding with the LiteLLM bridge on :4000
# (agent-gateway's DeepSeek workers + `bun dev` can't share a port). Prod sets no
# PORT, so it keeps the env.ts default of 4000.
PORT=4040

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

# Hardcover.app — book shelf sync (optional, daily cron disabled when absent).
HARDCOVER_API_KEY=op://vps/argo/HARDCOVER_API_KEY

# Self-hosted Open-Meteo instance (optional). When set, the astro window's DWD
# ICON cloud upstream (only) is pointed at it instead of api.open-meteo.com —
# see clients/astro-upstreams.ts. Not a secret, no op:// ref needed.
# WEATHERORB_SELFHOSTED_URL=https://weatherorb.mini.jkrumm.com

# aiComplete (classification, verdict sentences) — deepseek-v4.1-flash (env.ts default, effort
# "high"), called DIRECTLY on the IU unified endpoint's OpenAI-compatible
# transport. No LiteLLM bridge, no localhost: the same public HTTPS endpoint is
# reachable from local dev and the prod VPS, so one config serves both. The
# model live-verifies as EU-resident (Azure Sweden Central, via IU response
# headers) — Azure deployment type is unconfirmed; see
# modelpick/docs/decisions/hermes-brain.md. The base URL already carries the
# OpenAI `/v1` path; the gateway appends `/chat/completions`. Reuses the shared
# IU creds in op://common/anthropic. DEEPSEEK_MODEL / DEEPSEEK_REASONING_EFFORT
# are NOT set here — env.ts's default is the single source; override here only
# to test a different model/effort locally.
DEEPSEEK_BASE_URL=op://common/anthropic/OPENAI_BASE_URL
DEEPSEEK_API_KEY=op://common/anthropic/API_KEY
