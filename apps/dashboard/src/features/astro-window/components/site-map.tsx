import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Box,
  Card,
  Group,
  Image,
  Paper,
  ScrollArea,
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
  type StyleSpecification,
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
  CONTOUR_GLYPHS_URL,
  legendUrl,
  LP_RAMP,
  LP_RAMP_MAX,
  LP_RAMP_MIN,
  LP_SITE_BAND,
  needsStaticTime,
  RADAR_FRAME_MS,
  RADAR_REFRESH_MS,
  radarFrameTimes,
  SCHEME_DEFAULT_BASE,
  SCHEME_STYLE_URL,
  staticWeatherTime,
  weatherLayer,
  type MapLayerState,
  type WeatherLayer,
  type WeatherSelection,
} from '../map-layers'
import {
  detachTerrainIfUnwanted,
  installOverlays,
  paintOverlayState,
  paintRadarFrame,
  refreshContours,
  refreshHillshade,
  refreshLpRamp,
  resolveLegendFontColor,
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

  /**
   * The DWD legend's `LEGEND_OPTIONS` `fontColor`, re-resolved from the live palette whenever the
   * scheme flips. Producing a NEW string on the dependency change is what makes the legend
   * `<Image>` re-request: React re-renders with a different `src`, which is enough on its own —
   * see `legendUrl` in `map-layers.ts` for why a hardcoded colour was wrong in the first place.
   */
  // `resolvedScheme` is not read inside the callback (the resolver reads the DOM directly) — it
  // is the dependency that forces this memo to re-run when the CSS vars it reads have changed.
  const legendFontColor = useMemo(
    () => resolveLegendFontColor(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedScheme],
  )

  const base = baseLayer(layers.base)
  /**
   * The resolved MapLibre style: a URL for a `style` base (or the scheme default for an
   * `imagery` base, which mounts as a raster OVER that vector style so its labels survive on top
   * of it), or an inline `StyleSpecification` OBJECT for a `raster-style` base (OpenTopoMap) —
   * its own tiles already carry every label, so there is no vector style to mount it over.
   *
   * It DOES need its own `glyphs` entry, though — every `kind: 'style'` base (and the
   * scheme-default vector style an `imagery` base mounts over) already ships one, but this is the
   * one base with no vector style underneath it, and the contour LABEL layer (`map-overlays.ts`)
   * is a `symbol` layer that can render on top of any base, this one included. `CONTOUR_GLYPHS_URL`
   * is OpenFreeMap's public glyph endpoint, the same host the vector styles above already use.
   *
   * Memoised on `[base, resolvedScheme]` so a `raster-style` base's object identity stays STABLE
   * across re-renders that touch neither: the style-swap effect below is keyed on this value, and
   * a fresh object literal every render would never `===` the last one, thrashing `setStyle` on
   * every unrelated state change.
   */
  const mapStyle = useMemo<StyleSpecification | string>(() => {
    if (base.kind === 'style') return base.styleUrl
    if (base.kind === 'raster-style') {
      const sourceId = `${base.id}-source`
      return {
        version: 8,
        glyphs: CONTOUR_GLYPHS_URL,
        sources: {
          [sourceId]: {
            type: 'raster',
            tiles: [...base.tiles],
            tileSize: 256,
            maxzoom: base.maxzoom,
            attribution: base.attribution ?? '',
          },
        },
        layers: [{ id: `${base.id}-layer`, type: 'raster', source: sourceId }],
      }
    }
    return SCHEME_STYLE_URL[resolvedScheme]
  }, [base, resolvedScheme])

  const radarActive = layers.weather.some((selection) => weatherLayer(selection.id)?.animated)
  const staticTimeActive = layers.weather.some((selection) => needsStaticTime(selection.id))

  /**
   * The shared refresh clock for `radarTimes` and `weatherTime` below — bumped every
   * `RADAR_REFRESH_MS` while radar OR a static-time layer (lightning/cells) is on, paused while
   * the tab is backgrounded (the same `visibilitychange` discipline the radar playback loop below
   * already uses). One clock drives both, so there is never a second interval to keep in sync.
   *
   * Restoring visibility also bumps `epoch` immediately, not just restarts the interval: a tab
   * hidden for longer than `RADAR_REFRESH_MS` would otherwise keep painting the timestamps it was
   * last mounted with for up to another interval on return — which is exactly the DWD
   * `ServiceExceptionReport` failure mode this clock exists to prevent (a request past the
   * published time extent returns a service exception, not a tile). A redundant bump on first
   * activation is harmless: the recomputed timestamps are identical, so `installOverlays` finds
   * every source id already in `wanted` and does nothing.
   */
  const timeSensitiveActive = radarActive || staticTimeActive
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    if (!timeSensitiveActive) return
    let timer: number | undefined
    const start = () => {
      timer ??= window.setInterval(() => setEpoch((current) => current + 1), RADAR_REFRESH_MS)
    }
    const stop = () => {
      if (timer === undefined) return
      window.clearInterval(timer)
      timer = undefined
    }
    // Bumping inside `sync` — rather than unconditionally on every effect run — ties the catch-up
    // to the visibility TRANSITION (or this activation) instead of running on every re-render:
    // this effect only re-runs when `timeSensitiveActive` itself flips, and `sync` itself only
    // re-fires on a real `visibilitychange` event, so there is no render loop here.
    const sync = () => {
      if (document.visibilityState !== 'visible') {
        stop()
        return
      }
      start()
      setEpoch((current) => current + 1)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [timeSensitiveActive])

  /**
   * The frame timestamps, refreshed every `RADAR_REFRESH_MS` while radar is active via `epoch` —
   * held steady in between so a re-render, a restyle or a theme flip re-mounts the same twelve
   * sources rather than a shifted set, but NOT frozen forever: a map left open for an hour would
   * otherwise keep requesting frames that have fallen behind DWD's moving `PT5M` extent, and once
   * a frame passes the extent it returns a `ServiceExceptionReport` instead of a tile (module
   * docstring, facts 1–2). The on-screen clock next to the loop reads whichever frame is live.
   */
  // `epoch` is a bump-only counter, deliberately unread inside the callback — it exists purely to
  // force this memo to recompute on the interval above.
  const radarTimes = useMemo(
    () => (radarActive ? radarFrameTimes(new Date()) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [radarActive, epoch],
  )

  /**
   * The single grid slot `lightning`/`cells` bake into their request — see `staticWeatherTime` in
   * `map-layers.ts`. Refreshed on the same `epoch` clock as `radarTimes`, for the identical reason:
   * neither layer carries a nowcast of its own (fact 3), so an unrefreshed anchor eventually points
   * at a slot DWD has stopped publishing.
   */
  const weatherTime = useMemo(
    () => staticWeatherTime(new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epoch],
  )

  const overlayState = useMemo<OverlayState>(
    () => ({ ...layers, radarTimes, weatherTime }),
    [layers, radarTimes, weatherTime],
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
  const initialStyleRef = useRef(mapStyle)
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
      paintOverlayState(map, overlayStateRef.current, frameRef.current)
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
   * 1. `mapStyle` changes, either because the colour scheme flipped (no base pinned) or because
   *    a base was picked in the drawer. This effect calls `setStyle` with the new one — a URL for
   *    a `style`/scheme-default `imagery` base, an inline object for a `raster-style` base.
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
    mapRef.current?.setStyle(mapStyle, { diff: false })
  }, [mapStyle])

  /*
   * The scheme and the style URL stopped being the same event the moment a base could be pinned:
   * flipping dark/light with an explicit base selected changes every CSS variable but loads no
   * new style, so nothing fires `style.load` and the ramp — and the hillshade relief, and the
   * contour line/label colours, the same palette-derived-paint problem in three places — would
   * keep painting the other scheme's shades. Re-resolving each paint expression is cheap and
   * touches no source.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasStyleLoadedRef.current) return
    refreshLpRamp(map, overlayStateRef.current)
    refreshHillshade(map, overlayStateRef.current)
    refreshContours(map, overlayStateRef.current)
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
    paintOverlayState(map, overlayState, frameRef.current)
    syncTerrain(map, overlayState)
  }, [overlayState])

  // The radar loop's only per-frame work: one `setPaintProperty` per frame layer, via
  // `paintRadarFrame` — never the drawer-state paint work (`paintOverlayState`), and never a
  // re-add or re-request. The frames are already sources, and MapLibre's default paint transition
  // turns the step into a crossfade.
  //
  // `overlayState` deliberately stays OUT of the dep array and is read off the ref instead: the
  // effect above already re-paints every drawer-state value on every real `overlayState` change
  // (right after `installOverlays` syncs the sources/layers it may have just added, including the
  // current radar frame — see `paintOverlayState`'s docblock), so keeping it here too would run a
  // second, redundant paint pass on every drawer toggle or opacity commit.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasStyleLoadedRef.current) return
    paintRadarFrame(map, overlayStateRef.current, frame)
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
          <WeatherLegends weather={layers.weather} fontColor={legendFontColor} />
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
 * The same stops as the paint expression (`LP_RAMP.length` of them — read the count off the
 * table, not restated as a literal here), as a CSS gradient. Here the tokens stay tokens and the
 * alpha goes through `alpha()` (a `color-mix`), because a browser understands both — no runtime
 * resolution needed, and it follows the scheme for free.
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

// ── Weather legends ────────────────────────────────────────────────────────

/**
 * The active weather layers' own DWD legends — a separate, bottom-RIGHT cluster so it never
 * collides with `LpLegend` at bottom-left. Answers the two halves of "toggle it on, nothing
 * appears, is this broken": what colour means what (the legend image), and what an empty render
 * means (`entry.emptyMeans`, right under it — a quiet night is data, not a failure).
 */
function WeatherLegends({
  weather,
  fontColor,
}: {
  weather: readonly WeatherSelection[]
  fontColor: string
}) {
  const active = weather
    .map((selection) => weatherLayer(selection.id))
    .filter((entry): entry is WeatherLayer => entry?.legend === true)
  if (active.length === 0) return null
  return (
    <Box pos="absolute" bottom={8} right={8}>
      <Stack gap="xs" align="stretch">
        {active.map((entry) => (
          <WeatherLegendCard key={entry.id} entry={entry} fontColor={fontColor} />
        ))}
      </Stack>
    </Box>
  )
}

/** The legend's max box height — a scroll region past this rather than a squash. Blitzdichte's
 * legend is 344 px tall; `mah={60}` (the old value) rendered it unreadably compressed. */
const LEGEND_MAX_HEIGHT = 180

/**
 * One legend card. The image is a third-party PNG on a host we don't control — `onError` hides it
 * quietly rather than letting a broken-image glyph sit on the map; the label and `emptyMeans` line
 * still render either way, so the card degrades to text instead of vanishing.
 *
 * `imageFailed` tracks the `src` it failed FOR, not a bare boolean latch: this component is keyed
 * by `entry.id` and stays mounted across a colour-scheme flip, but `fontColor` — and so `src` —
 * changes on every flip. A latch with no `src` awareness would hide the legend for the rest of the
 * session after one transient failure against DWD, even once a scheme flip produces a URL that
 * would load fine. Same derive-during-render reset `OpacitySlider` uses in
 * `map-settings-drawer.tsx` for its `committed`/`draft` pair, preferred over a `useEffect`.
 */
function WeatherLegendCard({ entry, fontColor }: { entry: WeatherLayer; fontColor: string }) {
  const src = legendUrl(entry, fontColor)
  const [trackedSrc, setTrackedSrc] = useState(src)
  const [imageFailed, setImageFailed] = useState(false)
  if (trackedSrc !== src) {
    setTrackedSrc(src)
    setImageFailed(false)
  }
  return (
    <Paper py="xs" px="sm">
      <Stack gap={4} w={168}>
        <Text size="xs" fw={600}>
          {entry.label}
        </Text>
        {!imageFailed && (
          <ScrollArea.Autosize mah={LEGEND_MAX_HEIGHT} type="auto">
            <Image
              src={src}
              alt={`${entry.label} legend`}
              fit="contain"
              w="auto"
              onError={() => setImageFailed(true)}
            />
          </ScrollArea.Autosize>
        )}
        <Text size="xs" c="dimmed">
          {entry.emptyMeans}
        </Text>
      </Stack>
    </Paper>
  )
}
