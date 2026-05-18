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
})

export const env = Env.parse(process.env)
