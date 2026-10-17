/**
 * Static server for the built dashboard on an ephemeral port: SPA fallback, gzip like production,
 * `/api/*` proxied GET-only to production. The bearer is injected into index.html as a localStorage
 * seed (the zustand `argo-auth` store) so the page is authenticated before the app boots; it exists
 * only in memory and is never logged or written.
 */
import { existsSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'

const API_ORIGIN = 'https://argo.jkrumm.com'
const AUTH_STORAGE_KEY = 'argo-auth'
const COMPRESSIBLE = /\.(?:js|mjs|css|html|json|svg|txt|map|webmanifest)$/
const UPSTREAM_TIMEOUT_MS = 30_000
const DROPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding']

export type DistServer = {
  origin: string
  /** Distinct non-GET requests the app attempted against /api (answered 405, never forwarded). */
  blocked: string[]
  /** Distinct upstream failures seen by the /api proxy (non-2xx, or unreachable as status 502). */
  upstreamErrors: Array<{ method: string; path: string; status: number }>
  stop: () => void
}

/** Bearer from the secrets cache. The value is never printed; failures report the exit code only. */
export async function readToken(): Promise<string> {
  const proc = Bun.spawn(['secrets-run', 'read', 'op://common/api/SECRET'], {
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: 30_000,
  })
  const token = (await new Response(proc.stdout).text()).trim()
  const code = await proc.exited
  if (code !== 0 || !token)
    throw new Error(`secrets-run failed to read the API secret (exit ${code})`)
  return token
}

export function serveDist(distDir: string, token: string): DistServer {
  const root = resolve(distDir)
  const blocked: string[] = []
  const upstreamErrors: DistServer['upstreamErrors'] = []
  // `<` is escaped so a token can never close the script element.
  const seed = `<script>localStorage.setItem(${JSON.stringify(AUTH_STORAGE_KEY)},${JSON.stringify(
    JSON.stringify({ state: { token }, version: 0 }),
  ).replaceAll('<', '\\u003c')})</script>`
  const gzCache = new Map<string, Uint8Array<ArrayBuffer>>()

  const resolveFile = (pathname: string): string | null => {
    const file = normalize(join(root, decodeURIComponent(pathname)))
    if (file !== root && !file.startsWith(root + sep)) return null
    if (existsSync(file) && statSync(file).isFile()) return file
    if (/\.[a-z0-9]+$/i.test(pathname)) return null
    const index = join(root, 'index.html')
    return existsSync(index) ? index : null
  }

  const noteUpstream = (method: string, path: string, status: number): void => {
    if (
      !upstreamErrors.some((e) => e.method === method && e.path === path && e.status === status)
    ) {
      upstreamErrors.push({ method, path, status })
    }
  }

  const proxy = async (req: Request, url: URL): Promise<Response> => {
    const headers = new Headers(req.headers)
    headers.delete('host')
    headers.set('accept-encoding', 'identity')
    const upstream = await fetch(API_ORIGIN + url.pathname + url.search, {
      method: req.method,
      headers,
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })
    if (!upstream.ok) noteUpstream(req.method, url.pathname, upstream.status)
    const out = new Headers(upstream.headers)
    for (const name of DROPPED_RESPONSE_HEADERS) out.delete(name)
    return new Response(upstream.body, { status: upstream.status, headers: out })
  }

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      // The HTML carries the bearer: refuse any Host but our own loopback origin (DNS rebinding).
      // Other processes on loopback are trusted for the run's lifetime.
      if (req.headers.get('host') !== `127.0.0.1:${server.port}`) {
        return new Response('forbidden host', { status: 403 })
      }
      const url = new URL(req.url)
      // Nothing that is not a read is accepted anywhere, API or static.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const attempt = `${req.method} ${url.pathname}`
        if (!blocked.includes(attempt)) {
          blocked.push(attempt)
          console.error(`[evidence] BLOCKED ${attempt} — evidence is GET-only`)
        }
        return new Response('evidence server is GET-only', { status: 405 })
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return proxy(req, url).catch(() => {
          noteUpstream(req.method, url.pathname, 502)
          return new Response('upstream unreachable', { status: 502 })
        })
      }
      let file: string | null
      try {
        file = resolveFile(url.pathname)
      } catch {
        return new Response('bad request', { status: 400 })
      }
      if (!file) return new Response('not found', { status: 404 })

      const headers: Record<string, string> = { 'cache-control': 'no-store' }
      const blob = Bun.file(file)
      let body: Uint8Array<ArrayBuffer> | Blob = blob
      if (file.endsWith('index.html')) {
        const html = await blob.text()
        const seeded = html.replace('<head>', () => `<head>${seed}`)
        if (seeded === html) throw new Error('index.html has no <head> to inject the bearer')
        body = new TextEncoder().encode(seeded) as Uint8Array<ArrayBuffer>
        headers['content-type'] = 'text/html; charset=utf-8'
      } else if (!COMPRESSIBLE.test(file)) {
        return new Response(blob, { headers })
      }
      if (!req.headers.get('accept-encoding')?.includes('gzip')) {
        return new Response(body, { headers })
      }
      const cacheKey = file.endsWith('index.html') ? '' : file
      let gz = cacheKey ? gzCache.get(cacheKey) : undefined
      if (!gz) {
        const raw = body instanceof Blob ? await body.bytes() : body
        gz = Bun.gzipSync(raw, { level: 9 }) as Uint8Array<ArrayBuffer>
        if (cacheKey) gzCache.set(cacheKey, gz)
      }
      headers['content-encoding'] = 'gzip'
      headers['content-type'] ??= blob.type
      return new Response(gz, { headers })
    },
  })
  return {
    origin: `http://127.0.0.1:${server.port}`,
    blocked,
    upstreamErrors,
    stop: () => void server.stop(true),
  }
}
