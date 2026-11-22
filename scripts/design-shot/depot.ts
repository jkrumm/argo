/**
 * Synthetic shots of /finance/depot: `bun scripts/design-shot/depot.ts [--out <dir>]`.
 *
 * Serves the built dashboard (`apps/dashboard/dist`) on a loopback port together with an in-memory
 * stand-in for `fin serve`: an unlocked vault, a five-instrument watchlist with seeded random-walk
 * candles, two positions with their trades, open orders and drawing documents that the page's writes
 * change. Nothing leaves the machine and no real data is involved, so these shots may be attached to a
 * ship. It then drives Chrome through light/dark x desktop (1440) / mobile (390): the chart is
 * checked for candles, markers' trades and horizontal overflow, a horizontal line and a price range
 * are drawn with the mouse, and one PNG per combination is written (default `.design-shots/depot`).
 */
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import type { Page } from 'playwright-core'

const ROOT = resolve(import.meta.dirname, '../..')
const DIST = join(ROOT, 'apps/dashboard/dist')
const DAY_S = 86_400

// ---- Synthetic market ---------------------------------------------------------------------

type Bar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  units: number
  turnover: number
}
type Instrument = {
  isin: string
  name: string
  kind: string
  start: number
  drift: number
  vol: number
}

const INSTRUMENTS: Instrument[] = [
  {
    isin: 'XX0000000001',
    name: 'World equity ETF',
    kind: 'etf',
    start: 68,
    drift: 0.0004,
    vol: 0.009,
  },
  {
    isin: 'XX0000000002',
    name: 'Semiconductor ETF',
    kind: 'etf',
    start: 7.4,
    drift: 0.0007,
    vol: 0.016,
  },
  { isin: 'XX0000000003', name: 'Dividend ETF', kind: 'etf', start: 31, drift: 0.0002, vol: 0.007 },
  {
    isin: 'XX0000000004',
    name: 'Euro bond ETF',
    kind: 'etf',
    start: 112,
    drift: 0.00005,
    vol: 0.003,
  },
  { isin: 'BTC-EUR', name: 'Bitcoin', kind: 'coin', start: 21_000, drift: 0.0008, vol: 0.028 },
]

/** A seeded generator, so every run draws the same market. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const midnight = (ms: number): number => Math.floor(ms / 1000 / DAY_S) * DAY_S
const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places

function dailyBars(instrument: Instrument, seed: number): Bar[] {
  const random = rng(seed)
  const today = midnight(Date.now())
  const days: number[] = []
  for (let t = today - 1800 * DAY_S; t <= today; t += DAY_S) {
    const weekday = new Date(t * 1000).getUTCDay()
    if (instrument.kind === 'coin' || (weekday !== 0 && weekday !== 6)) days.push(t)
  }
  let price = instrument.start
  return days.map((time) => {
    const open = price
    const move = instrument.drift + (random() - 0.5) * 2 * instrument.vol
    const close = open * (1 + move)
    const high = Math.max(open, close) * (1 + random() * instrument.vol * 0.5)
    const low = Math.min(open, close) * (1 - random() * instrument.vol * 0.5)
    price = close
    const units = Math.round(20_000 + random() * 80_000)
    return {
      time,
      open: round(open, 4),
      high: round(high, 4),
      low: round(low, 4),
      close: round(close, 4),
      units,
      turnover: Math.round(units * close),
    }
  })
}

const DAILY = new Map(INSTRUMENTS.map((i, n) => [i.isin, dailyBars(i, 1000 + n)]))

function aggregate(bars: Bar[], keyOf: (time: number) => number): Bar[] {
  const groups = new Map<number, Bar[]>()
  for (const bar of bars) groups.set(keyOf(bar.time), [...(groups.get(keyOf(bar.time)) ?? []), bar])
  return [...groups.entries()].map(([time, group]) => ({
    time,
    open: group[0]!.open,
    high: Math.max(...group.map((b) => b.high)),
    low: Math.min(...group.map((b) => b.low)),
    close: group.at(-1)!.close,
    units: group.reduce((n, b) => n + b.units, 0),
    turnover: group.reduce((n, b) => n + b.turnover, 0),
  }))
}

const weekStart = (time: number): number => {
  const weekday = (new Date(time * 1000).getUTCDay() + 6) % 7
  return time - weekday * DAY_S
}
const monthStart = (time: number): number => {
  const d = new Date(time * 1000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
}

/** Intraday bars of the last days: 08:00 to 16:30 UTC, split from each daily bar. */
function intraday(bars: Bar[], step: number): Bar[] {
  const random = rng(7)
  return bars.slice(-30).flatMap((day) => {
    const count = Math.floor((8.5 * 3600) / step)
    let price = day.open
    return Array.from({ length: count }, (_, i) => {
      const close =
        price + (day.close - day.open) / count + (random() - 0.5) * (day.high - day.low) * 0.25
      const bar = {
        time: day.time + 8 * 3600 + i * step,
        open: round(price, 4),
        high: round(Math.max(price, close) * 1.0004, 4),
        low: round(Math.min(price, close) * 0.9996, 4),
        close: round(close, 4),
        units: Math.round(day.units / count),
        turnover: Math.round(day.turnover / count),
      }
      price = close
      return bar
    })
  })
}

function candles(isin: string, interval: string, from: string | null, to: string | null): Bar[] {
  const daily = DAILY.get(isin) ?? []
  const all =
    interval === '1w'
      ? aggregate(daily, weekStart)
      : interval === '1mo'
        ? aggregate(daily, monthStart)
        : interval === '15m'
          ? intraday(daily, 900)
          : interval === '1h'
            ? intraday(daily, 3600)
            : daily
  const lo = from === null ? 0 : Date.parse(`${from}T00:00:00Z`) / 1000
  const hi = to === null ? Infinity : Date.parse(`${to}T00:00:00Z`) / 1000 + DAY_S
  return all.filter((b) => b.time >= lo && b.time < hi)
}

// ---- Synthetic depot ----------------------------------------------------------------------

const dayOf = (time: number): string => new Date(time * 1000).toISOString().slice(0, 10)
const closeOn = (isin: string, day: string): number =>
  (DAILY.get(isin) ?? []).findLast((b) => b.time <= Date.parse(`${day}T00:00:00Z`) / 1000)?.close ??
  0

type Trade = {
  id: number
  isin: string
  side: 'buy' | 'sell'
  daysAgo: number
  quantity: number
  source: 'document' | 'derived' | 'estimated'
}
const TRADES: Trade[] = [
  { id: 1, isin: 'XX0000000001', side: 'buy', daysAgo: 420, quantity: 12, source: 'document' },
  { id: 2, isin: 'XX0000000001', side: 'buy', daysAgo: 330, quantity: 8, source: 'document' },
  { id: 3, isin: 'XX0000000001', side: 'sell', daysAgo: 210, quantity: 5, source: 'derived' },
  { id: 4, isin: 'XX0000000001', side: 'buy', daysAgo: 120, quantity: 10, source: 'estimated' },
  { id: 5, isin: 'XX0000000001', side: 'buy', daysAgo: 30, quantity: 6, source: 'document' },
  { id: 6, isin: 'XX0000000002', side: 'buy', daysAgo: 250, quantity: 90, source: 'document' },
  { id: 7, isin: 'XX0000000002', side: 'buy', daysAgo: 60, quantity: 40, source: 'document' },
]

function tradeRows(isin: string | null) {
  return TRADES.filter((t) => isin === null || t.isin === isin).map((t) => {
    const day = dayOf(midnight(Date.now()) - t.daysAgo * DAY_S)
    const price = closeOn(t.isin, day)
    return {
      id: t.id,
      account_id: 'depot',
      isin: t.isin,
      name: INSTRUMENTS.find((i) => i.isin === t.isin)?.name ?? null,
      side: t.side,
      booked_on: day,
      amount_cents: Math.round(price * t.quantity * 100),
      settlement_ref: `ref-${t.id}`,
      transaction_id: null,
      quantity: t.quantity,
      quantity_source: t.source,
      price,
      fee_cents: 100,
      tax_cents: null,
      costs_source: 'document',
      reading: null,
      note: null,
      updated_at: day,
      realised_fifo_cents: t.side === 'sell' ? Math.round(price * t.quantity * 8) : null,
    }
  })
}

function position(isin: string) {
  const rows = tradeRows(isin)
  const quantity = rows.reduce((n, t) => n + (t.side === 'buy' ? t.quantity : -t.quantity), 0)
  const cost = rows.filter((t) => t.side === 'buy').reduce((n, t) => n + t.amount_cents, 0)
  const last = DAILY.get(isin)?.at(-1)
  const price = last?.close ?? 0
  const value = Math.round(price * quantity * 100)
  const costFifo = Math.round(
    cost * (quantity / rows.filter((t) => t.side === 'buy').reduce((n, t) => n + t.quantity, 0)),
  )
  return {
    isin,
    name: INSTRUMENTS.find((i) => i.isin === isin)?.name ?? null,
    quantity,
    price,
    price_on: last === undefined ? null : dayOf(last.time),
    value_cents: value,
    cost_fifo_cents: costFifo,
    cost_average_cents: costFifo,
    unrealised_fifo_cents: value - costFifo,
    unrealised_average_cents: value - costFifo,
    unrealised_fifo_pct: costFifo === 0 ? null : (value - costFifo) / costFifo,
    share: null,
    quantity_source: 'mixed',
    lots: [],
  }
}

type Order = {
  id: number
  account_id: null
  isin: string
  name: string | null
  side: 'buy' | 'sell'
  type: 'limit' | 'stop' | 'market'
  limit_price: number | null
  stop_price: number | null
  quantity: number
  valid_until: string | null
  status: 'open' | 'executed' | 'cancelled' | 'expired'
  note: string | null
  opened_at: string
  closed_at: string | null
  overdue: boolean
}
const orders: Order[] = []
let nextOrder = 1
const drawings = new Map<string, { isin: string; document: unknown; updated_at: string }>()

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, '')
  const q = url.searchParams
  if (path === '/__reset') {
    orders.length = 0
    drawings.clear()
    return json({ ok: true })
  }
  if (path === '/finance/status') {
    return json({
      locked: false,
      unlocked_at: new Date().toISOString(),
      idle_lock_at: new Date(Date.now() + 3_600_000).toISOString(),
      syncing: false,
      last_sync: null,
    })
  }
  if (path === '/finance/sync-runs') return json([])
  const rest = path.replace(/^\/finance\/api/, '')
  if (rest === path) return json({ error: 'not found' }, 404)
  if (req.method === 'GET') {
    if (rest === '/market/watchlist') {
      return json(
        INSTRUMENTS.map((i) => {
          const bars = DAILY.get(i.isin) ?? []
          const last = bars.at(-1)!
          const before = bars.at(-2)!
          return {
            isin: i.isin,
            name: i.name,
            kind: i.kind,
            currency: 'EUR',
            last_close: last.close,
            last_day: dayOf(last.time),
            first_day: dayOf(bars[0]!.time),
            day_change: round(last.close - before.close, 4),
            day_change_pct: last.close / before.close - 1,
            us_mic: null,
          }
        }),
      )
    }
    if (rest === '/market/candles') {
      return json({
        isin: q.get('isin'),
        interval: q.get('interval'),
        currency: 'EUR',
        mic: null,
        candles: candles(
          q.get('isin') ?? '',
          q.get('interval') ?? '1d',
          q.get('from'),
          q.get('to'),
        ),
        notes: [],
      })
    }
    if (rest === '/depot/positions') {
      const held = ['XX0000000001', 'XX0000000002'].map(position)
      return json({
        value_cents: held.reduce((n, p) => n + p.value_cents, 0),
        cost_fifo_cents: held.reduce((n, p) => n + p.cost_fifo_cents, 0),
        unrealised_fifo_cents: held.reduce((n, p) => n + p.unrealised_fifo_cents, 0),
        positions: held,
        unresolved: [],
      })
    }
    if (rest === '/depot/trades') return json(tradeRows(q.get('isin')))
    if (rest === '/depot/orders') {
      return json(
        orders.filter(
          (o) =>
            (q.get('status') === null || o.status === q.get('status')) &&
            (q.get('isin') === null || o.isin === q.get('isin')),
        ),
      )
    }
    const drawing = /^\/chart\/drawings\/([A-Za-z0-9-]+)$/.exec(rest)
    if (drawing !== null) {
      const isin = drawing[1]!
      return json(drawings.get(isin) ?? { isin, document: {}, updated_at: null })
    }
    return json({ error: 'not found' }, 404)
  }
  if (req.method === 'POST') {
    const body = (await req.json()) as Record<string, unknown>
    const drawing = /^\/chart\/drawings\/([A-Za-z0-9-]+)$/.exec(rest)
    if (drawing !== null) {
      const saved = { isin: drawing[1]!, document: body, updated_at: new Date().toISOString() }
      drawings.set(saved.isin, saved)
      return json(saved)
    }
    if (rest === '/depot/orders') {
      const isin = String(body['isin'])
      const order: Order = {
        id: nextOrder++,
        account_id: null,
        isin,
        name: INSTRUMENTS.find((i) => i.isin === isin)?.name ?? null,
        side: body['side'] as Order['side'],
        type: body['type'] as Order['type'],
        limit_price: (body['limit_price'] as number | undefined) ?? null,
        stop_price: (body['stop_price'] as number | undefined) ?? null,
        quantity: Number(body['quantity']),
        valid_until: (body['valid_until'] as string | undefined) ?? null,
        status: 'open',
        note: (body['note'] as string | undefined) ?? null,
        opened_at: new Date().toISOString(),
        closed_at: null,
        overdue: false,
      }
      orders.push(order)
      return json(order)
    }
    const close = /^\/depot\/orders\/(\d+)\/close$/.exec(rest)
    if (close !== null) {
      const order = orders.find((o) => o.id === Number(close[1]))
      if (order === undefined) return json({ error: 'unknown order' }, 404)
      order.status = body['as'] as Order['status']
      order.closed_at = new Date().toISOString()
      return json(order)
    }
  }
  return json({ error: 'not found' }, 404)
}

// ---- The server ---------------------------------------------------------------------------

const missing = new Set<string>()

function serve(): { origin: string; stop: () => void } {
  const seed = `<script>localStorage.setItem("argo-auth",${JSON.stringify(JSON.stringify({ state: { token: 'fixture' }, version: 0 }))})</script>`
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname.startsWith('/api/')) {
        const response = await handleApi(req, url)
        if (response.status === 404 && !missing.has(url.pathname)) {
          missing.add(url.pathname)
          console.log(`fixture has no ${req.method} ${url.pathname}`)
        }
        return response
      }
      const file = normalize(join(DIST, decodeURIComponent(url.pathname)))
      if (file.startsWith(DIST + sep) && existsSync(file) && statSync(file).isFile()) {
        return new Response(Bun.file(file))
      }
      const html = await Bun.file(join(DIST, 'index.html')).text()
      return new Response(html.replace('<head>', `<head>${seed}`), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    },
  })
  return { origin: `http://127.0.0.1:${server.port}`, stop: () => void server.stop(true) }
}

// ---- The shots ----------------------------------------------------------------------------

const VIEWPORTS = {
  desktop: { width: 1440, height: 1500, mobile: false },
  mobile: { width: 390, height: 2600, mobile: true },
} as const

/** Drags a price range and clicks a horizontal line onto the plot, through the toolbar. */
async function draw(page: Page): Promise<void> {
  const plot = page.locator('[aria-label="Candlestick chart of the selected instrument"]')
  const box = await plot.boundingBox()
  if (box === null) throw new Error('the chart has no box')
  await page.getByRole('button', { name: 'Horizontal line' }).click()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3)
  await page.getByRole('button', { name: 'Price range' }).click()
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.35)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.2, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Cursor' }).click()
}

/** Adds a limit buy through the form and waits for it to show in the open-orders table. */
async function addOrder(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add order' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Quantity').fill('5')
  await dialog.getByLabel('Limit price').fill('112')
  await dialog.getByRole('button', { name: 'Add order' }).click()
  await page.getByText('Buy limit').waitFor()
}

/** How many entries the stored drawing document of the first instrument holds. */
const storedCount = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const token = (
      JSON.parse(localStorage.getItem('argo-auth') ?? '{}') as { state?: { token?: string } }
    ).state?.token
    const response = await fetch('/api/finance/api/chart/drawings/XX0000000001', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const doc = (await response.json()) as { document: { drawings?: unknown[] } }
    return doc.document.drawings?.length ?? 0
  })

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { out: { type: 'string' }, serve: { type: 'boolean' } } })
  if (values.serve === true) {
    // Only the stand-in API and the app, for `basalt-ui shot --dist` and manual checks.
    console.log(serve().origin)
    return await new Promise<number>(() => undefined)
  }
  const out = resolve(values.out ?? join(ROOT, '.design-shots/depot'))
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('build the dashboard first')
  await mkdir(out, { recursive: true })
  const { origin, stop } = serve()
  const browser = await chromium.launch({ channel: 'chrome' })
  const failures: string[] = []
  try {
    for (const scheme of ['light', 'dark'] as const) {
      for (const [device, vp] of Object.entries(VIEWPORTS)) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 2,
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
          colorScheme: scheme,
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
        })
        await context.addInitScript(
          (value) => localStorage.setItem('mantine-color-scheme-value', value),
          scheme,
        )
        const page = await context.newPage()
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message))
        // A 404 is the stand-in not answering a route of another page of the shell; anything else counts.
        page.on('console', (m) => {
          if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
            errors.push(m.text())
        })
        await fetch(`${origin}/api/__reset`)
        await page.goto(`${origin}/finance/depot`, { waitUntil: 'networkidle' })
        await page.locator('canvas').first().waitFor()
        await page.evaluate(() => document.fonts.ready.then(() => undefined))
        await page.waitForTimeout(600)
        await draw(page)
        await addOrder(page)
        await page.waitForTimeout(900)
        const saved = await storedCount(page)
        if (saved !== 2) failures.push(`${scheme}/${device}: ${saved} drawings stored, expected 2`)
        // A reload is a second device: the drawings and the order come back from the service.
        await page.reload({ waitUntil: 'networkidle' })
        await page.locator('canvas').first().waitFor()
        await page.waitForTimeout(900)
        const overflow = await page.evaluate(() =>
          Math.max(
            ...[...document.querySelectorAll<HTMLElement>('*')].map(
              (el) => el.scrollWidth - el.clientWidth,
            ),
          ),
        )
        const horizontalScroll = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        )
        if (horizontalScroll) failures.push(`${scheme}/${device}: the page scrolls horizontally`)
        if (errors.length > 0) failures.push(`${scheme}/${device}: ${errors.join(' | ')}`)
        console.log(`${scheme}/${device}: widest overflow ${overflow}px, errors ${errors.length}`)
        await page.screenshot({
          path: join(out, `depot--${scheme}--${device}.png`),
          fullPage: false,
        })
        if (scheme === 'light' && device === 'desktop') {
          // Closing the order takes its row, and with it its line, away.
          await page
            .getByRole('row')
            .filter({ hasText: 'Buy limit' })
            .getByRole('button')
            .last()
            .click()
          await page.getByRole('menuitem', { name: 'Close as cancelled' }).click()
          await page.getByText('Buy limit').waitFor({ state: 'detached' })
          // The other intervals draw too: week and 15 minutes.
          for (const interval of ['1w', '15m']) {
            await page.goto(`${origin}/finance/depot?ivl=${interval}`, { waitUntil: 'networkidle' })
            await page.locator('canvas').first().waitFor()
            await page.waitForTimeout(700)
            const dataless = await page.getByText('No bars for this range.').count()
            if (dataless > 0) failures.push(`${scheme}/${device}: no bars at ${interval}`)
            await page.screenshot({
              path: join(out, `depot--${scheme}--${device}--${interval}.png`),
            })
          }
        }
        await context.close()
      }
    }
  } finally {
    await browser.close().catch(() => undefined)
    stop()
  }
  for (const failure of failures) console.error(failure)
  return failures.length === 0 ? 0 : 1
}

process.exit(await main())
