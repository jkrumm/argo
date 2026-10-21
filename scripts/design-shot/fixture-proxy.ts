/**
 * Fixture proxy for `basalt-ui shot --dist <dist> --api /api=http://127.0.0.1:<port>`: shoots the
 * body-composition states production data cannot show (a goal weight set; at the goal; a fresh weigh-in
 * series; a single weigh-in with no rate; one skinfold session; two sessions under 3 d apart; several
 * sessions with the history table). Binds 127.0.0.1 only, GET/HEAD only (405 otherwise).
 *
 * The fixtures are SYNTHETIC — invented numbers, dates relative to today so they land in the default
 * 90d window. Every other `/api/*` read (the weight log among them) is forwarded to production with
 * the incoming headers (the shot harness supplies the bearer), so the shots still carry real personal
 * data and follow the `.design-shots/` rules: never committed or uploaded. Header values are never
 * logged and nothing is written to disk. `weight-fresh` and `weight-no-rate` replace the weight log
 * with synthetic weigh-ins too; `at-goal` sets the goal to production's own current weight.
 *
 *   bun scripts/design-shot/fixture-proxy.ts --fixture <fixture> [--port <n>]
 *   fixtures: goal | at-goal | weight-fresh | weight-no-rate | skinfold-one | skinfold-close | skinfold-many | all
 */
import { parseArgs } from 'node:util'

const API_ORIGIN = 'https://argo.jkrumm.com'
const UPSTREAM_TIMEOUT_MS = 30_000
const DROPPED_REQUEST_HEADERS = ['host', 'if-none-match', 'if-modified-since']
const DROPPED_RESPONSE_HEADERS = ['etag', 'content-encoding', 'content-length', 'transfer-encoding']
const FIXTURES = [
  'goal',
  'at-goal',
  'weight-fresh',
  'weight-no-rate',
  'skinfold-one',
  'skinfold-close',
  'skinfold-many',
  'all',
] as const
const SYNTHETIC_GOAL_KG = 71.0
const DAY_MS = 86_400_000

type Fixture = (typeof FIXTURES)[number]
type Site = 'abdominal' | 'suprailiac'
type Session = { date: string; abdominal: number; suprailiac: number }
type Row = { id: number; date: string; site: Site; value_mm: number; created_at: string }

const round1 = (n: number): number => Math.round(n * 10) / 10
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length

const isoDay = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10)

/** Oldest first. Gently reducing: abdominal 22 -> ~18.5 mm, suprailiac 15 -> ~12.3 mm. */
function manySessions(): Session[] {
  const daysAgo = [78, 67, 56, 45, 34, 23, 12, 3]
  const abdominal = [22.0, 21.4, 20.9, 20.1, 19.8, 19.2, 18.9, 18.5]
  const suprailiac = [15.0, 14.6, 14.4, 13.7, 13.5, 13.0, 12.6, 12.3]
  return daysAgo.map((d, i) => ({
    date: isoDay(d),
    abdominal: abdominal[i]!,
    suprailiac: suprailiac[i]!,
  }))
}

function oneSession(): Session[] {
  return [{ date: isoDay(3), abdominal: 20.4, suprailiac: 13.6 }]
}

/** Two sessions two days apart: a span under 3 d, so no rate. */
function closeSessions(): Session[] {
  return [
    { date: isoDay(4), abdominal: 20.8, suprailiac: 13.9 },
    { date: isoDay(2), abdominal: 20.4, suprailiac: 13.6 },
  ]
}

const sessionAverage = (s: Session): number => round1((s.abdominal + s.suprailiac) / 2)

/** Least-squares slope in mm/week over the trailing 28 days, null under 2 points or a span < 3 days. */
function ratePerWeek(sessions: Session[]): number | null {
  const last = Date.parse(sessions.at(-1)!.date)
  const window = sessions.filter((s) => Date.parse(s.date) >= last - 28 * DAY_MS)
  const points = (window.length >= 2 ? window : sessions).map((s) => ({
    x: (Date.parse(s.date) - Date.parse(sessions[0]!.date)) / DAY_MS,
    y: sessionAverage(s),
  }))
  if (points.length < 2) return null
  const span = points.at(-1)!.x - points[0]!.x
  if (span < 3) return null
  const mx = mean(points.map((p) => p.x))
  const my = mean(points.map((p) => p.y))
  const num = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0)
  const den = points.reduce((a, p) => a + (p.x - mx) ** 2, 0)
  return den === 0 ? null : (num / den) * 7
}

function summaryFixture(sessions: Session[]) {
  const latest = sessions.at(-1)!
  const averages = sessions.map(sessionAverage).toReversed()
  const ma = (n: number) => round1(mean(averages.slice(0, n)))
  const delta = (n: number) => {
    const slice = averages.slice(0, n)
    return slice.length >= 2 ? round1(slice[0]! - slice.at(-1)!) : null
  }
  const ma7 = ma(7)
  const ma30 = ma(30)
  const trend = ma7 > ma30 * 1.005 ? 'up' : ma7 < ma30 * 0.995 ? 'down' : 'flat'
  const rate = ratePerWeek(sessions)
  const mmPerWeek = rate === null ? null : Math.round(rate * 100) / 100
  const direction =
    mmPerWeek === null || Math.abs(mmPerWeek) < 0.1
      ? 'stable'
      : mmPerWeek < 0
        ? 'reducing'
        : 'increasing'
  return {
    current: averages[0]!,
    ma7,
    ma30,
    trend,
    weeklyDelta: delta(7),
    monthlyDelta: delta(30),
    mmPerWeek,
    direction,
    perSite: [
      { site: 'abdominal', current: latest.abdominal },
      { site: 'suprailiac', current: latest.suprailiac },
    ],
  }
}

function seriesFixture(sessions: Session[]) {
  return {
    points: sessions.map((s) => ({
      date: s.date,
      average: sessionAverage(s),
      readings: [
        { site: 'abdominal', valueMm: s.abdominal },
        { site: 'suprailiac', valueMm: s.suprailiac },
      ],
    })),
  }
}

/** One row per site per date, ids ascending with date, newest first unless `order=asc`. */
function listFixture(sessions: Session[], query: URLSearchParams) {
  const rows: Row[] = sessions
    .flatMap((s, i) => [
      { id: i * 2 + 1, date: s.date, site: 'abdominal', value_mm: s.abdominal },
      { id: i * 2 + 2, date: s.date, site: 'suprailiac', value_mm: s.suprailiac },
    ])
    .map((r) => ({ ...r, site: r.site as Site, created_at: `${r.date}T07:30:00.000Z` }))
  const order = query.get('order') === 'asc' ? 1 : -1
  const sorted = rows.toSorted((a, b) => order * (a.date.localeCompare(b.date) || a.id - b.id))
  const limit = Math.max(1, Number(query.get('limit')) || 50)
  const page = Math.max(1, Number(query.get('page')) || 1)
  return { data: sorted.slice((page - 1) * limit, page * limit), total: rows.length }
}

type WeighIn = { date: string; weightKg: number }

/** Oldest first, ending today: every other day over 60 d, drifting down ~0.2 kg/week. */
function freshWeighIns(): WeighIn[] {
  const out: WeighIn[] = []
  for (let d = 60; d >= 0; d -= 2) {
    const wobble = ((d * 7) % 5) / 10 - 0.2
    out.push({ date: isoDay(d), weightKg: round1(74.2 - ((60 - d) / 7) * 0.2 + wobble) })
  }
  return out
}

function singleWeighIn(): WeighIn[] {
  return [{ date: isoDay(0), weightKg: 73.4 }]
}

/** Least-squares kg/week over the trailing 28 d, null under 2 points — the API's own rule. */
function weightRate(points: WeighIn[]): number | null {
  const last = Date.parse(points.at(-1)!.date)
  const window = points.filter((p) => Date.parse(p.date) >= last - 28 * DAY_MS)
  if (window.length < 2) return null
  const xs = window.map((p) => (Date.parse(p.date) - last) / DAY_MS)
  const ys = window.map((p) => p.weightKg)
  const mx = mean(xs)
  const my = mean(ys)
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  if (den === 0) return null
  return (xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / den) * 7
}

/** A subset of `classifyWeightPhase` (apps/api/src/lib/strength-formulas.ts): the neutral cases exactly, the lean and standard
 * tiers on both sides, no aggressive tier (the fixtures never reach one). */
function weightPhase(kgPerWeek: number | null): { phase: string; intensity: string } {
  if (kgPerWeek === null) return { phase: 'maintaining', intensity: 'No trend' }
  if (Math.abs(kgPerWeek) < 0.1) return { phase: 'maintaining', intensity: 'Maintenance' }
  if (kgPerWeek < 0)
    return { phase: 'losing', intensity: Math.abs(kgPerWeek) < 0.4 ? 'Lean cut' : 'Standard cut' }
  return { phase: 'gaining', intensity: kgPerWeek < 0.3 ? 'Lean bulk' : 'Standard bulk' }
}

function weightSummaryFixture(points: WeighIn[]) {
  const newest = points.map((p) => p.weightKg).toReversed()
  const ma = (n: number) => round1(mean(newest.slice(0, n)))
  const delta = (n: number) => {
    const slice = newest.slice(0, n)
    return slice.length >= 2 ? round1(slice[0]! - slice.at(-1)!) : null
  }
  const ma7 = ma(7)
  const ma30 = ma(30)
  const rate = weightRate(points)
  const kgPerWeek = rate === null ? null : Math.round(rate * 100) / 100
  return {
    current: newest[0]!,
    ma7,
    ma30,
    trend: ma7 > ma30 * 1.005 ? 'up' : ma7 < ma30 * 0.995 ? 'down' : 'flat',
    weeklyDelta: delta(7),
    monthlyDelta: delta(30),
    kgPerWeek,
    ...weightPhase(kgPerWeek),
  }
}

function parseFixture(): { fixture: Fixture; port: number } {
  const { values } = parseArgs({
    options: { fixture: { type: 'string' }, port: { type: 'string' } },
    strict: true,
  })
  const fixture = FIXTURES.find((f) => f === values.fixture)
  if (!fixture) {
    console.error(`usage: fixture-proxy.ts --fixture ${FIXTURES.join('|')} [--port <n>]`)
    process.exit(2)
  }
  const port = Number(values.port ?? 0)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    console.error('--port must be an integer between 0 and 65535')
    process.exit(2)
  }
  return { fixture, port }
}

const { fixture, port } = parseFixture()
const withGoal = fixture === 'goal' || fixture === 'all'
const sessions =
  fixture === 'skinfold-one'
    ? oneSession()
    : fixture === 'skinfold-close'
      ? closeSessions()
      : fixture === 'skinfold-many' || fixture === 'all'
        ? manySessions()
        : null
const weighIns =
  fixture === 'weight-fresh'
    ? freshWeighIns()
    : fixture === 'weight-no-rate'
      ? singleWeighIn()
      : null

const noStore = { 'cache-control': 'no-store' }

async function forward(req: Request, apiPath: string, search: string): Promise<Response> {
  const headers = new Headers(req.headers)
  for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name)
  headers.set('accept-encoding', 'identity')
  const upstream = await fetch(API_ORIGIN + apiPath + search, {
    method: req.method,
    headers,
    signal: AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
  })
  const out = new Headers(upstream.headers)
  for (const name of DROPPED_RESPONSE_HEADERS) out.delete(name)
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

/** Production profile with only the goal replaced; a non-2xx upstream profile passes through untouched.
 * `goalKg` null: the goal is production's own current weight (the at-goal state), 502 when it cannot be read. */
async function profileWithGoal(
  req: Request,
  apiPath: string,
  search: string,
  goalKg: number | null,
): Promise<Response> {
  const goal = goalKg ?? (await productionCurrentKg(req))
  if (goal === null)
    return new Response('upstream /weight-log/summary has no current weight', { status: 502 })
  const upstream = await forward(req, apiPath, search)
  if (!upstream.ok || req.method === 'HEAD') return upstream
  let profile: Record<string, unknown>
  try {
    profile = (await upstream.json()) as Record<string, unknown>
  } catch {
    return new Response('upstream /user-profile answered non-JSON', { status: 502 })
  }
  const headers = new Headers(upstream.headers)
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify({ ...profile, goal_weight_kg: goal }), {
    status: upstream.status,
    headers,
  })
}

/** Production's all-time current weight, fetched with an explicit GET whatever the page's method. */
async function productionCurrentKg(req: Request): Promise<number | null> {
  const headers = new Headers(req.headers)
  for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name)
  headers.set('accept-encoding', 'identity')
  const upstream = await fetch(`${API_ORIGIN}/api/weight-log/summary?window=all`, {
    headers,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!upstream.ok) return null
  const body: unknown = await upstream.json().catch(() => null)
  if (typeof body !== 'object' || body === null || !('current' in body)) return null
  return typeof body.current === 'number' ? body.current : null
}

function fixtureResponse(route: string, url: URL): Response | null {
  if (weighIns && route === '/weight-log/summary')
    return Response.json(weightSummaryFixture(weighIns), { headers: noStore })
  if (weighIns && route === '/weight-log/series')
    return Response.json({ points: weighIns }, { headers: noStore })
  if (!sessions) return null
  if (route === '/skinfold-log/summary')
    return Response.json(summaryFixture(sessions), { headers: noStore })
  if (route === '/skinfold-log/series')
    return Response.json(seriesFixture(sessions), { headers: noStore })
  if (route === '/skinfold-log')
    return Response.json(listFixture(sessions, url.searchParams), { headers: noStore })
  return null
}

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  // Bun's 10 s default cuts slow upstream reads (M365, Google) before UPSTREAM_TIMEOUT_MS does.
  idleTimeout: Math.ceil(UPSTREAM_TIMEOUT_MS / 1000) + 5,
  async fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('fixture proxy is GET-only', { status: 405 })
    }
    const url = new URL(req.url)
    // `basalt-ui shot --api /api=<origin>` keeps the /api prefix; a prefix-less request is accepted too.
    const hasPrefix = url.pathname === '/api' || url.pathname.startsWith('/api/')
    const route = (hasPrefix ? url.pathname.slice('/api'.length) : url.pathname).replace(/\/+$/, '')
    const apiPath = `/api${route}`

    const fixed = fixtureResponse(route, url)
    if (fixed) return fixed
    try {
      if ((withGoal || fixture === 'at-goal') && route === '/user-profile')
        return await profileWithGoal(req, apiPath, url.search, withGoal ? SYNTHETIC_GOAL_KG : null)
      return await forward(req, apiPath, url.search)
    } catch {
      return new Response('upstream unreachable', { status: 502 })
    }
  },
})

console.log(`fixture-proxy listening on http://127.0.0.1:${server.port} (fixture: ${fixture})`)
