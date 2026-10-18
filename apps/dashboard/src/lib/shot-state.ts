/**
 * The `shot-state` URL param `basalt-ui shot` reloads a page with to capture the states its anchors
 * declare (`data-shot-states="empty loading error"`). `loading` and `error` are forced at the API
 * client (`shotFetcher`), so the page renders exactly what production renders on a hung or failed
 * fetch — for a route whose loader awaits its data that is the route's pending / error screen, not a
 * card, so its anchors do not declare those states; `empty`
 * is page-owned — a page substitutes its own empty data where `shotState() === 'empty'`.
 */
export type ShotState = 'empty' | 'loading' | 'error'

const STATES: readonly ShotState[] = ['empty', 'loading', 'error']

export function parseShotState(search: string): ShotState | null {
  const value = new URLSearchParams(search).get('shot-state')
  return STATES.find((state) => state === value) ?? null
}

// Read once at load: a router that later rewrites the search must not drop the state mid-capture.
const LOADED_WITH = parseShotState(globalThis.location?.search ?? '')

export function shotState(): ShotState | null {
  return LOADED_WITH
}

/** `fetch` for the API client: never settles under `loading`, answers 503 under `error`. */
export function shotFetcher(state: ShotState | null): typeof fetch {
  if (state === 'loading') return (() => new Promise<Response>(() => {})) as unknown as typeof fetch
  if (state === 'error') {
    return (async () =>
      new Response(JSON.stringify({ error: 'shot-state error' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
  }
  return fetch
}
