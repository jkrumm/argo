/**
 * A tab that stays open across a deploy still runs the old bundle. Its next lazy route asks for
 * chunks the new release no longer serves, Vite's preload helper fails (one `error` event per
 * `<link>` it injected, ~20 per route change) and the page is stuck on the old build. One reload
 * fetches the new index and its chunks.
 *
 * The first failing link reloads at once. HyperDX records that one error; the rest of the burst
 * arrives while the page is leaving and is stopped before HyperDX's listener (so one stale tab is
 * not twenty error spans and a false browser-errors alert). A failure inside the guard window of an
 * earlier reload is a broken release, not a stale tab: it is left alone and surfaces normally.
 */

export const STALE_BUILD_RELOAD_KEY = 'argo:stale-build-reload'
export const STALE_BUILD_GUARD_MS = 30_000

type Listener = (event: Event) => void
type Target = {
  addEventListener(type: string, listener: Listener, capture?: boolean): void
  location: { reload(): void }
}
type Store = Pick<Storage, 'getItem' | 'setItem'>

/** A `<link>` Vite injected to preload a built chunk or its stylesheet. */
export function isBuildAssetLink(target: unknown): boolean {
  const link = target as { tagName?: string; rel?: string; href?: string } | null
  if (link?.tagName !== 'LINK') return false
  if (link.rel !== 'modulepreload' && link.rel !== 'stylesheet') return false
  return (link.href ?? '').includes('/assets/')
}

/**
 * `sessionStorage` throws on access where storage is blocked. A reload discards anything held in
 * memory, so no guard could survive it: the fallback reports a reload as just done, which turns
 * the recovery off (the failure surfaces as it did before) instead of risking a reload loop.
 */
export function sessionStore(win: { sessionStorage: Store }): Store {
  try {
    return win.sessionStorage
  } catch {
    return { getItem: () => String(Date.now()), setItem: () => {} }
  }
}

export function installStaleBuildRecovery(
  win: Target,
  store: Store,
  now: () => number = Date.now,
): void {
  let reloading = false

  /** True when this call started a reload, false inside the guard window. */
  const reloadOnce = (): boolean => {
    if (reloading) return true
    if (now() - Number(store.getItem(STALE_BUILD_RELOAD_KEY) ?? 0) < STALE_BUILD_GUARD_MS) {
      return false
    }
    reloading = true
    store.setItem(STALE_BUILD_RELOAD_KEY, String(now()))
    win.location.reload()
    return true
  }

  // Capture phase on the window runs before HyperDX's listener on the document element. The first
  // failing link must reach its target (Vite's helper rejects on it); the rest of the burst only
  // reaches HyperDX, so they stop here.
  win.addEventListener(
    'error',
    (event) => {
      if (!isBuildAssetLink(event.target)) return
      const alreadyReloading = reloading
      if (reloadOnce() && alreadyReloading) event.stopImmediatePropagation()
    },
    true,
  )

  win.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault()
  })
}
