/** Bundle lane — gzip (level 9) JS/CSS totals and per-route-chunk sizes from the vite manifest. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Lane, Row } from './types'

type Chunk = { file: string; isEntry?: boolean; imports?: string[]; css?: string[] }
type Manifest = Record<string, Chunk>

const gzipBytes = (file: string): number => Bun.gzipSync(readFileSync(file), { level: 9 }).length

/** `src/routes/garmin-health.tsx?tsr-split=component` → `garmin-health`. */
const routeOfKey = (key: string): string | null =>
  /(?:^|\/)routes\/(.+?)\.tsx?(?:\?|$)/.exec(key)?.[1] ?? null

function closure(manifest: Manifest, roots: string[]): Set<string> {
  const files = new Set<string>()
  const seen = new Set<string>()
  const queue = [...roots]
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    const chunk = manifest[key]
    if (!chunk || seen.has(key)) continue
    seen.add(key)
    files.add(chunk.file)
    for (const css of chunk.css ?? []) files.add(css)
    queue.push(...(chunk.imports ?? []))
  }
  return files
}

export const bundle: Lane = async ({ distDir }) => {
  const gz = (rel: string): number => gzipBytes(join(distDir, rel))
  const sum = (files: Iterable<string>): number => [...files].reduce((n, f) => n + gz(f), 0)
  const assetsDir = join(distDir, 'assets')
  const assets = readdirSync(assetsDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(distDir, join(e.parentPath, e.name)))
    .toSorted()
  const total = (ext: RegExp): number => sum(assets.filter((f) => ext.test(f)))

  const rows: Row[] = [
    { metric: 'app total js', value: total(/\.js$/), unit: 'B gzip' },
    { metric: 'app total css', value: total(/\.css$/), unit: 'B gzip' },
  ]

  const manifestFile = join(distDir, '.vite/manifest.json')
  if (!existsSync(manifestFile)) {
    rows.push({ metric: 'route chunks', value: 'skipped: no vite manifest in dist' })
    return { rows }
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest
  const initial = closure(
    manifest,
    Object.keys(manifest).filter((k) => manifest[k]?.isEntry),
  )
  rows.push({ metric: 'app initial load', value: sum(initial), unit: 'B gzip' })

  const routes = Object.entries(manifest)
    .flatMap(([key, chunk]) => {
      const route = routeOfKey(key)
      if (!route) return []
      const beyond = [...closure(manifest, [key])].filter((f) => !initial.has(f))
      return [{ route, own: sum([chunk.file, ...(chunk.css ?? [])]), beyond: sum(beyond) }]
    })
    .toSorted((a, b) => a.route.localeCompare(b.route))
  for (const r of routes) {
    rows.push(
      { metric: `route ${r.route} chunk`, value: r.own, unit: 'B gzip' },
      { metric: `route ${r.route} beyond initial`, value: r.beyond, unit: 'B gzip' },
    )
  }
  return { rows, detail: { routes, assets: assets.map((file) => ({ file, gzip: gz(file) })) } }
}
