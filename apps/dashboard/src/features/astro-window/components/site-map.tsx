import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Box,
  Card,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
  useComputedColorScheme,
} from '@mantine/core'
import { IconAdjustments, IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type MapMouseEvent,
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
import { MAP_MIN_HEIGHT } from '../constants'
import { ChartEmpty } from '../charts/empty'
import {
  baseLayer,
  LP_RAMP,
  LP_RAMP_MAX,
  LP_RAMP_MIN,
  LP_SITE_BAND,
  RADAR_FRAME_MS,
  radarFrameTimes,
  SCHEME_DEFAULT_BASE,
  SCHEME_STYLE_URL,
  weatherLayer,
  type MapLayerState,
} from '../map-layers'
import {
  detachTerrainIfUnwanted,
  installOverlays,
  paintOverlays,
  refreshLpRamp,
  syncTerrain,
  type OverlayState,
} from './map-overlays'
import { MapSettingsDrawer } from './map-settings-drawer'
import { ScoutPanel } from './scout-panel'

/*
 * Attribution is contractually required and comes from the SOURCE, not the style: OpenFreeMap's
 * style JSON has none, but the TileJSON it points at (`/planet`) carries the canonical linked
 * string, which MapLibre renders on its own. Passing `customAttribution` as well printed it twice
 * — so the control is mounted bare and the source supplies the text. Every source in the layer
 * catalogue follows the same rule: it declares its own credit, and MapLibre composes them.
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

/**
 * Our tile route is bearer-guarded, and `transformRequest` is the only place MapLibre lets an
 * Authorization header onto a tile request. The match is a PREFIX test against the API base URL,
 * never a substring like '/astro/' — a third-party URL containing that substring would otherwise
 * be handed our token. Every weather overlay in the catalogue is somebody else's host, so this
 * predicate is the thing keeping the token off them.
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
  layers,
  onLayersChange,
}: {
  siteId: string
  onSelectSite: (id: string) => void
  height: number | string
  /** The decoded search params — the single source of truth for what is on the map. */
  layers: MapLayerState
  onLayersChange: (next: MapLayerState) => void
}) {
  const { data } = useSuspenseQuery(astroQueries.sites())
  // `useComputedColorScheme` (not `useMantineColorScheme`) so an `auto` scheme following the OS
  // resolves to what the CSS vars actually are — the ramp is read from those vars, so a guess
  // here would paint the light shades onto the dark basemap.
  const resolvedScheme = useComputedColorScheme('dark')

  const base = baseLayer(layers.base)
  // An imagery base is a raster mounted OVER the scheme's own vector style, so the labels survive
  // on top of it — which means the STYLE url only moves when a style base is picked.
  const styleUrl = base.kind === 'style' ? base.styleUrl : SCHEME_STYLE_URL[resolvedScheme]

  const radarActive = layers.weather.some((selection) => weatherLayer(selection.id)?.animated)
  /**
   * The frame timestamps are derived ONCE per radar activation and then held steady, so a
   * re-render, a restyle or a theme flip re-mounts exactly the same twelve sources instead of
   * re-requesting a shifted set. The consequence is deliberate: a map left open for hours keeps
   * showing the frames it opened with, which is why the timestamp is on screen in mono.
   */
  const radarTimes = useMemo(() => (radarActive ? radarFrameTimes(new Date()) : []), [radarActive])

  const overlayState = useMemo<OverlayState>(
    () => ({ ...layers, radarTimes }),
    [layers, radarTimes],
  )

  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // The last clicked coordinate — held even after the panel closes, so reopening it (or clicking
  // the same spot again) reads from cache instead of re-fetching. `null` until the first click.
  const [scoutPoint, setScoutPoint] = useState<{ lat: number; lon: number } | null>(null)
  const [scoutOpen, setScoutOpen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const initialStyleRef = useRef(styleUrl)
  const isFirstStyleRef = useRef(true)
  const hasStyleLoadedRef = useRef(false)
  const hasFitRef = useRef(false)
  const onSelectSiteRef = useRef(onSelectSite)
  onSelectSiteRef.current = onSelectSite
  // `style.load` fires asynchronously and has to rebuild whatever the CURRENT state asks for, so
  // it reads the state off refs rather than closing over the values it was subscribed with.
  const overlayStateRef = useRef(overlayState)
  overlayStateRef.current = overlayState
  const frameRef = useRef(frame)
  frameRef.current = frame
  const [failed, setFailed] = useState(false)

  // Create/destroy exactly once. React 19 StrictMode double-invokes effects, so the create and
  // the teardown must live in the SAME effect with an empty dep array — never split across two.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: initialStyleRef.current,
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
    // a hidden map answers none. It also swallows the weather overlays' own failures, which
    // are third-party hosts we do not control.
    map.on('error', () => {
      if (!hasStyleLoadedRef.current) setFailed(true)
    })

    // `style.load` fires once for the initial style AND again for every style the map loads
    // afterwards, which is what makes the overlays survive a theme toggle — see the setStyle
    // effect below for why that event is guaranteed to fire on a swap.
    map.on('style.load', () => {
      hasStyleLoadedRef.current = true
      installOverlays(map, overlayStateRef.current)
      paintOverlays(map, overlayStateRef.current, frameRef.current)
      // AFTER installOverlays: `syncTerrain` reads the DEM source `installOverlays` just added,
      // and `setTerrain` against a source that is not yet in the style is the ordering bug the
      // shared source id (`map-overlays.ts`) exists to avoid.
      syncTerrain(map, overlayStateRef.current)
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

  // Click-anywhere scouting. Registered in its own effect (same empty-deps timing as the create
  // effect above — `mapRef.current` is already set by the time this one runs, same commit, same
  // declaration order) rather than inside the create effect itself, so the map's lifecycle stays
  // the one thing that effect owns. A site marker's own click handler stops propagation before
  // this ever sees it — see the marker effect below.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handleClick = (event: MapMouseEvent) => {
      setScoutPoint({ lat: event.lngLat.lat, lon: event.lngLat.lng })
      setScoutOpen(true)
    }
    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [])

  /*
   * Style swap, step by step — the one thing most likely to be silently broken:
   *
   * 1. `styleUrl` changes, either because the colour scheme flipped (no base pinned) or because
   *    a base was picked in the drawer. This effect calls `setStyle` with the new one.
   * 2. `diff: false` is LOAD-BEARING. MapLibre's default (`diff: true`) fetches the new style
   *    and reconciles it against the current one with `Style.setState` — and because our own
   *    sources and layers exist only in the current style, the diff's verdict is "remove them".
   *    No new Style object is constructed, so `style.load` never fires and nothing re-adds them:
   *    the overlays would vanish on the first toggle and never come back. `diff: false` forces a
   *    full rebuild, which is exactly what fires `style.load`.
   * 3. `style.load` (subscribed once, in the create effect) runs `installOverlays` against the
   *    CURRENT state ref, so exactly the layers the drawer says are on come back — not a
   *    hardcoded set — and `buildLpRamp` re-reads the CSS vars, so the ramp's stops are the new
   *    scheme's shades. It resolves after the style fetch, long after Mantine has flipped
   *    `data-mantine-color-scheme`, so there is no read-too-early race.
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
    mapRef.current?.setStyle(styleUrl, { diff: false })
  }, [styleUrl])

  /*
   * The scheme and the style URL stopped being the same event the moment a base could be pinned:
   * flipping dark/light with an explicit base selected changes every CSS variable but loads no
   * new style, so nothing fires `style.load` and the ramp would keep painting the other scheme's
   * shades. Re-resolving the paint expression is cheap and touches no source.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasStyleLoadedRef.current) return
    refreshLpRamp(map, overlayStateRef.current)
  }, [resolvedScheme])

  // Drawer changes: add/remove sources and layers, then paint. Guarded on the style being up —
  // when it is not, `style.load` will run both against the same ref and nothing is lost.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasStyleLoadedRef.current) return
    // Detach BEFORE the stack sync: turning 3D off drops the DEM source, and MapLibre does not
    // stop `removeSource` from pulling a source out from under `setTerrain` — see `syncTerrain`.
    detachTerrainIfUnwanted(map, overlayState)
    installOverlays(map, overlayState)
    paintOverlays(map, overlayState, frameRef.current)
    syncTerrain(map, overlayState)
  }, [overlayState])

  // The radar loop's only per-frame work: one `setPaintProperty` per frame layer. Never a
  // re-add and never a re-request — the frames are already sources, and MapLibre's default
  // paint transition turns the step into a crossfade.
  //
  // `overlayState` deliberately stays OUT of the dep array and is read off the ref instead: the
  // effect above already re-paints on every real `overlayState` change (right after
  // `installOverlays` syncs the sources/layers it may have just added), so keeping it here too
  // ran a second, redundant `paintOverlays` pass on every drawer toggle or opacity commit.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasStyleLoadedRef.current) return
    paintOverlays(map, overlayStateRef.current, frame)
  }, [frame])

  /*
   * The loop itself. Two shutdown paths, both required:
   *
   * - Leaving the Map tab unmounts this component (the route renders it conditionally), so the
   *   cleanup below is what stops it.
   * - Backgrounding the browser tab does NOT unmount, so `visibilitychange` pauses the interval
   *   instead. The frames are already downloaded, so a hidden loop costs no requests — but it
   *   does cost a GPU repaint every 500 ms for a canvas nobody is looking at.
   */
  const frameCount = radarTimes.length
  useEffect(() => {
    if (!playing || frameCount === 0) return
    let timer: number | undefined
    const start = () => {
      timer ??= window.setInterval(
        () => setFrame((current) => (current + 1) % frameCount),
        RADAR_FRAME_MS,
      )
    }
    const stop = () => {
      if (timer === undefined) return
      window.clearInterval(timer)
      timer = undefined
    }
    const sync = () => (document.visibilityState === 'visible' ? start() : stop())
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [playing, frameCount])

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
        el.addEventListener('click', (event) => {
          // A `Marker` element mounts INSIDE `map.getCanvasContainer()` (verified against the
          // installed maplibre-gl 6.3.0 source), the same node MapLibre's own click handler
          // listens on — so an un-stopped click bubbles into the map's `click` handler below and
          // would open the scout panel for whatever coordinate sits under the pin, on top of
          // selecting the site.
          event.stopPropagation()
          onSelectSiteRef.current(site.id)
        })
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
    if (hasStyleLoadedRef.current) {
      fit()
      return
    }
    map.once('style.load', fit)
    // Symmetric with the markers effect above: a pending `once` listener must be
    // cancelled on cleanup too, or a remount before the style finishes loading
    // leaves a stale `fit` closure (over a `bounds` from an earlier `data`)
    // registered against the map.
    return () => {
      map.off('style.load', fit)
    }
  }, [data])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const closeScoutPanel = useCallback(() => setScoutOpen(false), [])
  const compareSite = data.data.find((site) => site.id === siteId)

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
        <>
          {/* One cluster, laid out by a Group — the radar clock appears beside the settings
              trigger rather than at a second hand-guessed offset. */}
          <Box pos="absolute" top={8} left={8}>
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <Tooltip label="Map layers">
                <ActionIcon
                  variant="default"
                  aria-label="Map layers"
                  onClick={() => setDrawerOpen(true)}
                >
                  <IconAdjustments size={16} />
                </ActionIcon>
              </Tooltip>
              {frameCount > 0 && (
                <RadarClock
                  times={radarTimes}
                  frame={frame}
                  playing={playing}
                  onToggle={() => setPlaying((current) => !current)}
                />
              )}
            </Group>
          </Box>
          {layers.lpYear !== null && <LpLegend year={layers.lpYear} />}
        </>
      )}
      <MapSettingsDrawer
        opened={drawerOpen}
        onClose={closeDrawer}
        state={layers}
        onChange={onLayersChange}
        schemeDefaultBase={SCHEME_DEFAULT_BASE[resolvedScheme]}
      />
      <ScoutPanel
        opened={scoutOpen}
        onClose={closeScoutPanel}
        point={scoutPoint}
        compareSite={compareSite}
      />
    </Card>
  )
}

// ── Radar clock ────────────────────────────────────────────────────────────

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * The frame's own timestamp, in the viewer's local zone, plus the single fact that decides how
 * much to trust it: a frame later than the wall clock is DWD's nowcast, not a measurement.
 * Numerals in JetBrains Mono per DESIGN.md.
 */
function RadarClock({
  times,
  frame,
  playing,
  onToggle,
}: {
  times: readonly string[]
  frame: number
  playing: boolean
  onToggle: () => void
}) {
  const iso = times[Math.min(frame, times.length - 1)] ?? null
  if (iso === null) return null
  const at = new Date(iso)
  const forecast = at.getTime() > Date.now()

  return (
    <Paper py="xs" px="sm">
      <Group gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={playing ? 'Pause radar loop' : 'Play radar loop'}
          onClick={onToggle}
        >
          {playing ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
        </ActionIcon>
        <Text ff="monospace" size="xs">
          {CLOCK_FORMAT.format(at)}
        </Text>
        <Text size="xs" c="dimmed">
          {forecast ? 'nowcast' : 'observed'}
        </Text>
      </Group>
    </Paper>
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
 * decide anything: the two ends, and the value the site markers have to clear. The atlas vintage
 * rides along because the drawer can now change it — a legend that did not say which year it was
 * describing would be the wrong kind of quiet. Numerals in JetBrains Mono per DESIGN.md.
 */
function LpLegend({ year }: { year: number }) {
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
            , where the sites sit{' '}
            <Text span ff="monospace" size="xs" c="dimmed">
              ({year})
            </Text>
          </Text>
        </Stack>
      </Paper>
    </Box>
  )
}
