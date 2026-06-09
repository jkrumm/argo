import { z } from 'zod'

export const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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

  // ── Hermes Chat (see docs/HERMES-CHAT-PRD.md) ─────────────────────────────
  // All optional so the API boots in test/CI without live cross-machine
  // upstreams (Hermes Mac Mini, audio-proxy, IU AI endpoint). Real values are
  // provisioned in Group 0 (op://vps/argo/*). Group 1 wires config only — no
  // behavior; handlers land in Groups 2–3.

  // Hermes agent core — OpenAI-compatible API over Tailscale (port 8642).
  // HERMES_BASE_URL must include the OpenAI path prefix (e.g.
  // `http://<tailnet-host>:8642/v1`); the provider appends `/chat/completions`.
  // The liveness check derives `/health` from the URL origin.
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

  // audio-proxy (:7716) — STT (transcriptions) + TTS (speech). Like the others,
  // AUDIO_PROXY_BASE_URL includes the OpenAI path prefix (e.g.
  // `http://<host>:7716/v1`); the gateway appends `/audio/transcriptions` and
  // `/audio/speech`. AUDIO_PROXY_API_KEY is the optional bearer the proxy gates
  // on (empty = the proxy's auth is disabled, so no header is sent).
  AUDIO_PROXY_BASE_URL: z.string().default(''),
  AUDIO_PROXY_API_KEY: z.string().default(''),
})

export const env = Env.parse(process.env)
