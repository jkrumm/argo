/**
 * `make evidence LABEL=<l>` — real-data before/after measurement of the dashboard.
 * Builds the dashboard, serves dist on an ephemeral port with /api proxied GET-only to production,
 * runs the bundle / screens / lighthouse lanes and writes docs/waves/evidence/<label>.md.
 * A failing lane is recorded under its heading and does not abort the others.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { bundle } from './bundle'
import { lighthouse } from './lighthouse'
import { screens } from './screens'
import { serveDist } from './server'
import type { Lane, LaneResult, Row } from './types'

const ROOT = resolve(import.meta.dirname, '../..')
const DIST = join(ROOT, 'apps/dashboard/dist')
const LANES: Array<[string, Lane]> = [
  ['bundle', bundle],
  ['screens', screens],
  ['lighthouse', lighthouse],
]

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Bearer from the secrets cache. The value is never printed; failures report the exit code only. */
async function readToken(): Promise<string> {
  const proc = Bun.spawn(['secrets-run', 'read', 'op://common/api/SECRET'], {
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: 30_000,
  })
  const token = (await new Response(proc.stdout).text()).trim()
  if ((await proc.exited) !== 0 || !token)
    throw new Error('secrets-run could not read the API secret')
  return token
}

async function buildDashboard(): Promise<void> {
  // --manifest adds dist/.vite/manifest.json only; no vite.config.ts change needed.
  const proc = Bun.spawn(['bun', 'run', '--cwd', 'apps/dashboard', 'build', '--manifest'], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
    timeout: 600_000,
  })
  if ((await proc.exited) !== 0) throw new Error('dashboard build failed')
}

const cell = (value: string | number | undefined): string => String(value ?? '')

function table(rows: Row[]): string {
  const body = rows.map((r) => [r.metric, cell(r.value), cell(r.unit)])
  const all = [['Metric', 'Value', 'Unit'], ...body]
  const widths = [0, 1, 2].map((i) => Math.max(...all.map((r) => r[i]!.length), 3))
  const line = (r: string[]): string => `| ${r.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`
  return [line(all[0]!), sep, ...body.map(line)].join('\n')
}

async function main(): Promise<number> {
  const label = process.argv[2]
  if (!label || !/^[\w.-]+$/.test(label)) {
    console.error('usage: make evidence LABEL=<label>')
    return 2
  }
  const rawDir = join(ROOT, 'docs/waves/evidence/.raw', label)
  await mkdir(rawDir, { recursive: true })

  const token = await readToken()
  await buildDashboard()
  const routes = (await Bun.file(join(import.meta.dirname, 'routes.txt')).text())
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

  const server = serveDist(DIST, token)
  const sections: string[] = []
  let failed = false
  try {
    for (const [name, lane] of LANES) {
      console.log(`[evidence] ${name}…`)
      let body: string
      try {
        const result: LaneResult = await lane({
          baseUrl: server.origin,
          distDir: DIST,
          rawDir,
          routes,
        })
        if (result.detail)
          await writeFile(join(rawDir, `${name}.json`), JSON.stringify(result.detail, null, 2))
        body = table(result.rows)
      } catch (error) {
        failed = true
        body = `lane failed: ${errorMessage(error).split('\n')[0]}`
        console.error(`[evidence] ${name} ${body}`)
      }
      sections.push(`## ${name}\n\n${body}`)
    }
    // The app fires some writes on its own (e.g. a refresh POST on load). They are answered 405 and
    // listed here so a regression that starts writing more is visible; they do not fail the run.
    if (server.blocked.length) {
      const list = server.blocked.map((b) => `- \`${b}\``).join('\n')
      sections.push(
        `## blocked writes\n\nNon-GET requests the app attempted, answered 405:\n\n${list}`,
      )
    }
  } finally {
    server.stop()
  }

  const out = join(ROOT, 'docs/waves/evidence', `${label}.md`)
  await writeFile(out, `# Evidence — ${label}\n\n${sections.join('\n\n')}\n`)
  console.log(`[evidence] wrote ${out}`)
  return failed ? 1 : 0
}

process.exit(await main().catch((e) => (console.error(`[evidence] ${errorMessage(e)}`), 1)))
