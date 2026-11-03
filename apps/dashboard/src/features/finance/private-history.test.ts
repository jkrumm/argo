import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { finStore } from '../../lib/window-stores'
import { createPrivateFinanceHistory, publicFinanceHref } from './lib/private-history'

const SENSITIVE = {
  merchant: 'Landlord GmbH',
  category: 'housing/rent',
  search: 'secret term',
  event: 'sailing-2026',
  focus: 'housing',
}
const SENSITIVE_VALUES = Object.values(SENSITIVE)

/** Just enough of a browser window: a session history, `location`, and popstate on back/forward. */
function fakeWindow(initial = '/finance/transactions') {
  type Entry = { url: string; state: Record<string, unknown> | null }
  const entries: Entry[] = [{ url: initial, state: null }]
  let index = 0
  const listeners = new Set<() => void>()
  const win = {
    get location() {
      const url = new URL(entries[index]!.url, 'http://argo.test')
      return { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href }
    },
    history: {
      get state() {
        return entries[index]!.state
      },
      get length() {
        return entries.length
      },
      pushState(state: Record<string, unknown>, _title: string, url: string) {
        entries.length = index + 1
        entries.push({ url, state })
        index++
      },
      replaceState(state: Record<string, unknown>, _title: string, url?: string) {
        entries[index] = { url: url ?? entries[index]!.url, state }
      },
      go(delta: number) {
        index = Math.min(Math.max(index + delta, 0), entries.length - 1)
        for (const listener of listeners) listener()
      },
      back() {
        this.go(-1)
      },
      forward() {
        this.go(1)
      },
    },
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  }
  return win
}

/** The address bar: what `window.location` shows, and so what the HyperDX SDK stamps on spans. */
const bar = (win: ReturnType<typeof fakeWindow>): string => {
  const { pathname, search, hash } = win.location
  return `${pathname}${search}${hash}`
}

const PATHS = [
  '/finance',
  '/finance/month/$month',
  '/finance/spending',
  '/finance/fixed',
  '/finance/events',
  '/finance/net-worth',
  '/finance/transactions',
  '/finance/tax',
]

function financeRouter(win = fakeWindow()) {
  const root = createRootRoute()
  const routeTree = root.addChildren(
    PATHS.map((path) =>
      createRoute({
        getParentRoute: () => root,
        path,
        validateSearch: finStore.validateSearch,
      }),
    ),
  )
  const router = createRouter({
    routeTree,
    history: createPrivateFinanceHistory(win as never),
    // bun test has no `document`; without this the router would treat itself as a server.
    isServer: false,
  })
  return { router, win }
}

// The router reads `window.origin` when it is not a server; bun test has no DOM.
const globals = globalThis as { window?: unknown }
const previousWindow = globals.window
beforeAll(() => {
  globals.window = { origin: 'http://argo.test' }
})
afterAll(() => {
  globals.window = previousWindow
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('no finance navigation puts a filter into window.location', () => {
  it('keeps merchant, category, search, event and focus out of the address on every finance route', async () => {
    const { router, win } = financeRouter()
    await router.load()
    const targets = [
      { to: '/finance' },
      { to: '/finance/month/$month', params: { month: '2026-10' } },
      { to: '/finance/spending' },
      { to: '/finance/fixed' },
      { to: '/finance/events' },
      { to: '/finance/net-worth' },
      { to: '/finance/transactions' },
      { to: '/finance/tax' },
    ]
    for (const target of targets) {
      await router.navigate({
        ...target,
        search: { from: '2026-01', to: '2026-10', ...SENSITIVE },
      } as never)
      await flush()
      const shown = bar(win)
      for (const value of SENSITIVE_VALUES) {
        expect([
          target.to,
          shown.includes(value),
          shown.includes(encodeURIComponent(value)),
        ]).toEqual([target.to, false, false])
      }
      for (const key of Object.keys(SENSITIVE)) expect(shown).not.toContain(`${key}=`)
      // The month range stays visible.
      expect(shown).toContain('from=')
      expect(shown).toContain('to=')
      // ...and the page still has its real filters.
      expect(router.state.location.search).toMatchObject(SENSITIVE)
    }
  })

  it('covers the search stores’ own setter navigation (`to: "."` with a search updater)', async () => {
    const { router, win } = financeRouter(fakeWindow('/finance/spending?from=2026-01&to=2026-10'))
    await router.load()
    await router.navigate({
      to: '.',
      search: (prev: object) => ({ ...prev, merchant: 'Grocer' }),
    } as never)
    await flush()
    expect(bar(win)).not.toContain('Grocer')
    expect(router.state.location.search).toMatchObject({ merchant: 'Grocer' })
  })

  it('leaves an unfiltered page with a clean URL (no empty params)', async () => {
    const { router, win } = financeRouter()
    await router.load()
    await router.navigate({ to: '/finance/tax', search: { from: '', to: '', year: '' } } as never)
    await flush()
    expect(bar(win)).toBe('/finance/tax')
  })

  it('back and forward restore the real filters from the history entry', async () => {
    const { router, win } = financeRouter()
    await router.load()
    await router.navigate({ to: '/finance/transactions', search: { merchant: 'Grocer' } } as never)
    await flush()
    await router.navigate({ to: '/finance/tax', search: {} } as never)
    await flush()
    router.history.back()
    await flush()
    await router.load()
    expect(router.state.location.pathname).toBe('/finance/transactions')
    expect(router.state.location.search).toMatchObject({ merchant: 'Grocer' })
    expect(bar(win)).not.toContain('Grocer')
    router.history.forward()
    await flush()
    await router.load()
    expect(router.state.location.pathname).toBe('/finance/tax')
  })

  it('a reload on the entry restores the filters; the address never had them', async () => {
    const first = financeRouter()
    await first.router.load()
    await first.router.navigate({
      to: '/finance/transactions',
      search: { from: '2026-02', category: 'food/groceries' },
    } as never)
    await flush()
    expect(bar(first.win)).not.toContain('food')
    // A new router over the same window and entry is what a reload builds.
    const reloaded = financeRouter(first.win)
    await reloaded.router.load()
    expect(reloaded.router.state.location.search).toMatchObject({
      from: '2026-02',
      category: 'food/groceries',
    })
  })

  it('a URL opened fresh (no history state) starts without filters', async () => {
    const { router } = financeRouter(fakeWindow('/finance/transactions?from=2026-02'))
    await router.load()
    expect(router.state.location.search).toMatchObject({ from: '2026-02' })
    expect(router.state.location.search).not.toHaveProperty('merchant')
  })

  it('anchors render the public href too', async () => {
    const { router } = financeRouter()
    await router.load()
    const built = router.buildLocation({
      to: '/finance/transactions',
      search: { from: '2026-01', category: 'food/groceries', merchant: 'Grocer' },
    } as never)
    const href = router.history.createHref(built.publicHref)
    expect(href).not.toContain('Grocer')
    expect(href).not.toContain('food')
    expect(href).toContain('from=')
  })
})

describe('publicFinanceHref', () => {
  it('keeps from/to/year, drops everything else and unset values, preserves bytes', () => {
    expect(
      publicFinanceHref(
        '/finance/transactions?from=2026-01&merchant=Landlord%20GmbH&to=2026-10&search=x&year=&category=a%2Fb#top',
      ),
    ).toBe('/finance/transactions?from=2026-01&to=2026-10#top')
    expect(publicFinanceHref('/finance?merchant=x')).toBe('/finance')
    expect(publicFinanceHref('/finance/month/2026-10?focus=housing')).toBe('/finance/month/2026-10')
  })

  it('a percent-encoded key cannot smuggle a filter through', () => {
    expect(publicFinanceHref('/finance/transactions?%6Derchant=Landlord')).toBe(
      '/finance/transactions',
    )
  })

  it('leaves every non-finance href untouched, even one with a merchant param', () => {
    expect(publicFinanceHref('/strength?merchant=x&range=30d')).toBe(
      '/strength?merchant=x&range=30d',
    )
    expect(publicFinanceHref('/financefoo?merchant=x')).toBe('/financefoo?merchant=x')
  })
})
