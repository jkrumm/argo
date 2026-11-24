import { describe, expect, test } from 'bun:test'
import {
  installStaleBuildRecovery,
  isBuildAssetLink,
  sessionStore,
  STALE_BUILD_GUARD_MS,
  STALE_BUILD_RELOAD_KEY,
} from './stale-build'

function setup(startAt = 1_000_000) {
  const listeners = new Map<string, { fn: (e: Event) => void; capture: boolean | undefined }>()
  const values = new Map<string, string>()
  let reloads = 0
  let clock = startAt
  installStaleBuildRecovery(
    {
      addEventListener: (type, fn, capture) => listeners.set(type, { fn, capture }),
      location: { reload: () => void reloads++ },
    },
    { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => void values.set(k, v) },
    () => clock,
  )
  return {
    listeners,
    values,
    reloads: () => reloads,
    advance: (ms: number) => void (clock += ms),
    linkError() {
      const event = {
        target: { tagName: 'LINK', rel: 'modulepreload', href: 'https://x/assets/a.js' },
        stopped: false,
        stopImmediatePropagation() {
          this.stopped = true
        },
      }
      listeners.get('error')!.fn(event as unknown as Event)
      return event
    },
    preloadError() {
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true
        },
      }
      listeners.get('vite:preloadError')!.fn(event as unknown as Event)
      return event
    },
  }
}

describe('isBuildAssetLink', () => {
  test('matches the links Vite injects for built chunks and styles', () => {
    expect(
      isBuildAssetLink({ tagName: 'LINK', rel: 'modulepreload', href: 'https://x/assets/a-1.js' }),
    ).toBe(true)
    expect(
      isBuildAssetLink({ tagName: 'LINK', rel: 'stylesheet', href: 'https://x/assets/a-1.css' }),
    ).toBe(true)
  })

  test('leaves every other failing element alone', () => {
    expect(isBuildAssetLink({ tagName: 'IMG', href: 'https://x/assets/a.png' })).toBe(false)
    expect(isBuildAssetLink({ tagName: 'LINK', rel: 'icon', href: 'https://x/assets/f.ico' })).toBe(
      false,
    )
    expect(
      isBuildAssetLink({ tagName: 'LINK', rel: 'stylesheet', href: 'https://fonts.example/a.css' }),
    ).toBe(false)
    expect(isBuildAssetLink(null)).toBe(false)
  })
})

describe('sessionStore', () => {
  test('returns the real storage when it is readable', () => {
    const storage = { getItem: () => null, setItem: () => {} }
    expect(sessionStore({ sessionStorage: storage })).toBe(storage)
  })

  test('falls back to an in-memory store when storage access throws', () => {
    const win = {
      get sessionStorage(): never {
        throw new DOMException('blocked', 'SecurityError')
      },
    }
    const store = sessionStore(win)
    expect(store.getItem('k')).toBeNull()
    store.setItem('k', '1')
    expect(store.getItem('k')).toBe('1')
  })
})

describe('installStaleBuildRecovery', () => {
  test('listens on the capture phase so it runs before the HyperDX listener', () => {
    expect(setup().listeners.get('error')!.capture).toBe(true)
  })

  test('the first failing link reloads and still reaches its target and HyperDX', () => {
    const t = setup()
    const first = t.linkError()
    expect(t.reloads()).toBe(1)
    expect(first.stopped).toBe(false)
    expect(t.values.has(STALE_BUILD_RELOAD_KEY)).toBe(true)
  })

  test('the rest of the burst is stopped before HyperDX and reloads only once', () => {
    const t = setup()
    t.linkError()
    const rest = Array.from({ length: 19 }, () => t.linkError())
    expect(rest.every((e) => e.stopped)).toBe(true)
    expect(t.reloads()).toBe(1)
  })

  test('vite:preloadError after the reload started is taken as handled', () => {
    const t = setup()
    t.linkError()
    expect(t.preloadError().prevented).toBe(true)
    expect(t.reloads()).toBe(1)
  })

  test('a preload failure with no link error (e.g. a script chunk) reloads too', () => {
    const t = setup()
    expect(t.preloadError().prevented).toBe(true)
    expect(t.reloads()).toBe(1)
  })

  test('other elements failing are never touched', () => {
    const t = setup()
    const event = {
      target: { tagName: 'IMG' },
      stopImmediatePropagation: () => {
        throw new Error('must not stop')
      },
    }
    t.listeners.get('error')!.fn(event as unknown as Event)
    expect(t.reloads()).toBe(0)
  })

  test('a failure inside the guard window is a broken release: no reload, nothing swallowed', () => {
    const t = setup()
    t.values.set(STALE_BUILD_RELOAD_KEY, String(1_000_000 - STALE_BUILD_GUARD_MS + 1))
    const link = t.linkError()
    expect(link.stopped).toBe(false)
    expect(t.preloadError().prevented).toBe(false)
    expect(t.reloads()).toBe(0)
  })

  test('a failure after the guard window reloads again', () => {
    const t = setup()
    t.values.set(STALE_BUILD_RELOAD_KEY, String(1_000_000 - STALE_BUILD_GUARD_MS))
    t.linkError()
    expect(t.reloads()).toBe(1)
  })
})
