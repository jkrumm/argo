import { createBrowserHistory } from '@tanstack/react-router'
import type { RouterHistory } from '@tanstack/react-router'

/**
 * Browser history for the finance pages that keeps filter values out of the address bar.
 *
 * Merchant, category, search term, event and the focused category are the vault's data. The HyperDX
 * SDK stamps `window.location.href` on every span, so a `?merchant=Landlord` in the URL would carry
 * it to ClickStack on the VPS. The router and the search stores keep working on the REAL location
 * (every control, drill-down link and setter is unchanged); this history only changes what the
 * browser shows and stores:
 *
 * - the address bar (`createHref`) gets the path with everything but `from`, `to` and `year` removed;
 * - the real path rides along in `history.state` (`__finHref`), so back/forward, and a reload that
 *   keeps the entry, restore the filters, while a URL opened fresh or shared starts without them.
 *
 * TanStack's own route masks were tried first and do not fit: a mask's `search` function only sees
 * the current location, never the destination, so it cannot derive "the destination minus its
 * filters". `private-history.test.ts` pins the behaviour.
 */

/** The only finance search params the address bar may show: a month range and the tax year. */
const VISIBLE_IN_URL: ReadonlySet<string> = new Set(['from', 'to', 'year'])

const REAL_HREF = '__finHref'
const FINANCE_PATH = /^\/finance(?:[/?#]|$)/

const decode = (raw: string): string => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** True for an unset filter as the router writes it: nothing, or an empty JSON string. */
const isEmpty = (raw: string): boolean => raw === '' || raw === '""' || raw === '%22%22'

/**
 * The public form of a router href: for a finance path, its query without any parameter outside
 * `VISIBLE_IN_URL` (and without unset ones); every other path is returned as it is. Parameters are
 * kept byte for byte, so the router parses what it wrote.
 */
export function publicFinanceHref(href: string): string {
  if (!FINANCE_PATH.test(href)) return href
  const hashAt = href.indexOf('#')
  const hash = hashAt === -1 ? '' : href.slice(hashAt)
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt)
  const queryAt = beforeHash.indexOf('?')
  if (queryAt === -1) return href
  const path = beforeHash.slice(0, queryAt)
  const kept = beforeHash
    .slice(queryAt + 1)
    .split('&')
    .filter((pair) => {
      if (pair === '') return false
      const eq = pair.indexOf('=')
      const key = decode(eq === -1 ? pair : pair.slice(0, eq))
      const value = eq === -1 ? '' : pair.slice(eq + 1)
      return VISIBLE_IN_URL.has(key) && !isEmpty(value)
    })
  return `${path}${kept.length === 0 ? '' : `?${kept.join('&')}`}${hash}`
}

type Win = {
  location: { pathname: string; search: string; hash: string }
  history: { state: Record<string, unknown> | null }
}

/** The history location of the entry the browser is on: the real href from state when it has one. */
function currentLocation(win: Win) {
  const state = (win.history.state ?? {}) as Record<string, unknown> & { __TSR_index?: number }
  const real = state[REAL_HREF]
  const href =
    typeof real === 'string'
      ? real
      : `${win.location.pathname}${win.location.search}${win.location.hash}`
  const hashAt = href.indexOf('#')
  const searchAt = href.indexOf('?')
  return {
    href,
    pathname: href.slice(
      0,
      hashAt > 0
        ? searchAt > 0
          ? Math.min(hashAt, searchAt)
          : hashAt
        : searchAt > 0
          ? searchAt
          : href.length,
    ),
    search: searchAt > -1 ? href.slice(searchAt, hashAt === -1 ? undefined : hashAt) : '',
    hash: hashAt > -1 ? href.slice(hashAt) : '',
    state: state as never,
  }
}

/**
 * `createBrowserHistory` with the finance filters kept out of `window.location`. `win` is the
 * browser window (injectable for tests).
 */
export function createPrivateFinanceHistory(win: Win = window as never): RouterHistory {
  const history = createBrowserHistory({
    window: win,
    parseLocation: () => currentLocation(win),
    createHref: publicFinanceHref,
  })
  const withRealHref = (path: string, state: unknown) => {
    const next = { ...(state as Record<string, unknown> | undefined) }
    if (publicFinanceHref(path) === path) delete next[REAL_HREF]
    else next[REAL_HREF] = path
    return next
  }
  const { push, replace } = history
  history.push = (path, state, options) => push(path, withRealHref(path, state), options)
  history.replace = (path, state, options) => replace(path, withRealHref(path, state), options)
  return history
}
