import { trace, SpanStatusCode } from '@opentelemetry/api'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { opentelemetry } from '@elysiajs/opentelemetry'
import { openapi } from '@elysiajs/openapi'
import { cors } from '@elysiajs/cors'
import { telemetryConfig } from './telemetry.js'
import { env } from './env.js'
import { healthRoute } from './routes/health.js'
import { ticktickRoutes } from './routes/ticktick.js'
import { uptimeKumaRoutes } from './routes/uptime-kuma.js'
import { dockerHomelabRoutes, dockerVpsRoutes } from './routes/docker.js'
import { summaryRoute } from './routes/summary.js'
import { slackRoutes } from './routes/slack.js'
import { oauthRoutes } from './routes/oauth.js'
import { gmailRoutes } from './routes/gmail.js'
import { calendarRoutes } from './routes/calendar.js'
import { m365Routes } from './routes/m365.js'
import { jiraRoutes } from './routes/jira.js'
import { confluenceRoutes } from './routes/confluence.js'
import { gitlabRoutes } from './routes/gitlab.js'
import { weatherRoutes } from './routes/weather.js'
import { queryRoute } from './routes/query.js'
import { workoutRoutes } from './routes/workouts.js'
import { workoutSetRoutes } from './routes/workout-sets.js'
import { strengthRoutes } from './routes/strength.js'
import { exerciseRoutes } from './routes/exercises.js'
import { dailyMetricsRoutes } from './routes/daily-metrics.js'
import { recoveryRoutes } from './routes/recovery.js'
import { trainingLoadRoutes } from './routes/training-load.js'
import { fitnessDirectionRoutes } from './routes/fitness-direction.js'
import { activitiesRoutes } from './routes/activities.js'
import { weightLogRoutes } from './routes/weight-log.js'
import { skinfoldLogRoutes } from './routes/skinfold-log.js'
import { walkingPadRoutes } from './routes/walking-pad.js'
import { usageRoutes } from './routes/usage.js'
import { readingRoutes } from './routes/reading.js'
import { userProfileRoutes } from './routes/user-profile.js'
import { gymRoutes } from './routes/gym.js'
import { hermesRoutes } from './routes/hermes.js'
import { aiRoutes, audioFileRoutes } from './routes/ai.js'
import { registerCronJobs } from './cron/index.js'
import { uptimeKumaClient } from './clients/uptime-kuma.js'
import { runMigrations } from './db/index.js'
import { authGuard } from './lib/auth-guard.js'

await runMigrations()

export const app = new Elysia()
  .use(
    opentelemetry({
      ...telemetryConfig,
      checkIfShouldTrace: (req) => {
        const u = new URL(req.url)
        return u.pathname !== '/' && u.pathname !== '/health' && !u.pathname.startsWith('/openapi')
      },
    }),
  )
  .onError(({ error }) => {
    const span = trace.getActiveSpan()
    if (span) {
      span.recordException(error as Error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
    }
  })
  .use(
    cors({
      origin: ['https://argo.jkrumm.com', 'https://argo.test', 'http://localhost:7715'],
      // W3C trace context headers must be allowed so distributed tracing
      // survives the browser→API hop (HyperDX injects traceparent on fetch).
      allowedHeaders: ['Authorization', 'Content-Type', 'traceparent', 'tracestate', 'baggage'],
      exposeHeaders: ['x-total-count'],
    }),
  )
  .use(
    openapi({
      mapJsonSchema: { zod: z.toJSONSchema },
      documentation: {
        info: {
          title: 'Argo API',
          version: '1.0.0',
          description:
            'Personal stack API for Johannes Krumm. Powers the Argo dashboard (Garmin Health + Strength Tracker pages) and is consumed as an AI-agent endpoint by Hermes Agent and external tools. Start at `GET /` for discovery. All routes except `/`, `/health`, and `/oauth/*` require `Authorization: Bearer <API_SECRET>`. Served behind Traefik path-strip on `argo.jkrumm.com/api`.',
        },
        servers: [{ url: 'https://argo.jkrumm.com/api', description: 'Argo (VPS, Tailscale)' }],
        components: {
          securitySchemes: {
            BearerAuth: { type: 'http', scheme: 'bearer' },
          },
        },
        tags: [
          {
            name: 'Garmin Health',
            description:
              'Daily Garmin metrics (HRV, sleep, stress, resting HR), recovery score, training load (ACWR), fitness direction, activity sessions, body-weight log, manual skinfold-caliper measurements, and user profile. Powers the Garmin Health dashboard page.',
          },
          {
            name: 'Strength',
            description:
              'Strength training: workouts and sets CRUD, exercise catalog, and analytics under /workouts/summary/* (e1RM, volume, ACWR, PRs, readiness, alignment, deload signal). Powers the Strength Tracker dashboard page.',
          },
          {
            name: 'Productivity',
            description:
              'Personal comms and task management: TickTick projects/tasks, Slack channels/messages/threads, Gmail inbox, Google Calendar events.',
          },
          {
            name: 'M365',
            description:
              'IU Microsoft 365 surface — proxied through the IU MCP server (Microsoft Graph wrapper covering Outlook calendar, mail, Teams chats/channels). The MCP server exposes ~270 Graph operations behind 3 meta-tools (search-tools, get-tool-schema, execute-tool); curated read-only REST endpoints will be added incrementally as use cases land. Tokens are installed via the laptop bootstrap script (`bun m365:auth*`) which POSTs to /m365/seed — see apps/api/CLAUDE.md.',
          },
          {
            name: 'Atlassian',
            description:
              'IU Atlassian Cloud (careerpartner tenant), read-only. **Jira** — work board ("EPOS Team Prometheus", board 272 in project EP): list assigned issues, fetch a single ticket, current/past/future sprints, backlog, arbitrary JQL. **Confluence** — list spaces, CQL search across all content, fetch a page (rendered HTML / storage XHTML / ADF), list children, recently-updated feed. Both share a single Atlassian API token; HTTP Basic auth via Cloud REST APIs (Jira v3 + Agile v1, Confluence v2 + v1 search). No write endpoints.',
          },
          {
            name: 'GitLab',
            description:
              "IU GitLab on gitlab.com (`iu-group/*`), read-only. PAT-auth (scopes `read_api` + `read_user`). Cross-project merge requests (created/assigned/reviewer scopes), per-MR threaded discussions and approval state, per-project commits and releases, and the authenticated user's cross-project push-event feed via /events. Pair `gitlab.username` from /m365/team to walk from a teammate name to their open MRs.",
          },
          {
            name: 'WalkingPad',
            description:
              'KingSmith under-desk treadmill sessions. The local Go daemon `king-smith-walkingpad-mac` records per-second samples in its own SQLite, then POSTs each closed session to /walking-pad/sessions (idempotent on `uuid`). Argo only stores closed-session totals — per-second samples stay on the daemon. Use /walking-pad/sessions to list raw rows and /walking-pad/sessions/summary for windowed totals (steps, distance, duration, kcal).',
          },
          {
            name: 'Usage Tracking',
            description: 'Local AI token/cost telemetry ingested from the usage-tracker.',
          },
          {
            name: 'Infrastructure',
            description:
              'Self-hosted ops: UptimeKuma monitors + status, Docker container state on HomeLab and VPS (containers, stats, logs, summary).',
          },
          {
            name: 'External Data',
            description:
              'Third-party read-only data feeds (currently: weather via Open-Meteo, geocoded).',
          },
          {
            name: 'Hermes Chat',
            description:
              'Thread-first chat surface backed by the Hermes agent core over its OpenAI-compatible API. Argo owns the verbatim transcript (threads + messages in Postgres); Hermes owns compressed agent state per session id. Covers the streaming chat proxy, thread/message reads, and the Hermes-hosted audio range proxy. Powers the Hermes Chat dashboard page.',
          },
          {
            name: 'AI Gateway',
            description:
              'General-purpose, OpenAI-compatible AI gateway (`/ai/v1/*`) backing Argo-side AI features (NOT the Hermes agent): DeepSeek v4 Flash via the LiteLLM EU bridge for titling/classification, plus STT (transcriptions) and TTS (speech) via the audio-gateway.',
          },
          {
            name: 'Reading',
            description:
              'Book reading vertical. Synced daily from Hardcover.app (shelf + book metadata). Generic reading-stat telemetry ingested from a homelab reading-stats job. Phase A: read-only shelf + stats ingest. `/reading` returns the full shelf with a summary; `POST /reading/stats` accepts batch telemetry. Phase C adds status/date write-back to Hardcover: `GET /reading/unmatched` + `POST /reading/match` (confirm a matched book), `POST /reading/reconcile` (run match-scan + write-back), `POST /reading/want-to-read`.',
          },
          {
            name: 'System',
            description:
              'Discovery, health, observability, and auth plumbing: `/` (API discovery), `/health` (liveness), `/summary` (aggregated infra snapshot), `/query` (read-only SQL), `/oauth/google/*` (Google auth dance for Gmail + Calendar). M365 tokens are installed via the laptop bootstrap script — see POST /m365/seed.',
          },
        ],
      },
    }),
  )
  .get(
    '/',
    () => ({
      name: 'Argo API',
      version: '1.0.0',
      description:
        'Personal stack API for Johannes Krumm. Health/training domains (Garmin Health, Strength, WalkingPad) plus integration groups (Productivity, M365, Atlassian, GitLab, Infrastructure, External Data, System). See docs for the full surface.',
      docs: {
        scalar: '/openapi',
        json: '/openapi/json',
      },
      auth: {
        scheme: 'Bearer',
        header: 'Authorization: Bearer <API_SECRET>',
        public: ['GET /', 'GET /health', 'GET /oauth/google/init', 'GET /oauth/google/callback'],
      },
      tags: [
        'Garmin Health',
        'Strength',
        'Productivity',
        'M365',
        'Atlassian',
        'GitLab',
        'WalkingPad',
        'Usage Tracking',
        'Infrastructure',
        'External Data',
        'Hermes Chat',
        'AI Gateway',
        'Reading',
        'System',
      ],
    }),
    {
      response: z.object({
        name: z.string(),
        version: z.string(),
        description: z.string(),
        docs: z.object({
          scalar: z.string().describe('Interactive OpenAPI UI'),
          json: z.string().describe('Raw OpenAPI 3.0 JSON spec'),
        }),
        auth: z.object({
          scheme: z.string(),
          header: z.string(),
          public: z.array(z.string()).describe('Paths that do not require Bearer auth'),
        }),
        tags: z.array(z.string()).describe('Top-level tag taxonomy used in the OpenAPI spec'),
      }),
      detail: {
        tags: ['System'],
        summary: 'API discovery — start here',
        description:
          'Public root endpoint. Returns the API name, version, where to find the OpenAPI spec (Scalar UI + raw JSON), auth scheme, and the list of OpenAPI tag groups. AI agents should call this first to bootstrap, then read /openapi/json for the full surface.',
      },
    },
  )
  .use(healthRoute)
  .use(oauthRoutes)
  .use(audioFileRoutes)
  .use(authGuard)
  .use(ticktickRoutes)
  .use(uptimeKumaRoutes)
  .use(dockerHomelabRoutes)
  .use(dockerVpsRoutes)
  .use(slackRoutes)
  .use(gmailRoutes)
  .use(calendarRoutes)
  .use(m365Routes)
  .use(jiraRoutes)
  .use(confluenceRoutes)
  .use(gitlabRoutes)
  .use(weatherRoutes)
  .use(summaryRoute)
  .use(queryRoute)
  .use(exerciseRoutes)
  .use(workoutRoutes)
  .use(strengthRoutes)
  .use(workoutSetRoutes)
  .use(dailyMetricsRoutes)
  .use(recoveryRoutes)
  .use(trainingLoadRoutes)
  .use(fitnessDirectionRoutes)
  .use(activitiesRoutes)
  .use(weightLogRoutes)
  .use(skinfoldLogRoutes)
  .use(userProfileRoutes)
  .use(gymRoutes)
  .use(walkingPadRoutes)
  .use(usageRoutes)
  .use(readingRoutes)
  .use(hermesRoutes)
  .use(aiRoutes)
  // idleTimeout (seconds, Bun max 255) raised from the 10s default so a long-form
  // TTS request — which holds the socket open with no bytes until the full audio
  // is synthesized + transcoded — isn't dropped mid-flight. Parallel chunk synth
  // keeps real latency well under this; the headroom is a safety margin.
  .listen({ port: env.PORT, idleTimeout: 255 })

export type App = typeof app

registerCronJobs()
uptimeKumaClient.start()
// eslint-disable-next-line no-console
console.log(`api running on port ${env.PORT}`)

const shutdown = async (): Promise<void> => {
  await uptimeKumaClient.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
