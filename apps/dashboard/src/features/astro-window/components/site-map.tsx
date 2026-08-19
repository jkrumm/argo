import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Box,
  Card,
  Flex,
  Group,
  Image,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  useComputedColorScheme,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconAdjustments, IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
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
import { createPersistedState } from 'basalt-ui/state'
import { alpha, VX } from 'basalt-ui/tokens'
import { astroQueries } from '../../../lib/queries/astro'
import { rainviewerQueries } from '../../../lib/queries/rainviewer'
import { apiBase } from '../../../lib/api-base'
import { getToken } from '../../../lib/auth'
import { MAP_MIN_HEIGHT } from '../constants'
import { ChartEmpty } from '../charts/empty'
import {
  baseLayer,
  CONTOUR_GLYPHS_URL,
  gibsTime,
  legendUrl,
  LP_RAMP,
  LP_SITE_BAND,
  RADAR_FRAME_MS,
  RADAR_REFRESH_MS,
  remapLpRampStops,
  SCHEME_STYLE_URL,
  weatherLayer,
  type MapLayerState,
  type WeatherSelection,
  type WmsWeatherLayer,
} from '../map-layers'
import {
  detachTerrainIfUnwanted,
  installOverlays,
  paintOverlayState,
  paintRadarFrame,
  refreshCloudRamp,
  refreshContours,
  refreshHillshade,
  refreshLpRamp,
  resolveLegendFontColor,
  syncTerrain,
  type OverlayState,
} from './map-overlays'
import { MapSettingsPanel } from './map-settings-panel'
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

/**
 * Whether the settings panel is open — a VIEWING preference (see the call site's own comment),
 * not part of a shareable map configuration, so it lives outside the URL. `createPersistedState`
 * (`basalt-ui/state`) replaces the earlier `@mantine/hooks` `useLocalStorage`: it is the
 * framework's own versioned/namespaced primitive, the same one `lib/gym-profile.ts`'s
 * `useGymMirror` and `strength-tracker/components/weight-popover.tsx`'s `useWeightView` already
 * use — called once here at module scope, per that shared convention, not inside the component.
 * The key is un-namespaced on purpose (`createPersistedState` prefixes it to
 * `basalt:astro-map:settings-open` itself); a hand-rolled `argo:` prefix would just double up.
 */
const usePanelOpen = createPersistedState({
  key: 'astro-map:settings-open',
  version: 1,
  initial: false,
})

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

  const radarActive = layers.weather.some(
    (selection) => weatherLayer(selection.id)?.source === 'rainviewer',
  )
  const staticTimeActive = layers.weather.some(
    (selection) => weatherLayer(selection.id)?.source === 'wms',
  )
  const gibsActive = layers.weather.some(
    (selection) => weatherLayer(selection.id)?.source === 'gibs-ir',
  )

  /**
   * The global radar's own frames. RainViewer publishes a new mosaic every 5 minutes and this
   * query refetches on that same cadence (`rainviewerQueries.radar()`'s own `refetchInterval`), so
   * the DWD-grid epoch clock below no longer has to drive it — the animated layer refreshes off
   * the query, not off this component's own interval. `enabled: radarActive` keeps this
   * third-party request off the wire entirely while the layer is off, matching the settings
   * panel's own "leave on only what you are reading" copy. A loading or failed query resolves to
   * `[]` (never `undefined`), so `desiredStack` (`map-overlays.ts`) renders that as "no frames"
   * and `frameCount > 0` below already keeps the clock/play-pause UI from mounting on an empty
   * set — a dead third-party feed must not break the map.
   */
  const { data: rainviewerFrames } = useQuery({
    ...rainviewerQueries.radar(),
    enabled: radarActive,
  })
  const radarFrames = useMemo(
    () => (radarActive ? (rainviewerFrames ?? []) : []),
    [radarActive, rainviewerFrames],
  )

  /**
   * The shared refresh clock for `nowMs` and `gibsTimeValue` below — bumped every
   * `RADAR_REFRESH_MS` while any `'wms'` weather layer (`radar-de`/`lightning`/`cells`/
   * `cloud-top`, each carrying its own `timeGrid`) OR the GIBS infrared layer is on, paused while
   * the tab is backgrounded (the same `visibilitychange` discipline the radar playback loop below
   * already uses). One clock drives every grid — DWD's and EUMETSAT's PT5M/PT15M `timeGrid`s
   * (`weatherLayerTime`, `map-layers.ts`) and GIBS' PT10M — so there is never a second interval to
   * keep in sync — the animated global radar needs no clock here at all anymore, see `radarFrames`
   * above.
   *
   * Restoring visibility also bumps `epoch` immediately, not just restarts the interval: a tab
   * hidden for longer than `RADAR_REFRESH_MS` would otherwise keep painting the timestamps it was
   * last mounted with for up to another interval on return — which is exactly the
   * `ServiceExceptionReport`/stale-GIBS-slot failure mode this clock exists to prevent. A
   * redundant bump on first activation is harmless: the recomputed timestamps are identical, so
   * `installOverlays` finds every source id already in `wanted` and does nothing.
   */
  const timeSensitiveActive = staticTimeActive || gibsActive
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
   * The wall clock every `'wms'` row's baked `time` is computed against — each row floors this
   * against its OWN `timeGrid` via `weatherLayerTime` (`map-layers.ts`) rather than reading a
   * precomputed grid slot off this component, so a new WMS row needs no new field here. Refreshed
   * on the `epoch` clock above, for the same reason it always was: none of the four `'wms'` rows
   * carries a nowcast of its own, so an unrefreshed anchor eventually points at a slot the host
   * has stopped publishing.
   */
  const nowMs = useMemo(
    () => Date.now(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epoch],
  )

  /** The single GIBS grid slot `cloud-ir` bakes into its request — see `gibsTime` in
   * `map-layers.ts`. Refreshed on the same `epoch` clock as `nowMs`, for the same reason: GIBS'
   * PT10M grid moves on regardless of whether anything here has re-rendered. */
  const gibsTimeValue = useMemo(
    () => gibsTime(new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epoch],
  )

  const overlayState = useMemo<OverlayState>(
    () => ({
      ...layers,
      radarFrames,
      nowMs,
      gibsTime: gibsTimeValue,
    }),
    [layers, radarFrames, nowMs, gibsTimeValue],
  )

  /** ISO timestamps for `RadarClock`/`frameCount` below — a thin projection of `radarFrames`, not
   * itself carried in `OverlayState` (which needs each frame's tile URL too, not just its time). */
  const radarTimes = useMemo(
    () => radarFrames.map((frame) => frame.time.toISOString()),
    [radarFrames],
  )

  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(true)
  // Persisted, not URL state — this is a VIEWING preference (is the panel visible), not part of
  // a shareable map configuration; every control the panel itself renders IS in the URL (see
  // `MapLayerSections`'s own footnote), which is exactly why this one deliberately isn't. See
  // `usePanelOpen`'s own doc for why this rides `createPersistedState` rather than
  // `@mantine/hooks`' `useLocalStorage`.
  const [panelOpen, setPanelOpen] = usePanelOpen()
  // Below this breakpoint there is no room to dock a 320px column next to a still-usable map —
  // `MapSettingsPanel` falls back to the overlay `Drawer` it used to always be. Computed here
  // (not inside that component) because the resize effect below needs it too, and because a
  // docked→overlay switch changes THIS container's width exactly like an open/close does.
  // `getInitialValueInEffect: false` reads `window.matchMedia` synchronously on the initial
  // render instead of defaulting to `false` and flipping after mount — safe here because this
  // whole component is CSR-only (lazy-loaded, Suspense-gated), so there is no SSR-hydration
  // mismatch to protect against, and without it a phone renders the docked column for one frame
  // before swapping to the `Drawer`.
  const isNarrow = useMediaQuery('(max-width: 48em)', undefined, { getInitialValueInEffect: false })
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
   *    a base was picked in the panel. This effect calls `setStyle` with the new one — a URL for
   *    a `style`/scheme-default `imagery` base, an inline object for a `raster-style` base.
   * 2. `diff: false` is LOAD-BEARING. MapLibre's default (`diff: true`) fetches the new style
   *    and reconciles it against the current one with `Style.setState` — and because our own
   *    sources and layers exist only in the current style, the diff's verdict is "remove them".
   *    No new Style object is constructed, so `style.load` never fires and nothing re-adds them:
   *    the overlays would vanish on the first toggle and never come back. `diff: false` forces a
   *    full rebuild, which is exactly what fires `style.load`.
   * 3. `style.load` (subscribed once, in the create effect) runs `installOverlays` against the
   *    CURRENT state ref, so exactly the layers the panel says are on come back — not a
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
   * new style, so nothing fires `style.load` and the ramp — the cloud mask's ramp, the hillshade
   * relief, and the contour line/label colours, the same palette-derived-paint problem in four
   * places now — would keep painting the other scheme's shades. Re-resolving each paint expression
   * is cheap and touches no source.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasStyleLoadedRef.current) return
    refreshLpRamp(map, overlayStateRef.current)
    refreshCloudRamp(map, overlayStateRef.current)
    refreshHillshade(map, overlayStateRef.current)
    refreshContours(map, overlayStateRef.current)
  }, [resolvedScheme])

  // Panel changes: add/remove sources and layers, then paint. Guarded on the style being up —
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
  // `paintRadarFrame` — never the panel-state paint work (`paintOverlayState`), and never a
  // re-add or re-request. The frames are already sources, and MapLibre's default paint transition
  // turns the step into a crossfade.
  //
  // `overlayState` deliberately stays OUT of the dep array and is read off the ref instead: the
  // effect above already re-paints every panel-state value on every real `overlayState` change
  // (right after `installOverlays` syncs the sources/layers it may have just added, including the
  // current radar frame — see `paintOverlayState`'s docblock), so keeping it here too would run a
  // second, redundant paint pass on every panel toggle or opacity commit.
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
  /**
   * `radarFrames` (and so `frameCount`) can SHRINK between refetches — RainViewer republishes a
   * new catalogue with fewer past frames on its own 5-minute cadence. Left unclamped, `frame`
   * could keep pointing past the new end for up to one refresh tick: `paintRadarFrame`
   * (`map-overlays.ts`) matches `index === radarFrame` against the frame count it actually has,
   * so an out-of-range `frame` matches nothing and every radar layer flashes to zero opacity — a
   * visible blank that only self-corrects on the NEXT tick's modulo wrap. Derived during render,
   * the same pattern this file already uses (`OpacitySlider`'s committed/draft pair,
   * `WeatherLegendCard`'s `trackedSrc`), rather than a reset `useEffect`.
   */
  const [trackedFrameCount, setTrackedFrameCount] = useState(frameCount)
  if (trackedFrameCount !== frameCount) {
    setTrackedFrameCount(frameCount)
    if (frameCount > 0 && frame > frameCount - 1) setFrame(Math.min(frame, frameCount - 1))
  }
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

  // The settings panel opening/closing (or switching between the docked column and the narrow
  // overlay) changes THIS container's own width, and MapLibre has no internal resize observer of
  // its own — the same fact the ResizeObserver in the create effect above exists to work around.
  // That observer, watching this same container, likely already catches this exact transition on
  // its own; this effect calls `resize()` again anyway, deliberately and cheaply redundant, so the
  // fix is tied explicitly to the state transition rather than resting entirely on the observer's
  // independent notification path. A bare call (no `requestAnimationFrame`) is enough: `useEffect`s
  // run after the browser has already painted, and a browser cannot paint before it has finished
  // layout, so the container has already settled into its new width by the time this runs — a call
  // here can only ever be redundant with the observer, never premature. (Reasoned from React's
  // effect-timing contract; not watched live in devtools, since this task runs with no dev server.)
  useEffect(() => {
    mapRef.current?.resize()
  }, [panelOpen, isNarrow])

  const closePanel = useCallback(() => setPanelOpen(false), [setPanelOpen])
  const closeScoutPanel = useCallback(() => setScoutOpen(false), [])
  const compareSite = data.data.find((site) => site.id === siteId)

  return (
    <Card py={0} px={0} h={height} mih={MAP_MIN_HEIGHT} style={{ overflow: 'hidden' }}>
      <Flex h="100%" wrap="nowrap">
        {/* The map's own column — `pos="relative"` moved here (off the outer `Card`) so every
            absolutely-positioned overlay cluster below anchors to the MAP, not to the settings
            panel sitting beside it. `minWidth: 0` is what lets a flex child actually shrink below
            its content size when the panel column claims 320px. */}
        <Box pos="relative" style={{ flex: 1, minWidth: 0 }}>
          <Box ref={containerRef} h="100%" style={{ visibility: failed ? 'hidden' : 'visible' }} />
          {failed ? (
            <Box pos="absolute" inset={0}>
              <ChartEmpty
                height="100%"
                message="Map unavailable — could not reach the tile server."
              />
            </Box>
          ) : (
            <>
              {/* One cluster, laid out by a Group — the radar clock appears beside the settings
                  trigger rather than at a second hand-guessed offset. */}
              <Box pos="absolute" top={8} left={8}>
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <Tooltip label={panelOpen ? 'Hide map layers' : 'Show map layers'}>
                    <ActionIcon
                      variant="default"
                      aria-label={panelOpen ? 'Hide map layers' : 'Show map layers'}
                      aria-expanded={panelOpen}
                      onClick={() => setPanelOpen(!panelOpen)}
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
              {layers.lpYear !== null && <LpLegend year={layers.lpYear} range={layers.lpRange} />}
              <WeatherLegends weather={layers.weather} fontColor={legendFontColor} />
            </>
          )}
        </Box>
        <MapSettingsPanel
          opened={panelOpen}
          onClose={closePanel}
          narrow={isNarrow}
          state={layers}
          onChange={onLayersChange}
        />
      </Flex>
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

/** Where a remapped stop sits along the gradient, as a percentage of the WINDOW's own span —
 * not the canonical ramp's, so the gradient always fills edge-to-edge regardless of how narrow
 * the panel's sensitivity window is. */
const stopOffset = (stop: number, [min, max]: readonly [number, number]) =>
  Math.round(((stop - min) / (max - min)) * 100)

/**
 * The same stops the paint expression uses (`remapLpRampStops`, `map-layers.ts`), rebuilt as a CSS
 * gradient over the CURRENT sensitivity window — narrowing the range in the panel spends the
 * legend's own gradient on that window too, the same way the map's paint does. `LP_RAMP.length` of
 * them, read off the table rather than restated as a literal here. Tokens stay tokens and the
 * alpha goes through `alpha()` (a `color-mix`), because a browser understands both — no runtime
 * resolution needed, and it follows the scheme for free.
 */
function legendGradient(range: readonly [number, number]): string {
  const remapped = remapLpRampStops(range)
  const stops = LP_RAMP.map(({ token, alpha: opacity }, index) => {
    const stop = remapped[index] ?? 0
    return `${alpha(token, opacity)} ${stopOffset(stop, range)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

const fmtMag = (stop: number) => (stop / 100).toFixed(1)

/** Index of `lpDark`'s first stop within `LP_RAMP` — read once at module scope by matching on the
 * already-exported `LP_SITE_BAND` value, rather than re-importing the `LP` token map here just to
 * repeat `map-layers.ts`'s own `.find`. `LpLegend` reads the REMAPPED value at this same index, so
 * the "blue from" reading moves with the window the same way the two end labels do. */
const LP_SITE_BAND_INDEX = LP_RAMP.findIndex((row) => row.stop === LP_SITE_BAND)

/**
 * Seven stops are too many to label one by one, so the legend names only the three readings that
 * decide anything: the two ends, and the value the site markers have to clear — all three now
 * read off the panel's own sensitivity window (`range`) rather than the ramp's fixed canonical
 * domain, so the legend never disagrees with what the ramp is actually painting. The atlas vintage
 * rides along because the panel can now change it — a legend that did not say which year it was
 * describing would be the wrong kind of quiet. Numerals in JetBrains Mono per DESIGN.md.
 */
function LpLegend({ year, range }: { year: number; range: readonly [number, number] }) {
  const remappedSiteBand = remapLpRampStops(range)[LP_SITE_BAND_INDEX] ?? LP_SITE_BAND
  return (
    <Box pos="absolute" bottom={8} left={8}>
      <Paper py="xs" px="sm">
        <Stack gap={4} w={148}>
          <Box
            h={6}
            style={{ backgroundImage: legendGradient(range), borderRadius: VX.radiusCard }}
          />
          <Group justify="space-between" gap={4}>
            <Text ff="monospace" size="xs" c="dimmed">
              {fmtMag(range[0])}
            </Text>
            <Text ff="monospace" size="xs" c="dimmed">
              {fmtMag(range[1])}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            mag/arcsec² — blue from{' '}
            <Text span ff="monospace" size="xs" c="dimmed">
              {fmtMag(remappedSiteBand)}
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
 * The active weather layers' own WMS legends — DWD's and, since `cloud-top`/`lightning`, EUMETSAT's
 * too (`legendUrl`'s `GetLegendGraphic` builder is generic GeoServer, not host-specific) — a
 * separate, bottom-RIGHT cluster so it never collides with `LpLegend` at bottom-left. Answers the
 * two halves of "toggle it on, nothing appears, is this broken": what colour means what (the
 * legend image), and what an empty render means (`entry.emptyMeans`, right under it — a quiet
 * night is data, not a failure).
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
    .filter((entry): entry is WmsWeatherLayer => entry?.legend === true && entry.source === 'wms')
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

/** The legend's max box height — a scroll region past this rather than a squash. DWD Blitzdichte's
 * legend (formerly `lightning`'s own, before it moved to EUMETSAT's MTG-I imager) measured 344 px
 * tall; `mah={60}` (the old value) rendered it unreadably compressed. */
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
 * `map-settings-panel.tsx` for its `committed`/`draft` pair, preferred over a `useEffect`.
 */
function WeatherLegendCard({ entry, fontColor }: { entry: WmsWeatherLayer; fontColor: string }) {
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
