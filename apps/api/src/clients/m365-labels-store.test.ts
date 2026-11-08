import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLabelsStore } from './m365-labels-store.js'

const dirs: string[] = []
function setup(seed?: object) {
  const root = mkdtempSync(join(tmpdir(), 'argo-labels-'))
  dirs.push(root)
  const seedFile = join(root, 'seed.json')
  if (seed) writeFileSync(seedFile, JSON.stringify(seed))
  const dataDir = join(root, 'data')
  return { dataDir, seedFile, store: createLabelsStore(dataDir, seedFile) }
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const rec = (sourceId: string, label = 'team') => ({
  sourceId,
  kind: 'chat' as const,
  label,
  displayName: null,
  notes: null,
})

describe('labels store', () => {
  it('seeds DATA_DIR from the committed file and writes there, not to the seed', async () => {
    const seeded = {
      version: 1,
      labels: { a: { ...rec('a'), updatedAt: '2026-01-01T00:00:00.000Z' } },
    }
    const { store, dataDir, seedFile } = setup(seeded)
    expect(store.listLabels().map((l) => l.sourceId)).toEqual(['a'])
    await store.upsertLabel(rec('b'))
    expect(store.file).toBe(join(dataDir, 'm365-labels.json'))
    expect(Object.keys(JSON.parse(readFileSync(store.file, 'utf-8')).labels).toSorted()).toEqual([
      'a',
      'b',
    ])
    expect(Object.keys(JSON.parse(readFileSync(seedFile, 'utf-8')).labels)).toEqual(['a'])
  })

  it('starts empty without a seed and does not create the file on read', () => {
    const { store } = setup()
    expect(store.listLabels()).toEqual([])
    expect(existsSync(store.file)).toBe(false)
  })

  it('keeps every concurrent upsert', async () => {
    const { store } = setup()
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.upsertLabel(rec(`c${i}`))))
    expect(store.listLabels()).toHaveLength(20)
  })

  it('renames and deletes tags', async () => {
    const { store } = setup()
    await store.upsertLabel(rec('a', 'x'))
    await store.upsertLabel(rec('b', 'x'))
    expect(await store.renameTag('x', 'y')).toBe(2)
    expect(await store.deleteLabel('a')).toBe(true)
    expect(await store.deleteTag('y')).toBe(1)
    expect(await store.deleteTag('y')).toBe(0)
  })
})
