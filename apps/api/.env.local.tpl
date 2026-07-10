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
# (sideclaw's DeepSeek workers + `bun dev` can't share a port). Prod sets no
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

# ── Hermes Chat (docs/HERMES-CHAT-PRD.md) ────────────────────────────────────
# All optional. Local dev does NOT talk to the live Hermes Mac Mini / audio-proxy
# / DeepSeek bridge — these are provisioned on prod in Group 0 and exercised via
# mocked upstreams in tests. Uncomment + wire the op refs once Group 0 lands the
# secrets in op://vps/argo/*.
#
# Hermes agent core — OpenAI-compatible API, bearer = API_SERVER_KEY, port 8642,
# reached over Tailscale from the VPS.
HERMES_BASE_URL=op://vps/argo/HERMES_BASE_URL
HERMES_API_KEY=op://vps/argo/HERMES_API_KEY
#
# HERMES_SESSION_KEY — long-term memory scope (Honcho conversation id). Form:
#   agent:main:slack:group:<channel_id>:<slack_user_id>
# Resolved default: channel C0ASRUD7K1U (#hermes group) + Johannes' Slack user id
# U0AS54FURPE (resolved via Slack `auth.test` with op://common/slack/USER_TOKEN).
# The env.ts default already carries this; override here only to change scope.
# HERMES_SESSION_KEY=agent:main:slack:group:C0ASRUD7K1U:U0AS54FURPE
#
# General AI gateway (/ai/v1/*) — DeepSeek v4 Flash, called DIRECTLY on the IU
# unified endpoint's OpenAI-compatible transport. No LiteLLM bridge, no localhost:
# the same public HTTPS endpoint is reachable from local dev and the prod VPS, so
# one config serves both. The model is EU/GDPR-resident (Azure Spain). The base
# URL already carries the OpenAI `/v1` path; the gateway appends
# `/chat/completions`. Reuses the shared IU creds in op://common/anthropic.
DEEPSEEK_BASE_URL=op://common/anthropic/OPENAI_BASE_URL
DEEPSEEK_API_KEY=op://common/anthropic/API_KEY
DEEPSEEK_MODEL=DeepSeek-V4-Flash
#
# Audio (STT + TTS) — forwarded to the audio-gateway service. Local dev points at
# the gateway's own `bun run dev` on the Mac (:7714); in-cluster prod uses the
# Docker service name (env.ts default / the VPS compose).
AUDIO_GATEWAY_URL=http://localhost:7714
#
# Valkey/Redis for durable/resumable Hermes chat streaming. Points at the shared
# dev Valkey from ~/SourceRoot/vps/compose.dev.yml (exposed on :6379). Empty
# disables durability (plain non-resumable stream). Prod sets redis://redis:6379.
REDIS_URL=redis://localhost:6379
