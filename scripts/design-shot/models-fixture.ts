/**
 * `bun scripts/design-shot/models-fixture.ts [LABEL]` — shoots the /models page from a FIXTURE, for the
 * time before modelpick serves `GET /api/efficiency` (or any time the page should be shot without
 * production). Serves the built dashboard (`apps/dashboard/dist`, build it first) and answers
 * `GET /api/models/efficiency` from the committed SYNTHETIC fixture (invented models and numbers; the
 * benchmark data behind the real response is internal use only, and this repo is public). `--live` serves
 * a snapshot of the real response instead, read from `.design-shots/efficiency.local.json` (gitignored;
 * `curl -s localhost:7727/api/efficiency -o .design-shots/efficiency.local.json`). Every other
 * `/api/*` read gets `{}`, so no request leaves the machine. Shoots dark/light x desktop/mobile into
 * `.design-shots/<label>/` (default `models-fixture`) with the same harness as `make design-shot`; the
 * `metric=` routes shoot the chart's other measures and `pick=` opens a lineage so the highlight chip is on record. Bounded: it exits when the shots are done.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { EFFICIENCY_FIXTURE } from '../../apps/dashboard/src/features/models/__fixtures__/efficiency'
import { serveDist } from '../evidence/server'
import { renderBoard } from './board'
import { shootAll } from './shoot'

const ROOT = resolve(import.meta.dirname, '../..')
const DIST = join(ROOT, 'apps/dashboard/dist')
const LOCAL_SNAPSHOT = join(ROOT, '.design-shots/efficiency.local.json')
const ROUTES = [
  '/models',
  '/models?metric=cost',
  '/models?metric=time',
  '/models?metric=tokens',
  '/models?pick=gpt-9-1-vega',
  '/models?callable=false&superseded=true',
]
const live = process.argv.includes('--live')
const label = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'models-fixture'

if (!/^[A-Za-z0-9][\w.-]*$/.test(label)) {
  console.error('usage: bun scripts/design-shot/models-fixture.ts [label] [--live]')
  process.exit(2)
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('apps/dashboard/dist/index.html is missing: build the dashboard first')
  process.exit(1)
}

// The dist server seeds a bearer into index.html; the one used here is a placeholder nothing accepts.
if (live && !existsSync(LOCAL_SNAPSHOT)) {
  console.error(`--live needs ${LOCAL_SNAPSHOT} (curl -s localhost:7727/api/efficiency -o <path>)`)
  process.exit(1)
}
const efficiency: unknown = live ? await Bun.file(LOCAL_SNAPSHOT).json() : EFFICIENCY_FIXTURE

const dist = serveDist(DIST, 'fixture-token')
const json = (body: unknown): Response =>
  Response.json(body, { headers: { 'cache-control': 'no-store' } })

const front = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('fixture server is GET-only', { status: 405 })
    }
    const url = new URL(req.url)
    if (url.pathname === '/api/models/efficiency') return json(efficiency)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return json({})
    const headers = new Headers({ 'accept-encoding': 'identity' })
    const upstream = await fetch(dist.origin + url.pathname + url.search, { headers })
    const out = new Headers(upstream.headers)
    out.delete('content-encoding')
    out.delete('content-length')
    return new Response(upstream.body, { status: upstream.status, headers: out })
  },
})

const outDir = join(ROOT, '.design-shots', label)
await mkdir(join(outDir, 'crops'), { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
let code = 0
try {
  const results = await shootAll(browser, `http://127.0.0.1:${front.port}`, ROUTES, outDir)
  await writeFile(join(outDir, 'index.html'), renderBoard(label, results, []))
  for (const f of results.flatMap((r) => r.failures)) {
    console.error(`[models-fixture] FAILED ${f}`)
    code = 1
  }
  for (const n of results.flatMap((r) => r.notes)) console.log(`[models-fixture] note ${n}`)
  console.log(`[models-fixture] ${join(outDir, 'index.html')}`)
} finally {
  await browser.close().catch(() => undefined)
  void front.stop(true)
  dist.stop()
}
process.exit(code)
