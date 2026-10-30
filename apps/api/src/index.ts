import { env } from './env.js'
import { registerCronJobs } from './cron/index.js'
import { uptimeKumaClient } from './clients/uptime-kuma.js'
import { runMigrations } from './db/index.js'
import { app, type App } from './app.js'

export { app }
export type { App }
export type { HorizonResponse, VisibilityResponse } from './routes/astro.js'

await runMigrations()

app.listen({
  port: env.PORT,
  // idleTimeout (seconds, Bun max 255) raised from the 10s default so a slow
  // upstream (a long-reasoning completion that holds the socket open with no bytes)
  // isn't dropped mid-flight.
  idleTimeout: 255,
  // Global backstop against Bun's 128 MB default request-body size.
  // Bun rejects an over-limit request before any Elysia handler runs (bare 413,
  // no JSON body) — a blunt backstop, not a shaped error response.
  maxRequestBodySize: 50 * 1024 * 1024,
})

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
