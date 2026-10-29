import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'

// `readPersistedValue` reads `localStorage`; plain `bun test` has no DOM, so install the
// smallest Storage that satisfies it before the stores are evaluated.
const data = new Map<string, string>()
const localStorage = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
}
Object.assign(globalThis, { localStorage, window: { localStorage, addEventListener() {} } })

const {
  astroStore,
  calendarStore,
  garminStore,
  strengthStore,
  toApiWindow,
  usageStore,
  validateUsageSearch,
  walkingStore,
} = await import('./window-stores')

const persist = (key: string, record: Record<string, unknown>) =>
  data.set(`basalt:${key}`, JSON.stringify({ v: 1, value: record }))

beforeEach(() => data.clear())
afterEach(() => setSystemTime())

describe('lane order URL ⊳ localStorage ⊳ fallback', () => {
  it('falls back when neither lane has a value', () => {
    expect(garminStore.validateSearch({}).window).toBe('30d')
  })

  it('storage beats the fallback', () => {
    persist('garmin-health:window', { window: { preset: '1y' } })
    expect(garminStore.validateSearch({}).window).toBe('1y')
  })

  it('URL beats storage', () => {
    persist('garmin-health:window', { window: { preset: '1y' } })
    expect(garminStore.validateSearch({ window: '7d' }).window).toBe('7d')
  })

  it('an invalid URL value falls back (to storage when present, else the fallback)', () => {
    expect(garminStore.validateSearch({ window: 'bogus' }).window).toBe('30d')
    persist('garmin-health:window', { window: { preset: '1y' } })
    expect(garminStore.validateSearch({ window: 'bogus' }).window).toBe('1y')
  })

  it('linkSearch (nav, no URL) resolves storage ⊳ fallback at click time', () => {
    expect(astroStore.linkSearch().tab).toBe('tonight')
    persist('astro-window', { tab: 'map' })
    expect(astroStore.linkSearch().tab).toBe('map')
  })

  it('clamps a hand-typed number to the field bounds and rejects non-integers', () => {
    expect(astroStore.validateSearch({ nights: '99' }).nights).toBe(14)
    expect(astroStore.validateSearch({ nights: '7.5' }).nights).toBe(10)
  })
})

describe('lanes opted out', () => {
  it('persist:false never reads storage (strength tab)', () => {
    persist('strength-tracker:window', { tab: 'history' })
    expect(strengthStore.validateSearch({}).tab).toBe('charts')
    expect(strengthStore.validateSearch({ tab: 'train' }).tab).toBe('train')
  })

  it('url:false is absent from the URL lane and never read from it (walking metrics)', () => {
    const search = walkingStore.validateSearch({ metrics: 'steps' }) as Record<string, unknown>
    expect('metrics' in search).toBe(false)
  })

  it('url:false is still readable from storage', () => {
    persist('walking-pad', { metrics: ['steps'] })
    expect(walkingStore.readStored().metrics).toEqual(['steps'])
  })
})

describe('multi fields', () => {
  it('a URL list beats storage, unknown members are dropped', () => {
    persist('usage-tracking', { workspace: ['private'] })
    expect(usageStore.validateSearch({ workspace: ['work', 'nope'] }).workspace).toEqual(['work'])
  })
})

describe('usageStore view, lens and groupBy', () => {
  it('opens on the overview, in dollars, grouped by tool', () => {
    const v = usageStore.validateSearch({})
    expect([v.view, v.lens, v.groupBy]).toEqual(['overview', 'cost', 'sub_tool'])
  })

  it('accepts every value from the URL', () => {
    expect(usageStore.validateSearch({ view: 'iu-api' }).view).toBe('iu-api')
    expect(usageStore.validateSearch({ lens: 'tokens' }).lens).toBe('tokens')
    expect(usageStore.validateSearch({ groupBy: 'project' }).groupBy).toBe('project')
    expect(usageStore.validateSearch({ grain: 'hour' }).grain).toBe('hour')
  })

  it('unknown values fall back, storage beats the fallback', () => {
    persist('usage-tracking', { view: 'claude' })
    expect(usageStore.validateSearch({ lens: 'spend' }).lens).toBe('cost')
    expect(usageStore.validateSearch({ view: 'bogus' }).view).toBe('claude')
    expect(usageStore.validateSearch({ groupBy: 'source' }).groupBy).toBe('sub_tool')
  })

  it('opens on every account of the registry, falling back to all', () => {
    expect(usageStore.validateSearch({}).account).toBe('all')
    expect(usageStore.validateSearch({ account: 'me2' }).account).toBe('me2')
    expect(usageStore.validateSearch({ account: 'nobody' }).account).toBe('all')
  })

  it('opens the IU API tab on one key of the registry, falling back to personal', () => {
    expect(usageStore.validateSearch({}).iuKey).toBe('personal')
    expect(usageStore.validateSearch({ iuKey: 'athena-team' }).iuKey).toBe('athena-team')
    expect(usageStore.validateSearch({ iuKey: 'personal' }).iuKey).toBe('personal')
    expect(usageStore.validateSearch({ iuKey: 'nobody' }).iuKey).toBe('personal')
    // The retired `all` summed both keys in the records views; it never comes back.
    expect(usageStore.validateSearch({ iuKey: 'all' }).iuKey).toBe('personal')
  })

  it('groups the Claude Max tab by subscription', () => {
    expect(usageStore.validateSearch({ groupBy: 'payer' }).groupBy).toBe('payer')
  })

  it('folds the retired per-subscription tabs into Claude Max with that account selected', () => {
    const iu = validateUsageSearch({ view: 'iu-sub' })
    expect([iu.view, iu.account]).toEqual(['claude', 'iu'])
    const me = validateUsageSearch({ view: 'me-sub', account: 'me2' })
    expect([me.view, me.account]).toEqual(['claude', 'me'])
  })

  it('migrates a stored retired tab too, and leaves the live tabs alone', () => {
    persist('usage-tracking', { view: 'me-sub' })
    const stored = validateUsageSearch({})
    expect([stored.view, stored.account]).toEqual(['claude', 'me'])
    const api = validateUsageSearch({ view: 'iu-api', account: 'iu' })
    expect([api.view, api.account]).toEqual(['iu-api', 'iu'])
  })

  it('an old URL or stored value with the removed scope field neither crashes nor leaks', () => {
    persist('usage-tracking', { scope: 'api', lens: 'spend', groupBy: 'source' })
    const v = usageStore.validateSearch({ scope: 'iu-api', lens: 'spend' })
    expect([v.lens, v.groupBy]).toEqual(['cost', 'sub_tool'])
    expect('scope' in v).toBe(false)
  })
})

describe('range: toWindow', () => {
  const at = (y: number, m: number, d: number) => setSystemTime(new Date(y, m, d, 12))

  it('passes API-native presets through as { window }', () => {
    expect(garminStore.field.window.toWindow({ preset: '30d' })).toEqual({ window: '30d' })
  })

  it('resolves derived presets to explicit dates at call time', () => {
    at(2026, 9, 14)
    const w = garminStore.field.window
    expect(w.toWindow({ preset: '3m' })).toEqual({ from: '2026-07-14', to: '2026-10-14' })
    expect(w.toWindow({ preset: '1y' })).toEqual({ from: '2025-10-14', to: '2026-10-14' })
    expect(strengthStore.field.window.toWindow({ preset: 'ytd' })).toEqual({
      from: '2026-01-01',
      to: '2026-10-14',
    })
    // a later `now` moves the window — nothing is frozen at definition
    expect((at(2026, 9, 15), w.toWindow({ preset: '3m' }))).toEqual({
      from: '2026-07-15',
      to: '2026-10-15',
    })
  })

  it('custom with dates becomes { from, to }', () => {
    const v = garminStore.validateSearch({ window: 'custom', from: '2026-01-01', to: '2026-02-01' })
    expect(v.window).toBe('custom')
    expect(v.from).toBe('2026-01-01')
    expect(v.to).toBe('2026-02-01')
    expect(
      garminStore.field.window.toWindow({ preset: 'custom', from: '2026-01-01', to: '2026-02-01' }),
    ).toEqual({ from: '2026-01-01', to: '2026-02-01' })
  })

  it('custom without two ISO dates falls back before a page reads it', () => {
    expect(garminStore.validateSearch({ window: 'custom' }).window).toBe('30d')
    expect(garminStore.validateSearch({ window: 'custom', from: 'x', to: 'y' }).window).toBe('30d')
  })

  it('toApiWindow maps the unreachable dateless custom onto the API default', () => {
    expect(toApiWindow({ window: 'custom' }, '30d')).toEqual({ window: '30d' })
    expect(toApiWindow({ window: '7d' }, '30d')).toEqual({ window: '7d' })
    expect(toApiWindow({ from: 'a', to: 'b' }, '30d')).toEqual({ from: 'a', to: 'b' })
  })
})

describe('calendarStore', () => {
  it('opens on the agenda', () => {
    expect(calendarStore.validateSearch({}).view).toBe('agenda')
  })

  it('accepts every tab from the URL', () => {
    for (const view of ['agenda', 'week', 'month'] as const) {
      expect(calendarStore.validateSearch({ view }).view).toBe(view)
    }
  })

  it('an unknown view falls back to the agenda', () => {
    expect(calendarStore.validateSearch({ view: 'year' }).view).toBe('agenda')
  })
})
