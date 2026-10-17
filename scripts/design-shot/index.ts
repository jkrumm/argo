/**
 * `make design-shot [ROUTES="/a /b"] [LABEL=<l>] [SKIP_BUILD=1]` — live-data screenshots for the
 * redesign loop. Serves dist with /api proxied GET-only to production (the evidence server), shoots
 * every route × dark/light × desktop/mobile, crops each card/table on desktop, and writes a static
 * board to `.design-shots/<label>/`. The shots show real personal data: the dir is gitignored.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { readToken, serveDist } from '../evidence/server'
import { renderBoard } from './board'
import { shootAll } from './shoot'
import type { RouteResult, Scheme } from './types'

const ROOT = resolve(import.meta.dirname, '../..')
const DIST = join(ROOT, 'apps/dashboard/dist')

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const stamp = (): string => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `shots-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

async function buildDashboard(): Promise<void> {
  const proc = Bun.spawn(['bun', 'run', '--cwd', 'apps/dashboard', 'build'], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    timeout: 600_000,
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`dashboard build failed (exit ${code})`)
}

async function defaultRoutes(): Promise<string[]> {
  const text = await Bun.file(join(ROOT, 'scripts/evidence/routes.txt')).text()
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

async function main(): Promise<number> {
  const [labelArg, routesArg, skipBuild] = process.argv.slice(2)
  const label = labelArg || stamp()
  if (!/^[A-Za-z0-9][\w.-]*$/.test(label)) {
    console.error('usage: make design-shot [ROUTES="/a /b"] [LABEL=<label>] [SKIP_BUILD=1]')
    return 2
  }
  const routes = routesArg?.trim() ? routesArg.trim().split(/\s+/) : await defaultRoutes()
  const outDir = join(ROOT, '.design-shots', label)
  await mkdir(join(outDir, 'crops'), { recursive: true })

  if (skipBuild === '1' && !existsSync(join(DIST, 'index.html'))) {
    throw new Error('SKIP_BUILD=1 but apps/dashboard/dist/index.html is missing — build first')
  }
  const token = await readToken()
  const server = serveDist(DIST, token)
  let results: RouteResult[] = []
  try {
    const probe = await fetch(`${server.origin}/api/daily-metrics/sync-status`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!probe.ok) {
      throw new Error(
        `bearer rejected by production: GET /daily-metrics/sync-status -> ${probe.status}`,
      )
    }
    if (skipBuild !== '1') await buildDashboard()

    const browser = await chromium.launch({ channel: 'chrome' })
    try {
      results = await shootAll(browser, server.origin, routes, outDir)
    } finally {
      await browser.close().catch(() => undefined)
    }
  } finally {
    server.stop()
  }

  await writeFile(join(outDir, 'index.html'), renderBoard(label, results))
  await writeFile(
    join(outDir, 'manifest.json'),
    JSON.stringify({ label, routes: results, blockedWrites: server.blocked }, null, 2),
  )

  const failures = results.flatMap((r) => r.failures)
  const full = results.reduce((n, r) => n + Object.keys(r.full).length, 0)
  const cropCount = (r: RouteResult, scheme: Scheme): number =>
    r.crops.filter((c) => c.scheme === scheme).length
  const crops = results
    .map((r) => `${r.route}=dark ${cropCount(r, 'dark')}/light ${cropCount(r, 'light')}`)
    .join(' ')
  console.log(`[design-shot] ${full} full shots, crops: ${crops}`)
  for (const n of results.flatMap((r) => r.notes)) console.log(`[design-shot] note ${n}`)
  console.log(`[design-shot] ${join(outDir, 'index.html')}`)
  for (const f of failures) console.error(`[design-shot] FAILED ${f}`)
  return failures.length ? 1 : 0
}

process.exit(await main().catch((e) => (console.error(`[design-shot] ${errorMessage(e)}`), 1)))
