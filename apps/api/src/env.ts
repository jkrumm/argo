import { z } from 'zod'

export const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // HTTP listen port. Defaults to 4000 (prod). Local dev overrides to 4040 via
  // apps/api/.env.local.tpl to avoid colliding with the LiteLLM bridge on :4000.
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  API_SECRET: z.string().min(1),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://127.0.0.1:4318'),
  OTEL_SERVICE_NAME: z.string().default('argo-api'),
  OTEL_SERVICE_VERSION: z.string().default('0.0.0'),
  SLACK_BOT_TOKEN: z.string().default(''),
  SLACK_USER_TOKEN: z.string().default(''),
  UPTIME_KUMA_URL: z.string().default(''),
  UPTIME_KUMA_USERNAME: z.string().default('admin'),
  UPTIME_KUMA_PASSWORD: z.string().default(''),
  TICKTICK_API_KEY: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OAUTH_REDIRECT_URI: z
    .string()
    .default('https://argo.jkrumm.com/api/oauth/google/callback'),
  // Comma-separated allowlist of Google account emails permitted to complete
  // the OAuth flow. When set, the callback verifies the granting account's
  // email against this list and refuses to save tokens otherwise. Empty
  // string disables the check (suitable only for fully private deployments).
  GOOGLE_ALLOWED_EMAIL: z.string().default(''),
  M365_MCP_BASE_URL: z
    .string()
    .default('https://iu-m365-mcp.kindmushroom-c7823c35.westeurope.azurecontainerapps.io'),
  DATA_DIR: z.string().default('./data'),
  GARMIN_COLLECTOR_URL: z.string().default(''),
  GARMIN_COLLECTOR_TOKEN: z.string().default(''),
  DOCKER_HOMELAB_URL: z.string().default(''),
  HOMELAB_TAILSCALE_IP: z.string().default(''),
  DOCKER_VPS_URL: z.string().default('http://socket-proxy-monitoring:2375'),
  GARMIN_BACKFILL_DAYS: z.coerce.number().default(7),
  GARMIN_ACTIVITIES_INITIAL_BACKFILL_DAYS: z.coerce.number().default(60),
  GARMIN_HEARTBEAT_URL: z.string().default(''),
  ATLASSIAN_BASE_URL: z.string().default(''),
  JIRA_EMAIL: z.string().default(''),
  JIRA_API_TOKEN: z.string().default(''),
  JIRA_BOARD_ID: z.coerce.number().int().default(272),
  JIRA_DEFAULT_PROJECT_KEY: z.string().default('EP'),
  JIRA_DEFAULT_TEAM_OPTION_ID: z.string().default('10561'),
  GITLAB_BASE_URL: z.string().default('https://gitlab.com'),
  GITLAB_TOKEN: z.string().default(''),
  HARDCOVER_API_KEY: z.string().default(''),

  // ── Hermes Chat (see docs/HERMES-CHAT-PRD.md) ─────────────────────────────
  // All optional so the API boots in test/CI without live cross-machine
  // upstreams (Hermes Mac Mini, audio-proxy, IU AI endpoint). Real values are
  // provisioned in Group 0 (op://vps/argo/*). Group 1 wires config only — no
  // behavior; handlers land in Groups 2–3.

  // Hermes agent core over Tailscale (port 8642). HERMES_BASE_URL keeps the
  // `/v1` suffix historically used for the (now-retired) OpenAI-compatible
  // path, e.g. `http://<tailnet-host>:8642/v1` — but it is really just the
  // origin: the liveness check derives `/health` from it, and the named-event
  // chat API (`lib/hermes-upstream.ts`'s `ensureHermesSession` /
  // `openHermesChatStream`, hitting `/api/sessions*`) derives its origin the
  // same way. `/api/*` is NOT under `/v1` — a leading slash on `new URL(path,
  // HERMES_BASE_URL)` resets the path and drops the suffix, which is exactly
  // what both call sites rely on.
  HERMES_BASE_URL: z.string().default(''),
  HERMES_API_KEY: z.string().default(''),
  // OpenAI `model` field sent to Hermes. The agent maps/ignores it; kept
  // configurable so a future multi-persona Hermes can be addressed.
  HERMES_MODEL: z.string().default('hermes'),
  // Long-term memory scope (Honcho conversation id). Default resolves to the
  // Slack #hermes group key for Johannes — see .env.local.tpl for derivation.
  HERMES_SESSION_KEY: z.string().default('agent:main:slack:group:C0ASRUD7K1U:U0AS54FURPE'),

  // General AI gateway (/ai/v1/*) — DeepSeek v4 Flash, called directly on the IU
  // unified endpoint's OpenAI-compatible transport (no LiteLLM bridge). The same
  // public endpoint serves local + prod. DEEPSEEK_BASE_URL must include the
  // OpenAI path prefix; the gateway appends `/chat/completions`. The model is
  // EU/GDPR-resident (Azure Spain), so routing stays GDPR-compliant.
  DEEPSEEK_BASE_URL: z.string().default(''),
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_MODEL: z.string().default('DeepSeek-V4-Flash'),

  // Audio (STT + TTS) — forwarded to the audio-gateway service (audio-gateway:7714).
  // The gateway is the single source of truth for all audio processing; Argo proxies.
  // Defaults to the in-cluster Docker service name; override for local dev if needed.
  AUDIO_GATEWAY_URL: z.string().default('http://audio-gateway:7714'),

  // Valkey/Redis URL for durable/resumable Hermes chat streaming (resumable-stream
  // pub/sub + sentinel key). Empty DISABLES durability — POST /hermes/chat then
  // falls back to a plain non-resumable stream, and a dropped client connection
  // loses the in-flight turn (the v1 behavior). Dev: redis://localhost:6379
  // (vps/compose.dev.yml); prod: redis://redis:6379 (Valkey container named `redis`
  // on valkey-net). Durability survives client disconnect/reconnect, NOT a server
  // restart (chunks buffer in-process) — acceptable for personal chat + rolling deploys.
  REDIS_URL: z.string().default(''),
})

export const env = Env.parse(process.env)
