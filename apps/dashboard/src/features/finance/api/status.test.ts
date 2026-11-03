import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Query } from '@tanstack/react-query'

// `api-base.ts` reads `window.location.origin` and the auth store persists to localStorage at import;
// bun test has no DOM, so both are stubbed before the dynamic imports.
let mod: typeof import('./status')
let authMod: typeof import('../../../lib/auth')

beforeAll(async () => {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  }
  ;(globalThis as { window?: unknown }).window = {
    location: { origin: 'http://argo.test' },
    localStorage,
  }
  authMod = await import('../../../lib/auth')
  mod = await import('./status')
})

const realFetch = globalThis.fetch
type Call = { url: string; init: RequestInit }
let calls: Call[] = []

function stubFetch(respond: () => Response | Promise<Response>) {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return respond()
  }) as typeof fetch
}

beforeEach(() => authMod.useAuthStore.getState().setToken('argo-token'))
afterEach(() => {
  globalThis.fetch = realFetch
  authMod.clearToken()
})

const VAULT_KEY = 'ab12'.repeat(16)

describe('unlockVault', () => {
  it('posts the key once, as the body, to /finance/unlock with Argo’s bearer', async () => {
    stubFetch(() => new Response(null, { status: 204 }))
    expect(await mod.unlockVault(VAULT_KEY)).toEqual({ kind: 'unlocked' })
    expect(calls).toHaveLength(1)
    const call = calls[0] as Call
    expect(call.url.endsWith('/api/finance/unlock')).toBe(true)
    expect(call.init.method).toBe('POST')
    expect(call.init.body).toBe(JSON.stringify({ key: VAULT_KEY }))
    expect((call.init.headers as Record<string, string>)['Authorization']).toBe('Bearer argo-token')
    // The key is in the body only: not in the URL, not in any header.
    expect(call.url).not.toContain(VAULT_KEY)
    expect(JSON.stringify(call.init.headers)).not.toContain(VAULT_KEY)
  })

  it('maps 401 to wrong-key', async () => {
    stubFetch(() => Response.json({ error: 'wrong key' }, { status: 401 }))
    expect(await mod.unlockVault(VAULT_KEY)).toEqual({ kind: 'wrong-key' })
  })

  it('maps 429 to throttled and carries the end of the pause', async () => {
    stubFetch(() =>
      Response.json(
        { error: 'blocked', unlock_blocked_until: '2026-11-03T12:00:00Z' },
        { status: 429 },
      ),
    )
    expect(await mod.unlockVault(VAULT_KEY)).toEqual({
      kind: 'throttled',
      blockedUntil: '2026-11-03T12:00:00Z',
    })
  })

  it('maps 429 without a body to throttled with no end time', async () => {
    stubFetch(() => new Response(null, { status: 429 }))
    expect(await mod.unlockVault(VAULT_KEY)).toEqual({ kind: 'throttled', blockedUntil: null })
  })

  it('maps 503 and a network failure to unavailable', async () => {
    stubFetch(() => Response.json({ error: 'finance service unavailable' }, { status: 503 }))
    expect(await mod.unlockVault(VAULT_KEY)).toEqual({ kind: 'unavailable' })
    stubFetch(() => Promise.reject(new TypeError('network down')))
    expect(await mod.unlockVault(VAULT_KEY)).toEqual({ kind: 'unavailable' })
  })

  it('never puts the key into a thrown error or a returned outcome', async () => {
    stubFetch(() => Promise.reject(new TypeError(`failed for ${'x'}`)))
    const outcome = await mod.unlockVault(VAULT_KEY)
    expect(JSON.stringify(outcome)).not.toContain(VAULT_KEY)
  })
})

describe('startSync / lockVault', () => {
  it('reads 202 as started and 409 as already running', async () => {
    stubFetch(() => Response.json({ started: true }, { status: 202 }))
    expect(await mod.startSync()).toBe('started')
    expect(calls[0]?.url.endsWith('/api/finance/sync')).toBe(true)
    stubFetch(() => Response.json({ error: 'running' }, { status: 409 }))
    expect(await mod.startSync()).toBe('already-running')
  })

  it('throws the lock message on 423 so the caller can drop to the unlock screen', async () => {
    stubFetch(() => Response.json({ error: 'locked' }, { status: 423 }))
    await expect(mod.startSync()).rejects.toThrow('The vault is locked.')
  })

  it('lock succeeds on 204 and throws otherwise', async () => {
    stubFetch(() => new Response(null, { status: 204 }))
    await mod.lockVault()
    stubFetch(() => new Response(null, { status: 503 }))
    await expect(mod.lockVault()).rejects.toThrow()
  })
})

describe('statusOptions polling', () => {
  const interval = (data: unknown) => {
    const refetchInterval = mod.statusOptions.refetchInterval as (q: Query) => number
    return refetchInterval({ state: { data } } as unknown as Query)
  }

  it('polls every 30 s, and every 5 s while a sync runs', () => {
    expect(interval(undefined)).toBe(30_000)
    expect(interval({ locked: true, unlock_blocked_until: null })).toBe(30_000)
    expect(interval({ locked: false, syncing: false, last_sync: null })).toBe(30_000)
    expect(interval({ locked: false, syncing: true, last_sync: null })).toBe(5_000)
  })
})
