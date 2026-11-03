import { Elysia } from 'elysia'
import { env } from '../env.js'
import { log } from '../telemetry.js'
import { tracedFetch } from '../lib/traced-fetch.js'

/**
 * `/finance/*` — a transparent relay to `fin serve`, the loopback service in front of the encrypted
 * finance vault (repo ~/SourceRoot/finances, contract docs/service.md). Argo derives nothing: status
 * codes (423 locked, 401 wrong key, 429 throttled, 409 sync running) and JSON bodies pass through
 * unchanged, so the service stays the single source of truth for the vault's state.
 *
 * KEY HYGIENE. `POST /finance/unlock` carries the 64-hex vault key. The body is read as raw text and
 * forwarded verbatim; it is never parsed, validated (a failed validation echoes the offending value),
 * logged, or attached to a span. Spans carry only the method and the path — the query string is
 * dropped too, because a transaction search term is financial data as well.
 */

const UNAVAILABLE = { error: 'finance service unavailable' } as const
const UPSTREAM_TIMEOUT_MS = 30_000
/** A vault key is 64 hex characters; anything near this size is not one. */
const MAX_UNLOCK_BODY_BYTES = 4096

export type FinanceConfig = {
  /** `http://127.0.0.1:<port>` of `fin serve`. */
  baseUrl: string
  /** `FIN_SERVICE_TOKEN`; empty means the service is not configured here. */
  token: string
}

function isWrongKey(text: string): boolean {
  try {
    return (JSON.parse(text) as { error?: unknown } | null)?.error === 'wrong key'
  } catch {
    return false
  }
}

const unavailable = (): Response =>
  new Response(JSON.stringify(UNAVAILABLE), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

/** Status + JSON body of the service, nothing else; the vault data is never cacheable. */
function relay(upstream: Response): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  const contentType = upstream.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)
  const body = upstream.status === 204 || upstream.status === 205 ? null : upstream.body
  return new Response(body, { status: upstream.status, headers })
}

export function createFinanceRoutes(config: FinanceConfig) {
  async function forward(
    method: 'GET' | 'POST',
    path: string,
    options: { search?: string; body?: string } = {},
  ): Promise<Response> {
    if (!config.token) {
      log.warn('finance relay: FIN_SERVICE_TOKEN is not set')
      return unavailable()
    }
    const url = `${config.baseUrl}${path}${options.search ?? ''}`
    try {
      const upstream = await tracedFetch(
        url,
        {
          method,
          headers: {
            Authorization: `Bearer ${config.token}`,
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(options.body === undefined ? {} : { body: options.body }),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        },
        {
          spanName: `finance ${method} ${path.startsWith('/api/') ? '/api/*' : path}`,
          // Overrides the default `url.full`, which would carry the query string.
          attributes: { 'url.full': `${config.baseUrl}${path}`, 'finance.path': path },
        },
      )
      // 401 on /unlock means "wrong key" and is the caller's to see. On any other path it can only
      // mean Argo's service token was refused — a deployment fault that must not read as the
      // browser's own session expiring (the dashboard logs out on 401).
      if (upstream.status === 401) {
        // On /unlock the service's own `{ error: "wrong key" }` is the caller's to see; any other 401
        // there is the same refused token and must not read as a wrong key.
        const text = path === '/unlock' ? await upstream.text() : ''
        if (path === '/unlock' && isWrongKey(text)) return relay(new Response(text, upstream))
        log.error('finance relay: service rejected FIN_SERVICE_TOKEN', undefined, { path })
        if (path !== '/unlock') await upstream.body?.cancel()
        return unavailable()
      }
      return relay(upstream)
    } catch (error) {
      // Message only (connect refused, timeout): the request body is never part of it.
      log.warn('finance relay: service unreachable', {
        path,
        'error.message': error instanceof Error ? error.message : 'unknown',
      })
      return unavailable()
    }
  }

  const security = [{ BearerAuth: [] }]
  const lockedNote =
    'Answers 423 `{ "error": "locked" }` while the vault is locked — unlocking is a human-only step (see POST /finance/unlock); do not retry, tell the user.'
  const unavailableResponse = {
    description:
      '`{ "error": "finance service unavailable" }` — `fin serve` is down or unreachable.',
  }

  return new Elysia({ prefix: '/finance' })
    .get('/status', () => forward('GET', '/status'), {
      detail: {
        tags: ['Finance'],
        summary: 'Finance vault state',
        description:
          'The finance vault lives encrypted on the mini and is opened only by a human with the vault key. Locked: `{ locked: true, unlock_blocked_until }` (`unlock_blocked_until` is an ISO timestamp after repeated wrong keys, else null). Unlocked: `{ locked: false, unlocked_at, idle_lock_at, syncing, last_sync }`, where `last_sync` is `{ started_at, finished_at, ok, error, accounts }` of the latest bank sync or null. Always answers 200 when the service is up, so call this before any /finance/api/* read. The vault locks itself after 30 minutes without an API request. Relayed unchanged from `fin serve`.',
        security,
        responses: {
          200: { description: 'Locked or unlocked state object.' },
          503: unavailableResponse,
        },
      },
    })
    .post(
      '/unlock',
      async ({ request }) => {
        const declared = Number(request.headers.get('content-length') ?? 0)
        const text = declared > MAX_UNLOCK_BODY_BYTES ? '' : await request.text()
        if (
          declared > MAX_UNLOCK_BODY_BYTES ||
          new TextEncoder().encode(text).byteLength > MAX_UNLOCK_BODY_BYTES
        ) {
          return new Response(JSON.stringify({ error: 'request too large' }), {
            status: 413,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          })
        }
        return forward('POST', '/unlock', { body: text })
      },
      {
        // Raw passthrough: no parser, no body schema. A schema would echo the key in a 422.
        parse: 'none',
        detail: {
          tags: ['Finance'],
          summary: 'Unlock the finance vault (HUMAN-ONLY)',
          description:
            'HUMAN-ONLY — agents must never call this endpoint and never handle, request, store or guess the vault key. The user types or autofills the key in the Argo dashboard (1Password), which posts `{ "key": "<64 hex>" }` here. 204 unlocked (also when already unlocked). 401 `{ "error": "wrong key" }`. 429 after 5 wrong keys: unlock is refused for 15 minutes (see `unlock_blocked_until` in GET /finance/status). The key is relayed verbatim to the loopback service and is never logged or attached to telemetry.',
          security,
          responses: {
            204: { description: 'Unlocked.' },
            401: { description: '`{ "error": "wrong key" }`.' },
            413: { description: 'Body too large to be a key.' },
            429: { description: 'Too many wrong keys; retry after `unlock_blocked_until`.' },
            503: unavailableResponse,
          },
        },
      },
    )
    .post('/lock', () => forward('POST', '/lock'), {
      parse: 'none',
      detail: {
        tags: ['Finance'],
        summary: 'Lock the finance vault',
        description:
          'Closes the vault and drops the key from the service immediately. 204 whether or not it was unlocked. Safe and idempotent; use it when finance work is finished. Unlocking again needs a human.',
        security,
        responses: { 204: { description: 'Locked.' }, 503: unavailableResponse },
      },
    })
    .post('/sync', () => forward('POST', '/sync'), {
      parse: 'none',
      detail: {
        tags: ['Finance'],
        summary: 'Start a bank sync',
        description: `Starts a background bank sync (FinTS pull, reconcile, backup) and returns at once with 202. 409 while a run is already active. ${lockedNote} Poll GET /finance/status (\`syncing\`, \`last_sync\`) or GET /finance/sync-runs for the outcome. The service also syncs on unlock when stale, and every 4 hours while unlocked.`,
        security,
        responses: {
          202: { description: 'Sync started.' },
          409: { description: 'A sync is already running.' },
          423: { description: 'Vault locked.' },
          503: unavailableResponse,
        },
      },
    })
    .get(
      '/sync-runs',
      ({ request }) => forward('GET', '/sync-runs', { search: new URL(request.url).search }),
      {
        detail: {
          tags: ['Finance'],
          summary: 'Recent bank sync runs',
          description: `The latest sync runs, newest first: started, finished, ok, error and a per-account summary. \`?limit\` caps the rows. ${lockedNote}`,
          security,
          responses: {
            200: { description: 'Array of sync run rows.' },
            423: { description: 'Vault locked.' },
            503: unavailableResponse,
          },
        },
      },
    )
    .get(
      '/api/*',
      ({ request, params }) => {
        const rest = params['*'] ?? ''
        // No view path contains `%`: encoded dots or slashes could be decoded again further down.
        if (
          rest.includes('%') ||
          rest.split('/').some((segment) => segment === '..' || segment === '.')
        ) {
          return new Response(JSON.stringify({ error: 'invalid path' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          })
        }
        return forward('GET', `/api/${rest}`, { search: new URL(request.url).search })
      },
      {
        detail: {
          tags: ['Finance'],
          summary: 'Finance dashboard data (read-only)',
          description: `Read-only views over the finance vault, relayed to \`fin serve\` with the query string unchanged. Amounts are integer cents, months \`YYYY-MM\`, income positive, spending negative. Paths: \`/finance/api/meta\` (first/last month, accounts, categories — start here), \`report?from&to\`, \`month?month\`, \`events\`, \`merchants?from&to&category\`, \`recurring\`, \`net-worth\`, \`transactions?from&to&category&merchant&search&limit\`, \`tax-year?year\`. ${lockedNote}`,
          security,
          responses: {
            200: { description: 'JSON view rows.' },
            423: { description: 'Vault locked.' },
            503: unavailableResponse,
          },
        },
      },
    )
}

export const financeRoutes = createFinanceRoutes({
  baseUrl: `http://127.0.0.1:${env.FIN_SERVICE_PORT}`,
  token: env.FIN_SERVICE_TOKEN,
})
