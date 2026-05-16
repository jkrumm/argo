/* eslint-disable no-console */
/**
 * One-shot smoke test for the Confluence client (src/clients/confluence.ts).
 * Exercises the same code path the Elysia routes use against the live IU
 * Atlassian Cloud tenant.
 *
 * Run from repo root:
 *   DATABASE_URL='postgresql://noop@localhost:5432/noop' \
 *     op run --account tkrumm --env-file=apps/api/.env.local.tpl -- \
 *     bun run --cwd apps/api scripts/confluence-smoke.ts
 */
import {
  getPage,
  getPageChildren,
  getRecentlyUpdated,
  listSpaces,
  searchByCql,
} from '../src/clients/confluence.js'

async function section<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  console.log(`\n══ ${label}`)
  try {
    return await fn()
  } catch (e) {
    console.error(`  ERROR: ${(e as Error).message}`)
    return undefined
  }
}

function brief(...lines: string[]): void {
  for (const l of lines) console.log(`  ${l}`)
}

const spaces = await section('listSpaces({ limit: 10 })', () => listSpaces({ limit: 10 }))
if (spaces) {
  brief(`count=${spaces.spaces.length}`)
  for (const s of spaces.spaces)
    brief(`  ${s.key.padEnd(8)} ${s.type.padEnd(20)} id=${s.id.padEnd(12)} ${s.name}`)
}

const recent = await section('getRecentlyUpdated({ limit: 5 })', () =>
  getRecentlyUpdated({ limit: 5 }),
)
if (recent) {
  brief(`count=${recent.pages.length}`)
  for (const p of recent.pages)
    brief(`  ${p.id.padEnd(12)} v${p.version} ${p.createdAt} ${p.title.slice(0, 60)}`)
}

const search = await section(
  'searchByCql({ cql: type = page ORDER BY lastmodified DESC, limit: 5 })',
  () => searchByCql({ cql: 'type = page ORDER BY lastmodified DESC', limit: 5 }),
)
if (search) {
  brief(
    `count=${search.results.length}`,
    `totalSize=${search.totalSize}`,
    `isLast=${search.isLast}`,
  )
  for (const r of search.results)
    brief(`  ${r.type.padEnd(10)} ${r.spaceKey ?? '-'} ${r.id.padEnd(12)} ${r.title.slice(0, 60)}`)
}

const samplePageId =
  search?.results.find((r) => r.type === 'page' && r.id)?.id ?? recent?.pages[0]?.id
if (samplePageId) {
  const page = await section(`getPage("${samplePageId}", { bodyFormat: 'view' })`, () =>
    getPage(samplePageId, { bodyFormat: 'view' }),
  )
  if (page) {
    brief(
      `id=${page.id}`,
      `title=${page.title}`,
      `url=${page.url}`,
      `status=${page.status} v${page.version}`,
      `body=${page.body ? `${page.body.format} (${page.body.value.length} chars)` : 'null'}`,
    )
  }

  const children = await section(`getPageChildren("${samplePageId}", { limit: 5 })`, () =>
    getPageChildren(samplePageId, { limit: 5 }),
  )
  if (children) {
    brief(`count=${children.pages.length}`)
    for (const p of children.pages) brief(`  ${p.id.padEnd(12)} ${p.title.slice(0, 60)}`)
  }
}

console.log('\nDone.')
