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
  // idleTimeout (seconds, Bun max 255) raised from the 10s default so a long-form
  // TTS request — which holds the socket open with no bytes until the full audio
  // is synthesized + transcoded — isn't dropped mid-flight. Parallel chunk synth
  // keeps real latency well under this; the headroom is a safety margin.
  idleTimeout: 255,
  // Global backstop against Bun's 128 MB default request-body size. 50 MB is
  // comfortably above the largest legitimate payload on this API — an audio
  // file uploaded to POST /ai/v1/audio/transcriptions (apps/api/src/routes/ai.ts:278),
  // where a multi-minute voice memo (compressed webm/opus, or a few minutes of
  // uncompressed WAV) tops out well under it — and far below 128 MB, so an
  // oversized body can no longer ride the default all the way to a handler.
  // Bun rejects an over-limit request before any Elysia handler runs (bare 413,
  // no JSON body) — this is a blunt backstop, not a shaped error response; the
  // per-route attachment budget on /hermes/* returns a proper JSON error.
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
