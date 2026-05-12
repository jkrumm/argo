import { trace, SpanStatusCode } from '@opentelemetry/api'
import { Elysia } from 'elysia'
import { z } from 'zod'
import { opentelemetry } from '@elysiajs/opentelemetry'
import { bearer } from '@elysiajs/bearer'
import { openapi } from '@elysiajs/openapi'
import { cors } from '@elysiajs/cors'
import { env } from './env.js'
import { telemetryConfig } from './telemetry.js'
import { healthRoute } from './routes/health.js'
import { ticktickRoutes } from './routes/ticktick.js'
import { uptimeKumaRoutes } from './routes/uptime-kuma.js'
import { dockerHomelabRoutes, dockerVpsRoutes } from './routes/docker.js'
import { summaryRoute } from './routes/summary.js'
import { slackRoutes } from './routes/slack.js'
import { oauthRoutes } from './routes/oauth.js'
import { gmailRoutes } from './routes/gmail.js'
import { calendarRoutes } from './routes/calendar.js'
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
import { userProfileRoutes } from './routes/user-profile.js'
import { registerCronJobs } from './cron/index.js'
import { uptimeKumaClient } from './clients/uptime-kuma.js'
import { runMigrations } from './db/index.js'

await runMigrations()

const authGuard = new Elysia({ name: 'auth' }).use(bearer()).onBeforeHandle(({ bearer, set }) => {
  if (!bearer || bearer !== env.API_SECRET) {
    set.status = 401
    return 'Unauthorized'
  }
})

export const app = new Elysia()
  .use(
    opentelemetry({
      ...telemetryConfig,
      checkIfShouldTrace: (req) => !req.url.includes('/health'),
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
      allowedHeaders: ['Authorization', 'Content-Type'],
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
              'Daily Garmin metrics (HRV, sleep, stress, resting HR), recovery score, training load (ACWR), fitness direction, activity sessions, body-weight log, and user profile. Powers the Garmin Health dashboard page.',
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
            name: 'System',
            description:
              'Discovery, health, observability, and auth plumbing: `/` (API discovery), `/health` (liveness), `/summary` (aggregated infra snapshot), `/query` (read-only SQL), `/oauth/google/*` (Google auth dance for Gmail + Calendar).',
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
        'Personal stack API for Johannes Krumm. Two domain groups (Garmin Health, Strength) plus integration groups (Productivity, Infrastructure, External Data, System). See docs for the full surface.',
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
        'Infrastructure',
        'External Data',
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
  .use(authGuard)
  .use(ticktickRoutes)
  .use(uptimeKumaRoutes)
  .use(dockerHomelabRoutes)
  .use(dockerVpsRoutes)
  .use(slackRoutes)
  .use(gmailRoutes)
  .use(calendarRoutes)
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
  .use(userProfileRoutes)
  .listen(4000)

export type App = typeof app

registerCronJobs()
uptimeKumaClient.start()
// eslint-disable-next-line no-console
console.log('api running on port 4000')

const shutdown = async (): Promise<void> => {
  await uptimeKumaClient.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
