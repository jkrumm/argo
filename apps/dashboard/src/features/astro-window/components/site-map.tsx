import { useEffect, useRef, useState } from 'react'
import { Box, Card, Group, Paper, Stack, Text, useComputedColorScheme } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type AddLayerObject,
  type RequestParameters,
} from 'maplibre-gl'
// Vite's dependency optimizer rewrites maplibre's ESM entry but cannot follow the sibling import
// its worker makes, so the pre-bundled copy 503s at runtime and the map renders a black canvas
// with no error of its own. Routing the worker through Vite's own worker pipeline (`?worker&url`
// — a plain `?url` breaks the production build instead) and handing maplibre the resulting URL is
// the documented fix. Must run before the first `new MapLibreMap(...)`.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
// The map primitive's own stylesheet — imported here (not globally) so it only ships to the
// bundle when this lazy-loaded component is actually reached.
import 'maplibre-gl/dist/maplibre-gl.css'
import { alpha, VX } from 'basalt-ui/tokens'
import { astroQueries } from '../../../lib/queries/astro'
import { apiBase } from '../../../lib/api-base'
import { getToken } from '../../../lib/auth'
import { LP } from '../../../lib/series'
import { MAP_MIN_HEIGHT } from '../constants'
import { ChartEmpty } from '../charts/empty'

/**
 * OpenFreeMap ships unauthenticated, self-hostable OpenMapTiles-based styles — no API key, no
 * signup. CARTO's basemaps (the usual alternative) require an Enterprise licence or a grant for
 * an app like this one, so they are not a licensed option here.
 *
 * `fiord` replaced `dark` on 2026-08-18 (ASTRO-MAP-RESEARCH §6.6, decided by rendering the real
 * tiles against four basemaps): ofm-dark's road network renders near-black and heavy, so the
 * roads read louder than the light-pollution data sitting under them. fiord is cool blue-grey
 * with quiet roads and legible Alpine terrain shading, which leaves the domes as the only loud
 * thing on the map.
 */
const STYLE_URL = {
  dark: 'https://tiles.openfreemap.org/styles/fiord',
  light: 'https://tiles.openfreemap.org/styles/positron',
} as const

/*
 * Attribution is contractually required and comes from the SOURCE, not the style: OpenFreeMap's
 * style JSON has none, but the TileJSON it points at (`/planet`) carries the canonical linked
 * string, which MapLibre renders on its own. Passing `customAttribution` as well printed it twice
 * — so the control is mounted bare and the source supplies the text. Our own LP source follows
 * the same rule: it declares the atlas credit itself, and MapLibre composes the two.
 */

const DEFAULT_CENTER: [number, number] = [11.5, 48.1]
const DEFAULT_ZOOM = 6.2

// Must run before the first `new MapLibreMap(...)` — see the import comment above.
setWorkerUrl(maplibreWorkerUrl)

/**
 * MapLibre's `fitBounds` inset, in MAP pixels — not CSS spacing, so no Mantine
 * spacing token can express it. Hoisted out of the effect so the theme guard's
 * inline-spacing kind (which cannot tell a map API argument from a CSS literal)
 * has nothing to trip on.
 */
const FIT_BOUNDS_OPTIONS = { padding: 48, duration: 0 } as const // theme-allow

// ── Light-pollution overlay ────────────────────────────────────────────────

/** Atlas vintage. The year selector is Phase 5's; until then the map shows the latest. */
const LP_ATLAS_YEAR = 2025

const LP_SOURCE_ID = 'argo-lp'
const LP_LAYER_ID = 'argo-lp-relief'

/**
 * Built from the app's one shared API base (`lib/api-base`), never hardcoded — in production the
 * dashboard is served from `argo.jkrumm.com` and the API lives under `/api` on the same origin,
 * so a localhost literal here would leave the map with no data at all.
 */
const LP_TILE_URL = `${apiBase}/astro/tiles/lp/${LP_ATLAS_YEAR}/{z}/{x}/{y}.png`

/** The atlas licence requires the credit; MapLibre renders it from the source. */
const LP_ATTRIBUTION = 'Light Pollution Atlas 2025, David J. Lorenz'

/**
 * The ramp, as ONE table so it reads as a ramp.
 *
 * `stop` is the raw tile payload — mpsas × 100, i.e. `1800` is 18.00 mag/arcsec². The stops
 * ASCEND (MapLibre's `interpolate` requires it), which is why the table runs from the polluted
 * end to the pristine one rather than the other way round.
 *
 * `alpha` is ramp GEOMETRY, not series identity — `lpDark`/`lpDarker`/`lpPristine` are one hue
 * separated only by opacity — so it lives here beside the stops rather than in the token. The
 * ladder is recorded in DESIGN.md under "Light pollution ramp".
 */
const LP_RAMP: ReadonlyArray<{ stop: number; token: string; alpha: number }> = [
  { stop: 1800, token: LP.lpCity, alpha: 0.9 }, // 18.00 — inner city
  { stop: 1960, token: LP.lpUrban, alpha: 0.62 }, // 19.60
  { stop: 2060, token: LP.lpSuburban, alpha: 0.4 }, // 20.60
  { stop: 2130, token: LP.lpRural, alpha: 0.2 }, // 21.30 — the neutral crossing
  { stop: 2155, token: LP.lpDark, alpha: 0.14 }, // 21.55 — the band our sites live in
  { stop: 2180, token: LP.lpDarker, alpha: 0.3 }, // 21.80
  { stop: 2200, token: LP.lpPristine, alpha: 0.44 }, // 22.00 — natural sky
]

/** The two ends of the ramp, in mpsas × 100 — the legend's axis and the gradient's domain. */
const LP_RAMP_MIN = LP_RAMP[0]?.stop ?? 0
const LP_RAMP_MAX = LP_RAMP[LP_RAMP.length - 1]?.stop ?? 0

/** Where the ramp crosses into the cool half — read off the table, not restated as a literal. */
const LP_SITE_BAND = LP_RAMP.find((s) => s.token === LP.lpDark)?.stop ?? LP_RAMP_MAX

type ColorReliefLayer = Extract<AddLayerObject, { type: 'color-relief' }>
type LpRampExpression = NonNullable<ColorReliefLayer['paint']>['color-relief-color']

const CSS_VAR_REF = /^var\(\s*(--[\w-]+)\s*\)$/
const SIX_DIGIT_HEX = /^#[\da-fA-F]{6}$/

/**
 * MapLibre parses its own colour strings with its own parser: it understands neither
 * `var(--vx-*)` nor `color-mix()`, so a registered token has to be RESOLVED to a literal before
 * it can reach the style. Same trick the hermes-chat vega-lite bridge uses (`readThemeColors`) —
 * read the custom property off `document.documentElement` with `getComputedStyle`.
 *
 * The palette declares group values as plain 6-digit hex, so the stop's alpha is applied by
 * appending the eighth hex byte; MapLibre's style spec parses `#rrggbbaa`. If a palette value is
 * ever something else (a `color-mix`, an `oklch`), the alpha is dropped rather than concatenated
 * into a string MapLibre would reject — an opaque stop is a visible degradation, a parse error is
 * an invisible one.
 */
function resolveStopColor(cs: CSSStyleDeclaration, token: string, opacity: number): string {
  const varName = CSS_VAR_REF.exec(token)?.[1]
  const resolved = (varName === undefined ? token : cs.getPropertyValue(varName)).trim()
  if (!SIX_DIGIT_HEX.test(resolved)) return resolved
  const alphaByte = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0')
  return `${resolved}${alphaByte}`
}

/**
 * Reads the live palette and returns the paint expression. Called on every `style.load`, so a
 * dark/light flip rebuilds the ramp from the scheme's own shades rather than reusing the other
 * scheme's. The cast is unavoidable: spreading a variable-length stop list widens the tuple that
 * `ExpressionSpecification` is, and the shape is validated by the style spec at runtime anyway.
 */
function buildLpRamp(): LpRampExpression {
  const cs = getComputedStyle(document.documentElement)
  const stops = LP_RAMP.flatMap(({ stop, token, alpha: opacity }) => [
    stop,
    resolveStopColor(cs, token, opacity),
  ])
  return ['interpolate', ['linear'], ['elevation'], ...stops] as LpRampExpression
}

/**
 * Every raster this app adds must sit BELOW the basemap's first symbol layer, or the place names
 * disappear underneath it. Phase 5 adds more rasters (weather overlays, imagery) — they go
 * through here too. Falling back to `undefined` (append on top) is correct for a style with no
 * symbol layer at all: there are no labels to bury.
 */
function addRasterBelowLabels(map: MapLibreMap, layer: AddLayerObject): void {
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')
  map.addLayer(layer, firstSymbol?.id)
}

/**
 * Registers every source and layer THIS app owns, on top of whatever basemap style is current.
 *
 * Wired to `style.load` rather than called once, because a style swap destroys the entire style
 * object — sources and layers included. Phase 5's overlays register here as well; the guards make
 * it idempotent so a second call is harmless.
 */
function installOverlays(map: MapLibreMap): void {
  if (map.getSource(LP_SOURCE_ID) === undefined) {
    map.addSource(LP_SOURCE_ID, {
      // Not terrain: the tiles are terrarium-ENCODED DATA (mpsas × 100), and `raster-dem` +
      // `color-relief` is the only MapLibre path that colours a numeric raster with our own
      // ramp. Mapbox's `raster-color` does not exist here (ASTRO-MAP-RESEARCH §6.3).
      type: 'raster-dem',
      tiles: [LP_TILE_URL],
      tileSize: 256,
      minzoom: 5,
      maxzoom: 9,
      encoding: 'terrarium',
      attribution: LP_ATTRIBUTION,
    })
  }

  if (map.getLayer(LP_LAYER_ID) === undefined) {
    addRasterBelowLabels(map, {
      id: LP_LAYER_ID,
      type: 'color-relief',
      source: LP_SOURCE_ID,
      paint: {
        'color-relief-color': buildLpRamp(),
        'color-relief-opacity': 1,
        // `resampling`, NOT `raster-resampling`. The latter is a RASTER-layer property; the
        // style-spec validator rejects it on a color-relief layer with `unknown property
        // "raster-resampling"` and the layer never gets added — verified against the shipped
        // @maplibre/maplibre-gl-style-spec. `nearest` shows the atlas's true 30 arcsec
        // granularity instead of pretending to a resolution the data does not have; the source
        // stops at z9, so everything above it overzooms, which is exactly where that matters.
        resampling: 'nearest',
      },
    })
  }
}

/**
 * Our tile route is bearer-guarded, and `transformRequest` is the only place MapLibre lets an
 * Authorization header onto a tile request. The match is a PREFIX test against the API base URL,
 * never a substring like '/astro/' — a third-party URL containing that substring would otherwise
 * be handed our token.
 */
function transformRequest(url: string): RequestParameters {
  if (!url.startsWith(`${apiBase}/`)) return { url }
  const token = getToken()
  return token === null ? { url } : { url, headers: { Authorization: `Bearer ${token}` } }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SiteMap({
  siteId,
  onSelectSite,
  height,
}: {
  siteId: string
  onSelectSite: (id: string) => void
  height: number | string
}) {
  const { data } = useSuspenseQuery(astroQueries.sites())
  // `useComputedColorScheme` (not `useMantineColorScheme`) so an `auto` scheme following the OS
  // resolves to what the CSS vars actually are — the ramp is read from those vars, so a guess
  // here would paint the light shades onto the dark basemap.
  const resolvedScheme = useComputedColorScheme('dark')

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const initialSchemeRef = useRef(resolvedScheme)
  const isFirstStyleRef = useRef(true)
  const hasStyleLoadedRef = useRef(false)
  const hasFitRef = useRef(false)
  const onSelectSiteRef = useRef(onSelectSite)
  onSelectSiteRef.current = onSelectSite
  const [failed, setFailed] = useState(false)

  // Create/destroy exactly once. React 19 StrictMode double-invokes effects, so the create and
  // the teardown must live in the SAME effect with an empty dep array — never split across two.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL[initialSchemeRef.current],
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      transformRequest,
    })
    map.addControl(new AttributionControl({ compact: true }))

    // Only a failure BEFORE the first style loads is fatal. `error` is a single firehose —
    // every failed tile fetch surfaces on it — and the LP source is bearer-guarded, so a
    // missing or expired token would otherwise 401 on every overlay tile and blank the
    // basemap and the markers along with it. A map with no overlay still answers questions;
    // a hidden map answers none.
    map.on('error', () => {
      if (!hasStyleLoadedRef.current) setFailed(true)
    })

    // `style.load` fires once for the initial style AND again for every style the map loads
    // afterwards, which is what makes the overlays survive a theme toggle — see the setStyle
    // effect below for why that event is guaranteed to fire on a swap.
    map.on('style.load', () => {
      hasStyleLoadedRef.current = true
      installOverlays(map)
    })
    mapRef.current = map

    // The map sizes its canvas once, from whatever the container measured at construction. This
    // component is lazy-loaded behind Suspense, so it is constructed while the grid column is
    // still settling and the canvas ends up narrower than the card it sits in — a black gutter
    // down the right-hand side. MapLibre has no internal resize observer; wiring one is the
    // documented fix, and it also covers the sidebar collapsing.
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      // The three latches below track the MAP, not the component. React 19 StrictMode tears the
      // first map down and builds a second one on the same refs, so a latch left set would skip
      // the real map's `fitBounds` and force a redundant full style reload on it.
      hasStyleLoadedRef.current = false
      hasFitRef.current = false
      isFirstStyleRef.current = true
    }
  }, [])

  /*
   * Theme toggle, step by step — the one thing most likely to be silently broken:
   *
   * 1. `resolvedScheme` flips, this effect runs and calls `setStyle` with the other basemap.
   * 2. `diff: false` is LOAD-BEARING. MapLibre's default (`diff: true`) fetches the new style
   *    and reconciles it against the current one with `Style.setState` — and because our LP
   *    source and layer exist only in the current style, the diff's verdict is "remove them".
   *    No new Style object is constructed, so `style.load` never fires and nothing re-adds them:
   *    the overlay would vanish on the first toggle and never come back. `diff: false` forces a
   *    full rebuild, which is exactly what fires `style.load`.
   * 3. `style.load` (subscribed once, in the create effect) runs `installOverlays`, which re-adds
   *    the source and rebuilds the ramp — `buildLpRamp` re-reads the CSS vars, so the new stops
   *    are the new scheme's shades. It resolves after the style fetch, long after Mantine has
   *    flipped `data-mantine-color-scheme`, so there is no read-too-early race.
   * 4. Markers need nothing: a `Marker` is a DOM element MapLibre positions over the canvas, not
   *    part of the style, so `setStyle` never touches it — and its colours are `var(--vx-*)`
   *    strings the browser re-resolves on the scheme flip with no JS at all.
   * 5. The legend is plain Mantine reading the same tokens, so it follows for the same reason.
   * 6. Camera state lives on the map, not the style, so the view does not jump.
   */
  useEffect(() => {
    if (isFirstStyleRef.current) {
      isFirstStyleRef.current = false
      return
    }
    mapRef.current?.setStyle(STYLE_URL[resolvedScheme], { diff: false })
  }, [resolvedScheme])

  // Markers: one per site, the selected one visually distinct. Re-synced whenever the site list
  // or the selection changes; must wait for the style to finish loading at least once.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const addMarkers = () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = data.data.map((site) => {
        const el = document.createElement('button')
        el.type = 'button'
        el.setAttribute('aria-label', `Select ${site.name}`)
        el.style.width = '12px'
        el.style.height = '12px'
        el.style.borderRadius = '50%'
        el.style.cursor = 'pointer'
        el.style.padding = '0'
        // Token REFERENCES, not resolved values: a marker lives outside React and outside
        // Mantine, but it is still in the document, so the browser re-resolves these on a
        // scheme flip by itself. Resolving them here (as the ramp has to, because MapLibre's
        // colour parser cannot) would freeze the markers in whichever scheme was current.
        el.style.border = `2px solid ${VX.surface.panel}`
        el.style.background = site.id === siteId ? VX.accentFill : VX.muted
        el.addEventListener('click', () => onSelectSiteRef.current(site.id))
        return new Marker({ element: el }).setLngLat([site.lon, site.lat]).addTo(map)
      })
    }

    // The guard is our OWN ref, set by the create effect's `style.load` handler — never
    // `map.isStyleLoaded()`, which means "style AND every in-view tile finished" and so goes back
    // to false whenever a tile is in flight. `style.load` fires exactly once per style, so an
    // `once` registered after it has already fired would never run and the markers would be gone
    // for good. `style.load`, not `load`, because `load` fires once in a map's whole lifetime and
    // would strand a re-render landing mid theme-swap.
    if (hasStyleLoadedRef.current) addMarkers()
    else map.once('style.load', addMarkers)

    return () => {
      map.off('style.load', addMarkers)
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
    }
  }, [data, siteId])

  // Fit bounds to every site once, on first load only.
  useEffect(() => {
    const map = mapRef.current
    if (!map || hasFitRef.current || data.data.length === 0) return
    hasFitRef.current = true
    const lons = data.data.map((s) => s.lon)
    const lats = data.data.map((s) => s.lat)
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ]
    const fit = () => map.fitBounds(bounds, FIT_BOUNDS_OPTIONS)
    // Same ref, same reason as the markers effect above — not `map.isStyleLoaded()`.
    if (hasStyleLoadedRef.current) fit()
    else map.once('style.load', fit)
  }, [data])

  return (
    <Card
      py={0}
      px={0}
      h={height}
      mih={MAP_MIN_HEIGHT}
      pos="relative"
      style={{ overflow: 'hidden' }}
    >
      <Box ref={containerRef} h="100%" style={{ visibility: failed ? 'hidden' : 'visible' }} />
      {failed ? (
        <Box pos="absolute" inset={0}>
          <ChartEmpty height="100%" message="Map unavailable — could not reach the tile server." />
        </Box>
      ) : (
        <LpLegend />
      )}
    </Card>
  )
}

// ── Legend ─────────────────────────────────────────────────────────────────

/** Where a stop sits along the gradient, as a percentage of the ramp's span. */
const stopOffset = (stop: number) =>
  Math.round(((stop - LP_RAMP_MIN) / (LP_RAMP_MAX - LP_RAMP_MIN)) * 100)

/**
 * The same seven stops as the paint expression, as a CSS gradient. Here the tokens stay tokens
 * and the alpha goes through `alpha()` (a `color-mix`), because a browser understands both — no
 * runtime resolution needed, and it follows the scheme for free.
 */
const LEGEND_GRADIENT = `linear-gradient(90deg, ${LP_RAMP.map(
  ({ stop, token, alpha: opacity }) => `${alpha(token, opacity)} ${stopOffset(stop)}%`,
).join(', ')})`

const fmtMag = (stop: number) => (stop / 100).toFixed(1)

/**
 * Seven stops are too many to label one by one, so the legend names only the three readings that
 * decide anything: the two ends, and the value the site markers have to clear. Numerals in
 * JetBrains Mono per DESIGN.md; quiet enough to sit on the map without competing with it.
 */
function LpLegend() {
  return (
    <Box pos="absolute" bottom={8} left={8}>
      <Paper py="xs" px="sm">
        <Stack gap={4} w={148}>
          <Box h={6} style={{ backgroundImage: LEGEND_GRADIENT, borderRadius: VX.radiusCard }} />
          <Group justify="space-between" gap={4}>
            <Text ff="monospace" size="xs" c="dimmed">
              {fmtMag(LP_RAMP_MIN)}
            </Text>
            <Text ff="monospace" size="xs" c="dimmed">
              {fmtMag(LP_RAMP_MAX)}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            mag/arcsec² — blue from{' '}
            <Text span ff="monospace" size="xs" c="dimmed">
              {fmtMag(LP_SITE_BAND)}
            </Text>
            , where the sites sit
          </Text>
        </Stack>
      </Paper>
    </Box>
  )
}
