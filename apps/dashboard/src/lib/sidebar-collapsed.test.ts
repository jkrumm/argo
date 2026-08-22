import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { migrateLegacyCollapse } from './sidebar-collapsed'

const KEY = 'argo-sidebar'
const NAMESPACED = `basalt:${KEY}`

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

let original: unknown

beforeEach(() => {
  original = (globalThis as { window?: unknown }).window
})
afterEach(() => {
  ;(globalThis as { window?: unknown }).window = original
})

function withStorage(seed: Record<string, string>) {
  const storage = fakeStorage(seed)
  ;(globalThis as { window?: unknown }).window = { localStorage: storage }
  return storage
}

describe('migrateLegacyCollapse', () => {
  it('carries a collapsed sidebar across the move to createPersistedState', () => {
    // What @mantine/hooks' useLocalStorage wrote: JSON.stringify(true).
    const storage = withStorage({ [KEY]: 'true' })
    migrateLegacyCollapse()
    expect(JSON.parse(storage.getItem(NAMESPACED) as string)).toEqual({ v: 1, value: true })
  })

  it('carries an expanded sidebar too, rather than leaving the key absent', () => {
    const storage = withStorage({ [KEY]: 'false' })
    migrateLegacyCollapse()
    expect(JSON.parse(storage.getItem(NAMESPACED) as string)).toEqual({ v: 1, value: false })
  })

  it('never overwrites a value the store already owns', () => {
    const storage = withStorage({
      [KEY]: 'true',
      [NAMESPACED]: JSON.stringify({ v: 1, value: false }),
    })
    migrateLegacyCollapse()
    expect(JSON.parse(storage.getItem(NAMESPACED) as string)).toEqual({ v: 1, value: false })
  })

  it('ignores a legacy value that is not a serialized boolean', () => {
    const storage = withStorage({ [KEY]: 'collapsed' })
    migrateLegacyCollapse()
    expect(storage.getItem(NAMESPACED)).toBeNull()
  })

  it('writes nothing when there is no legacy value at all', () => {
    const storage = withStorage({})
    migrateLegacyCollapse()
    expect(storage.getItem(NAMESPACED)).toBeNull()
  })
})
