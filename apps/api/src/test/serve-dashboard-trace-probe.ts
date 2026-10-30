// fallow-ignore-file unused-file
// Spawned by serve-dashboard.test.ts: the real app registers a global OpenTelemetry
// provider, which would break other test files sharing the process, so it runs on its own.
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { telemetryConfig } from '../telemetry.js'

const spans = new InMemorySpanExporter()
telemetryConfig.spanProcessors.push(new SimpleSpanProcessor(spans) as never)
const { app } = await import('../app.js')
const { createDashboardHandler } = await import('../serve-dashboard.js')

const handle = createDashboardHandler(app, { dir: '.', otlpEndpoint: 'http://127.0.0.1:1' })
const res = await handle(new Request('http://argo.test/api/workouts'))
await Bun.sleep(100)

const paths = spans
  .getFinishedSpans()
  .map((span) => span.attributes['url.path'])
  .filter((path) => typeof path === 'string')
process.stdout.write(`${JSON.stringify({ status: res.status, paths })}\n`)
process.exit(0)
