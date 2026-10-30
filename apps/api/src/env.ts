import { z } from 'zod'

export const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // HTTP listen port. Defaults to 4000 (prod). Local dev overrides to 4040 via
  // apps/api/.env.local.tpl so a local run never collides with another :4000.
  PORT: z.coerce.number().int().default(4000),
  // Listen address. 0.0.0.0 keeps the Docker deployment reachable; the native
  // runtime sets 127.0.0.1 behind its reverse proxy.
  HOST: z.string().default('0.0.0.0'),
  // Built SPA directory. Set = this one process also does what nginx + Traefik
  // did (static files, `/api` prefix strip, OTLP relay — see serve-dashboard.ts).
  // Empty (the default) = API only, routes at the root.
  DASHBOARD_DIR: z.string().default(''),
  // 'true' / 'false' only: z.coerce.boolean() would turn 'false' into true.
  CRONS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  DATABASE_URL: z.string().min(1),
  API_SECRET: z.string().min(1),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://127.0.0.1:4318'),
  OTEL_SERVICE_NAME: z.string().default('argo-api'),
  OTEL_SERVICE_VERSION: z.string().default('0.0.0'),
  SLACK_BOT_TOKEN: z.string().default(''),
  SLACK_READ_TOKEN: z.string().default(''),
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
  GARMIN_API_KEY: z.string().default(''),
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
  // Self-hosted Open-Meteo instance (a stock Open-Meteo binary, same API
  // contract as api.open-meteo.com), e.g. https://weatherorb.mini.jkrumm.com.
  // Empty (the default) keeps the astro window's DWD ICON cloud upstream on
  // the public API, byte-for-byte unchanged. Set to point ONLY that upstream
  // at the self-hosted instance — see `clients/astro-upstreams.ts`. A
  // self-hosted failure degrades the existing dwd-icon health flag exactly
  // like a public-API failure; it never silently falls back to the public API.
  WEATHERORB_SELFHOSTED_URL: z.string().default(''),

  // aiComplete — the model named by DEEPSEEK_MODEL, called directly on the IU
  // unified endpoint's OpenAI-compatible transport. The same public endpoint
  // serves local + prod. DEEPSEEK_BASE_URL must include the OpenAI path
  // prefix; aiComplete appends `/chat/completions`. The model
  // live-verifies as EU-resident (Azure Sweden Central, via IU response headers)
  // — Azure deployment type (Regional/Data-Zone-EU vs Global) is unconfirmed;
  // see modelpick/docs/decisions/hermes-brain.md.
  DEEPSEEK_BASE_URL: z.string().default(''),
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_MODEL: z.string().default('deepseek-v4.1-flash'),
  // Top-level `reasoning_effort` sent with every DEEPSEEK_MODEL call (aiComplete).
  // `high` is the settled choice for this mid-size, single-shot lane — see
  // modelpick/docs/decisions/model-configs.md. Enum is the set live-probed for
  // deepseek-v4.1-flash ("medium" is not accepted).
  DEEPSEEK_REASONING_EFFORT: z.enum(['low', 'high', 'xhigh', 'max']).default('high'),
})

export const env = Env.parse(process.env)
