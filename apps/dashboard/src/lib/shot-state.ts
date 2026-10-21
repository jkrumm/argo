/**
 * The `shot-state` URL param `basalt-ui shot` reloads a page with to capture the states its anchors
 * declare (`data-shot-states="empty loading error"`). `loading` and `error` are forced at the API
 * client (`shotFetcher`), so the page renders exactly what production renders on a hung or failed
 * fetch — for a route whose loader awaits its data that is the route's pending / error screen, not a
 * card, so its anchors do not declare those states; `empty`
 * is page-owned — a page substitutes its own empty data where `shotState() === 'empty'`.
 *
 * Honoured in the production bundle on purpose: the redesign loop shoots the deployed dashboard
 * (`basalt-ui shot --base https://argo.jkrumm.com`). The param only changes what this tab renders
 * (it writes nothing), and the dashboard has one authenticated user; a URL carrying it is a shot URL.
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

/**
 * The `shot-map` URL param: the map's own forced states, read once at load like `shot-state`.
 * The Map tab's `SiteMap` is lazy and its canvas is MapLibre's, not the API client's, so
 * `shot-state` cannot reach it. `loading` never creates the map, so the pending note stays;
 * `error` never creates it either and renders the failed message. They are shot as their own
 * routes (`?tab=map&shot-map=loading|error`), never through `data-shot-states`. Honoured in the
 * production bundle for the same reason as `shot-state`, and it writes nothing.
 */
export type MapShotState = 'loading' | 'error'

const MAP_STATES: readonly MapShotState[] = ['loading', 'error']

export function parseMapShotState(search: string): MapShotState | null {
  const value = new URLSearchParams(search).get('shot-map')
  return MAP_STATES.find((state) => state === value) ?? null
}

const MAP_LOADED_WITH = parseMapShotState(globalThis.location?.search ?? '')

export function mapShotState(): MapShotState | null {
  return MAP_LOADED_WITH
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
