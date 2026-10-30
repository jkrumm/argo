import { env } from './env.js'
import { registerCronJobs } from './cron/index.js'
import { uptimeKumaClient } from './clients/uptime-kuma.js'
import { runMigrations } from './db/index.js'
import { app, type App } from './app.js'
import { createDashboardHandler } from './serve-dashboard.js'

export { app }
export type { App }
export type { HorizonResponse, VisibilityResponse } from './routes/astro.js'

await runMigrations()

const listenOptions = {
  port: env.PORT,
  hostname: env.HOST,
  // idleTimeout (seconds, Bun max 255) raised from the 10s default so a slow
  // upstream (a long-reasoning completion that holds the socket open with no bytes)
  // isn't dropped mid-flight.
  idleTimeout: 255,
  // Backstop below Bun's 128 MB default: the largest legitimate body is a 1 MB snapshot (MAX_SNAPSHOT_BYTES).
  // Bun rejects an over-limit request before any Elysia handler runs (bare 413, no JSON body).
  maxRequestBodySize: 8 * 1024 * 1024,
}

if (env.DASHBOARD_DIR) {
  // Native runtime: one process serves the SPA, `/api/*` and the OTLP relay (see serve-dashboard.ts).
  app.compile()
  Bun.serve({
    ...listenOptions,
    fetch: createDashboardHandler(app, {
      dir: env.DASHBOARD_DIR,
      otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      otlpHeaders: env.OTEL_EXPORTER_OTLP_HEADERS,
    }),
  })
} else {
  app.listen(listenOptions)
}

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
