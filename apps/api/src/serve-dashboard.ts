import { realpath, stat } from 'node:fs/promises'
import { basename, extname, resolve, sep } from 'node:path'

const API_PREFIX = '/api'
const RELAY_PATHS: ReadonlySet<string> = new Set(['/v1/traces', '/v1/logs'])
const RELAY_REQUEST_HEADERS = ['content-type', 'content-encoding'] as const
const DEFAULT_RELAY_TIMEOUT_MS = 10_000
const RELAY_MAX_BODY_BYTES = 2 * 1024 * 1024
const RELAY_LOG_INTERVAL_MS = 60_000
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304])

const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'
const CACHE_REVALIDATE = 'no-cache'
const CACHE_SHORT = 'public, max-age=3600'
const REVALIDATED_FILES: ReadonlySet<string> = new Set([
  'index.html',
  'sw.js',
  'registerSW.js',
  'site.webmanifest',
])

export interface ApiHandler {
  handle(request: Request): Response | Promise<Response>
}

export interface DashboardOptions {
  /** Directory holding the built SPA (`vite build` output). */
  dir: string
  /** OTLP base URL the browser SDK's `/v1/traces` + `/v1/logs` posts are relayed to. */
  otlpEndpoint: string
  /**
   * The process's own OTLP exporter headers (`OTEL_EXPORTER_OTLP_HEADERS`: `k=v,k2=v2`, values
   * percent-encoded). The relay sends these upstream and never forwards a client `authorization`.
   */
  otlpHeaders?: string
  /** One deadline per relayed request, covering the client's body read and the upstream call; defaults to 10 s. */
  relayTimeoutMs?: number
}

const notFound = () => new Response('Not Found', { status: 404 })

function cacheControl(urlPath: string): string {
  if (urlPath.startsWith('/assets/')) return CACHE_IMMUTABLE
  const name = basename(urlPath)
  if (REVALIDATED_FILES.has(name) || /^workbox-.*\.js$/.test(name)) return CACHE_REVALIDATE
  return CACHE_SHORT
}

function stripApiPrefix(url: URL): URL {
  const stripped = new URL(url)
  stripped.pathname = url.pathname.slice(API_PREFIX.length) || '/'
  return stripped
}

/** Resolves a URL path to a location inside `root`, or null when it would escape (or is malformed). */
function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const resolved = resolve(root, decoded.replace(/^\/+/, ''))
  if (resolved !== root && !resolved.startsWith(root + sep)) return null
  return resolved
}

/** The real path of a regular file that stays inside `root` after symlinks resolve, else null. */
async function realFileInside(root: string, path: string): Promise<string | null> {
  try {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(path)])
    if (!realTarget.startsWith(realRoot + sep)) return null
    return (await stat(realTarget)).isFile() ? realTarget : null
  } catch {
    return null
  }
}

async function fileResponse(
  method: string,
  path: string,
  cache: string,
  mimeType?: string,
): Promise<Response> {
  const file = Bun.file(path)
  const headers = { 'content-type': mimeType ?? file.type, 'cache-control': cache }
  if (method === 'HEAD') {
    return new Response(null, { headers: { ...headers, 'content-length': String(file.size) } })
  }
  return new Response(file, { headers })
}

async function serveStatic(root: string, request: Request, urlPath: string): Promise<Response> {
  const target = resolveInside(root, urlPath)
  if (!target) return notFound()

  const file = await realFileInside(root, target)
  if (file) return fileResponse(request.method, file, cacheControl(urlPath))

  // A path with an extension is a missing asset, never a client-side route.
  if (extname(urlPath) !== '') return notFound()

  const index = await realFileInside(root, resolve(root, 'index.html'))
  if (!index) return notFound()
  return fileResponse(request.method, index, CACHE_REVALIDATE)
}

/** Parses the OTLP exporter header list (`k=v,k2=v2`, values percent-encoded); malformed pairs are skipped. */
function parseOtlpHeaders(raw: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const part of raw.split(',')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    const name = part.slice(0, separator).trim()
    const rawValue = part.slice(separator + 1).trim()
    let value = rawValue
    try {
      value = decodeURIComponent(rawValue)
    } catch {
      // not percent-encoded after all: use it as written
    }
    if (name !== '') pairs.push([name, value])
  }
  return pairs
}

/**
 * Buffers the request body, or returns null as soon as it exceeds `limit` bytes. Rejects with the
 * signal's reason when `signal` aborts first (a client that sends too slowly).
 */
async function readBodyWithin(
  request: Request,
  limit: number,
  signal: AbortSignal,
): Promise<ArrayBuffer | null> {
  const declared = Number(request.headers.get('content-length'))
  if (declared > limit) return null
  if (!request.body) return new ArrayBuffer(0)

  const chunks: Uint8Array[] = []
  let size = 0
  const reader = request.body.getReader()
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  aborted.catch(() => {})
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch (error) {
    reader.cancel().catch(() => {})
    throw error
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  // The array owns its whole buffer (allocated at `size`), so the cast only narrows ArrayBufferLike.
  return body.buffer as ArrayBuffer
}

type ReportFailure = (urlPath: string, error: unknown) => void

async function relayOtlp(
  endpoint: string,
  request: Request,
  urlPath: string,
  reportFailure: ReportFailure,
  upstreamHeaders: ReadonlyArray<[string, string]>,
  timeoutMs: number,
): Promise<Response> {
  // One deadline for the whole request, started before the body read.
  const signal = AbortSignal.timeout(timeoutMs)

  // The client never chooses the upstream credential: only content headers are copied, then the server's own.
  const headers = new Headers()
  for (const name of RELAY_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  for (const [name, value] of upstreamHeaders) headers.set(name, value)

  let body: ArrayBuffer | null
  try {
    body = await readBodyWithin(request, RELAY_MAX_BODY_BYTES, signal)
  } catch (error) {
    if (!signal.aborted) return new Response('Bad Request', { status: 400 })
    reportFailure(urlPath, error)
    return new Response('Request Timeout', { status: 408 })
  }
  if (!body) return new Response('Payload Too Large', { status: 413 })

  // Plain fetch on purpose: tracing the telemetry relay would emit spans about shipping spans.
  try {
    const upstream = await fetch(`${endpoint.replace(/\/+$/, '')}${urlPath}`, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal,
    })
    const responseHeaders = new Headers()
    const contentType = upstream.headers.get('content-type')
    if (contentType !== null) responseHeaders.set('content-type', contentType)

    // A Response with a null-body status must be constructed without a body.
    const responseBody = NULL_BODY_STATUSES.has(upstream.status)
      ? null
      : await upstream.arrayBuffer()
    return new Response(responseBody, { status: upstream.status, headers: responseHeaders })
  } catch (error) {
    reportFailure(urlPath, error)
    return new Response('OTLP upstream unreachable', { status: 502 })
  }
}

/** Failure reporter: one stderr line per path and minute; error class only, never headers or body. */
function createFailureReporter(): ReportFailure {
  const lastLoggedAt = new Map<string, number>()
  return (urlPath, error) => {
    const now = Date.now()
    const last = lastLoggedAt.get(urlPath)
    if (last !== undefined && now - last < RELAY_LOG_INTERVAL_MS) return
    lastLoggedAt.set(urlPath, now)

    const name = error instanceof Error ? error.name : typeof error
    const code = (error as { code?: unknown } | null)?.code
    const detail = typeof code === 'string' ? `${name} ${code}` : name
    // eslint-disable-next-line no-console
    console.warn(`otlp relay ${urlPath} failed: ${detail}`)
  }
}

/**
 * One-process replacement for nginx + Traefik: `/api/*` goes to the API with the prefix
 * stripped (the API's own 404s stay 404s), the browser SDK's OTLP posts are relayed, and
 * everything else is the built SPA with an index.html fallback for client-side routes.
 *
 * The URL is rewritten before `api.handle`, so routing, auth and OpenTelemetry see the
 * same stripped path they saw behind Traefik.
 */
export function createDashboardHandler(
  api: ApiHandler,
  options: DashboardOptions,
): (request: Request) => Promise<Response> {
  const root = resolve(options.dir)
  const reportFailure = createFailureReporter()
  const upstreamHeaders = parseOtlpHeaders(options.otlpHeaders ?? '')

  return async (request) => {
    const url = new URL(request.url)
    const { pathname } = url

    if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) {
      return api.handle(new Request(stripApiPrefix(url).href, request))
    }

    if (RELAY_PATHS.has(pathname)) {
      if (request.method !== 'POST') return notFound()
      return relayOtlp(
        options.otlpEndpoint,
        request,
        pathname,
        reportFailure,
        upstreamHeaders,
        options.relayTimeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS,
      )
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') return notFound()
    if (pathname.startsWith('/v1/')) return notFound()
    return serveStatic(root, request, pathname)
  }
}
