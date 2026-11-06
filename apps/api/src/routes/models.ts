import { Elysia } from 'elysia'
import { env } from '../env.js'
import { log } from '../telemetry.js'
import { tracedFetch } from '../lib/traced-fetch.js'

/**
 * `/models/*` — a thin relay to the modelpick server (repo ~/SourceRoot/modelpick), the loopback,
 * read-only service that ranks the IU-reachable models against Artificial Analysis and the agw route
 * table. No service token: the server binds loopback and only reads. Argo derives nothing; the status
 * code and JSON body of the service pass through, and a service that is down answers 503.
 */

const UNAVAILABLE = { error: 'models service unavailable' } as const
const UPSTREAM_TIMEOUT_MS = 30_000

export type ModelsConfig = {
  /** `http://127.0.0.1:<port>` of the modelpick server. */
  baseUrl: string
}

const unavailable = (): Response =>
  new Response(JSON.stringify(UNAVAILABLE), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export function createModelsRoutes(config: ModelsConfig) {
  async function forward(path: string): Promise<Response> {
    try {
      const upstream = await tracedFetch(
        `${config.baseUrl}${path}`,
        { method: 'GET', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) },
        { spanName: `models GET ${path}` },
      )
      const headers = new Headers({ 'Cache-Control': 'no-store' })
      const contentType = upstream.headers.get('content-type')
      if (contentType) headers.set('Content-Type', contentType)
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (error) {
      log.warn('models relay: service unreachable', {
        path,
        'error.message': error instanceof Error ? error.message : 'unknown',
      })
      return unavailable()
    }
  }

  return new Elysia({ prefix: '/models' }).get('/efficiency', () => forward('/api/efficiency'), {
    detail: {
      tags: ['Models'],
      summary: 'Model intelligence, cost and speed per task, with the agw routes',
      description:
        "Which model to use for what, from the modelpick server. `variants` are Artificial Analysis rows (one per model and reasoning effort): `intelligence` is the AA Intelligence Index and `costPerTask` the dollars AA measured to run its index suite once. `tokensPerTaskEst` (cost / output price) and `timePerTaskEstSec` (tokens / speed) are estimates: good for ranking, they read 2-4x high for most models and up to 20x for input-heavy ones. `routes` are the agent-workflows routes (`agw routes`) mapped to a variant (`variantSlug`, null with a `reason` when AA has no row) and whether they bill the listed dollars (`metered`) or run on a subscription quota. `unscored` lists IU-callable models with no AA row. `capturedAt` is the age of the AA snapshot; `routesError` is set when the route table could not be read. Relayed unchanged from modelpick; 503 when it is down. The data is Artificial Analysis'; keep the `source.attribution` line when displaying it.",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: 'The EfficiencyResponse object.' },
        503: { description: '`{ "error": "models service unavailable" }` - modelpick is down.' },
      },
    },
  })
}

export const modelsRoutes = createModelsRoutes({
  baseUrl: `http://127.0.0.1:${env.MODELPICK_PORT}`,
})
