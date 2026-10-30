/**
 * Loads every dashboard route in a real Chrome against a running Argo and reports what broke: uncaught page
 * errors, console errors, and /api responses that are not 2xx. `make verify-pages [BASE=<origin>]`.
 *
 * Reads only: the pages issue GETs, nothing is clicked. The bearer comes from `secrets-run`, is seeded into
 * localStorage by an init script, and is never printed. Exit 1 on an uncaught page error, a 5xx other than 503, or a page that
 * rendered nothing. 503 is the API's own "integration not configured" answer (Google / M365 without OAuth tokens), so
 * it and 4xx/console errors are listed as findings, not failures.
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BASE = (process.env['BASE'] ?? 'http://127.0.0.1:7737').replace(/\/+$/, '')
const AUTH_STORAGE_KEY = 'argo-auth'
const NAV_TIMEOUT_MS = 30_000
const SETTLE_MS = 2_000

const routes = readFileSync(new URL('./evidence/routes.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'))

async function bearer(): Promise<string> {
  const proc = Bun.spawn(['secrets-run', 'read', 'op://common/api/SECRET'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const token = (await new Response(proc.stdout).text()).trim()
  if ((await proc.exited) !== 0 || token === '')
    throw new Error('cannot read the API bearer through secrets-run')
  return token
}

interface PageReport {
  route: string
  pageErrors: string[]
  consoleErrors: string[]
  apiFailures: string[]
  textLength: number
}

const token = await bearer()
const browser = await chromium.launch({ channel: 'chrome' })
const reports: PageReport[] = []
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  })
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key!, value!),
    [AUTH_STORAGE_KEY, JSON.stringify({ state: { token }, version: 0 })],
  )
  for (const route of routes) {
    const page = await context.newPage()
    page.setDefaultTimeout(NAV_TIMEOUT_MS)
    const report: PageReport = {
      route,
      pageErrors: [],
      consoleErrors: [],
      apiFailures: [],
      textLength: 0,
    }
    page.on('pageerror', (error) => report.pageErrors.push(error.message.split('\n')[0]!))
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push(message.text().split('\n')[0]!)
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (!url.pathname.startsWith('/api/') || response.status() < 400) return
      report.apiFailures.push(`${response.status()} ${url.pathname}`)
    })
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(SETTLE_MS)
      report.textLength = (await page.evaluate(() => document.body.innerText)).trim().length
    } catch (error) {
      report.pageErrors.push(error instanceof Error ? error.message.split('\n')[0]! : String(error))
    }
    await page.close()
    reports.push(report)
  }
} finally {
  await browser.close().catch(() => undefined)
}

let failed = false
for (const r of reports) {
  const has5xx = r.apiFailures.some((f) => /^5(?!03)/.test(f))
  const broken = r.pageErrors.length > 0 || has5xx || r.textLength === 0
  failed ||= broken
  const mark = broken ? 'FAIL' : r.apiFailures.length + r.consoleErrors.length > 0 ? 'note' : 'ok  '
  console.log(`${mark} ${r.route} (${r.textLength} chars)`)
  for (const line of [...r.pageErrors, ...r.apiFailures, ...r.consoleErrors]) {
    console.log(`       ${line}`)
  }
}
console.log(failed ? 'verify-pages: FAIL' : `verify-pages: PASS ${reports.length} routes`)
process.exit(failed ? 1 : 0)
