/**
 * A tab that stays open across a deploy still runs the old bundle. Its next lazy route asks for
 * chunks the new release no longer serves, Vite's preload helper fails (one `error` event per
 * `<link>` it injected, ~20 per route change) and the page is stuck on the old build. One reload
 * fetches the new index and its chunks.
 *
 * The per-link errors are swallowed before HyperDX's capturing `error` listener sees them (so one
 * stale tab is not twenty error spans and a false browser-errors alert); `vite:preloadError`
 * carries the real failure. A second failure inside the guard window is a broken release, not a
 * stale tab: it is left alone and surfaces as an unhandled rejection.
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

export function installStaleBuildRecovery(
  win: Target,
  store: Store,
  now: () => number = Date.now,
): void {
  win.addEventListener(
    'error',
    (event) => {
      if (isBuildAssetLink(event.target)) event.stopImmediatePropagation()
    },
    true,
  )

  win.addEventListener('vite:preloadError', (event) => {
    const last = Number(store.getItem(STALE_BUILD_RELOAD_KEY) ?? 0)
    if (now() - last < STALE_BUILD_GUARD_MS) return
    store.setItem(STALE_BUILD_RELOAD_KEY, String(now()))
    event.preventDefault()
    win.location.reload()
  })
}
