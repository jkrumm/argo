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
import { weatherRoutes } from './routes/weather.js'
import { queryRoute } from './routes/query.js'
import { workoutRoutes } from './routes/workouts.js'
import { workoutSetRoutes } from './routes/workout-sets.js'
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
            'Personal stack API (argo) — health metrics, strength tracking, TickTick tasks, UptimeKuma monitoring, Docker containers, Slack messaging. All endpoints except /health require Bearer token authentication. Served behind Traefik path-strip on argo.jkrumm.com/api.',
        },
        servers: [{ url: 'https://argo.jkrumm.com/api', description: 'Argo (VPS, Tailscale)' }],
        components: {
          securitySchemes: {
            BearerAuth: { type: 'http', scheme: 'bearer' },
          },
        },
        tags: [
          {
            name: 'Summaries',
            description:
              'Server-computed aggregates and time series — same numbers consumed by the dashboard and AI agents',
          },
          { name: 'workouts', description: 'Strength training workouts and sets' },
          { name: 'daily-metrics', description: 'Garmin daily health metrics' },
          { name: 'weight-log', description: 'Body weight log' },
          { name: 'activities', description: 'Garmin activities' },
          { name: 'exercises', description: 'Exercise catalog' },
          { name: 'user-profile', description: 'User profile' },
          { name: 'admin', description: 'Cron, query, internal' },
        ],
      },
    }),
  )
  .get('/openapi.json', ({ redirect }) => redirect('/openapi/json'))
  .use(healthRoute)
  .use(oauthRoutes)
  .use(authGuard)
  .use(ticktickRoutes)
  .use(uptimeKumaRoutes)
  .use(dockerHomelabRoutes)
  .use(dockerVpsRoutes)
  .use(slackRoutes)
  .use(gmailRoutes)
  .use(weatherRoutes)
  .use(summaryRoute)
  .use(queryRoute)
  .use(exerciseRoutes)
  .use(workoutRoutes)
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
