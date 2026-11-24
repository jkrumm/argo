import { describe, expect, test } from 'bun:test'
import {
  installStaleBuildRecovery,
  isBuildAssetLink,
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
  const fire = (type: string, event: object) => listeners.get(type)!.fn(event as Event)
  return {
    listeners,
    fire,
    reloads: () => reloads,
    advance: (ms: number) => void (clock += ms),
    values,
  }
}

const preloadEvent = () => ({
  prevented: false,
  preventDefault() {
    this.prevented = true
  },
})

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

describe('installStaleBuildRecovery', () => {
  test('swallows build-asset link errors in the capture phase, before the HyperDX listener', () => {
    const { listeners, fire } = setup()
    expect(listeners.get('error')!.capture).toBe(true)
    let stopped = 0
    const stop = () => void stopped++
    fire('error', {
      target: { tagName: 'LINK', rel: 'modulepreload', href: 'https://x/assets/a.js' },
      stopImmediatePropagation: stop,
    })
    fire('error', { target: { tagName: 'IMG', href: '' }, stopImmediatePropagation: stop })
    expect(stopped).toBe(1)
  })

  test('reloads once on a preload failure and takes the failure as handled', () => {
    const { fire, reloads, values } = setup()
    const event = preloadEvent()
    fire('vite:preloadError', event)
    expect(event.prevented).toBe(true)
    expect(reloads()).toBe(1)
    expect(values.has(STALE_BUILD_RELOAD_KEY)).toBe(true)
  })

  test('a second failure inside the guard window is a broken release: no reload, error surfaces', () => {
    const { fire, reloads, advance } = setup()
    fire('vite:preloadError', preloadEvent())
    advance(STALE_BUILD_GUARD_MS - 1)
    const again = preloadEvent()
    fire('vite:preloadError', again)
    expect(again.prevented).toBe(false)
    expect(reloads()).toBe(1)
  })

  test('a failure after the guard window reloads again', () => {
    const { fire, reloads, advance } = setup()
    fire('vite:preloadError', preloadEvent())
    advance(STALE_BUILD_GUARD_MS)
    fire('vite:preloadError', preloadEvent())
    expect(reloads()).toBe(2)
  })
})
