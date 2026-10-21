import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Divider,
  Flex,
  Group,
  Image,
  Skeleton,
  Slider,
  Stack,
  Text,
  VisuallyHidden,
  useComputedColorScheme,
} from '@mantine/core'
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react'
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
import { PageAside, StatusDot } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import { astroQueries } from '../../../lib/queries/astro'
import { rainviewerQueries } from '../../../lib/queries/rainviewer'
import { openMeteoMapsQueries } from '../../../lib/queries/open-meteo-maps'
import { apiBase } from '../../../lib/api-base'
import { getToken } from '../../../lib/auth'
import { mapShotState } from '../../../lib/shot-state'
import { useNow } from '../../../lib/use-now'
import { MAP_MIN_HEIGHT } from '../constants'
import {
  baseLayer,
  buildTimeTicks,
  CONTOUR_GLYPHS_URL,
  FALLBACK_DOT_IMAGE_ID,
  fallbackDotImage,
  gibsTime,
  legendSource,
  LEGEND_IMAGE_CROP,
  legendUrl,
  LP_RAMP,
  LP_SITE_BAND,
  MODEL_FRAME_MS,
  nearestTimeIndex,
  nextTickMs,
  paintedAtlasYear,
  RADAR_FRAME_MS,
  RADAR_REFRESH_MS,
  remapLpRampStops,
  SCHEME_STYLE_URL,
  weatherLayer,
  weatherLayerInlineName,
  weatherLayerTime,
  type LegendableWeatherLayer,
  type WeatherLayer,
  type MapLayerState,
  type WeatherSelection,
} from '../map-layers'
import {
  detachTerrainIfUnwanted,
  installOverlays,
  paintOverlayState,
  paintRadarFrame,
  rasterStyleLayerId,
  refreshCloudRamp,
  refreshContours,
  refreshHillshade,
  refreshLpRamp,
  syncTerrain,
  type OverlayState,
} from './map-overlays'
import { MapLayerSections } from './map-settings-panel'
import { ScoutPanel } from './scout-panel'
import classes from './site-map.module.css'

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
 * spacing token can express it. basalt-ui 1.21.0 stopped reading a unitless number
 * in a plain options bag as CSS, so the waiver this used to carry is gone.
 */
const FIT_BOUNDS_OPTIONS = { padding: 48, duration: 0 } as const

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
        // `rasterStyleLayerId`, not an inline template — `syncBaseWash` (`map-overlays.ts`) needs
        // the exact same id string to wash this layer when the pollution ramp is on, and a second
        // hand-written copy of the template is how those two would drift apart silently.
        layers: [{ id: rasterStyleLayerId(base.id), type: 'raster', source: sourceId }],
      }
    }
    return SCHEME_STYLE_URL[resolvedScheme]
  }, [base, resolvedScheme])

  const radarActive = layers.weather.some(
    (selection) => weatherLayer(selection.id)?.source === 'rainviewer',
  )
  const staticTimeActive = layers.weather.some((selection) => {
    const source = weatherLayer(selection.id)?.source
    return source === 'wms' || source === 'wms-multi'
  })
  // `'cloud-ir'` (`source: 'gibs-ir'`) is the only consumer of `gibsTime` — its three GIBS
  // satellites, plain undecoded rasters with no `timeGrid` of their own.
  const gibsActive = layers.weather.some(
    (selection) => weatherLayer(selection.id)?.source === 'gibs-ir',
  )
  // Whether any `'om-model'` row (`model-cloud`/`model-cloud-low`/`model-precip`) is on — gates
  // the domain-metadata fetch below the same "leave on only what you are reading" way
  // `radarActive` gates RainViewer's own query.
  const omModelActive = layers.weather.some(
    (selection) => weatherLayer(selection.id)?.source === 'om-model',
  )

  /**
   * The global radar's own frames. RainViewer publishes a new mosaic every 5 minutes and this
   * query refetches on that same cadence (`rainviewerQueries.radar()`'s own `refetchInterval`), so
   * the EUMETSAT-grid epoch clock below no longer has to drive it — the animated layer refreshes
   * off the query, not off this component's own interval. `enabled: radarActive` keeps this
   * third-party request off the wire entirely while the layer is off, matching the settings
   * panel's own "leave on only what you are reading" copy. A loading or failed query resolves to
   * `[]` (never `undefined`), so `desiredStack` (`map-overlays.ts`) renders that as "no frames"
   * and `tickCount > 0` below already keeps the scrubber UI from mounting on an empty set — a
   * dead third-party feed must not break the map.
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
   * The selected forecast domain's own metadata — `reference_time`/`valid_times[]`, the timeline
   * the three `'om-model'` rows step through. `enabled: omModelActive` keeps this third-party
   * request off the wire while none of the three is on, same discipline as `radarActive` above. A
   * loading/failed query resolves `omValidTimes` to `[]`, which `desiredStack` (`map-overlays.ts`)
   * already reads as "mount nothing" via `omTimeStep === null` — a dead upstream must not break
   * the map, same contract `radarFrames` already keeps.
   */
  const { data: omMeta, isError: omMetaFailed } = useQuery({
    ...openMeteoMapsQueries.meta(layers.omDomain),
    enabled: omModelActive,
  })
  // No usable forecast hours: the metadata fetch failed and nothing cached survives it.
  const forecastUnavailable = omModelActive && omMetaFailed && omMeta === undefined
  const omValidTimes = useMemo(
    () => (omModelActive ? (omMeta?.validTimes ?? []) : []),
    [omModelActive, omMeta],
  )

  /**
   * The shared refresh clock for `nowMs` and `gibsTimeValue` below — bumped every
   * `RADAR_REFRESH_MS` while any `'wms'`/`'wms-multi'` weather layer (`lightning`/`cloud-top`,
   * each carrying its own `timeGrid`) OR the GIBS infrared layer (`cloud-ir`) is on, paused while
   * the tab is backgrounded (the same `visibilitychange` discipline the radar playback loop below
   * already uses). One clock drives every grid — EUMETSAT's PT5M/PT15M `timeGrid`s
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
   * The wall clock every `'wms'`/`'wms-multi'` row's baked `time` is computed against — each row
   * floors this against its OWN `timeGrid` via `weatherLayerTime` (`map-layers.ts`) rather than
   * reading a precomputed grid slot off this component, so a new row needs no new field here.
   * Refreshed on the `epoch` clock above, for the same reason it always was: none of these rows
   * carries a nowcast of its own, so an unrefreshed anchor eventually points at a slot the host has
   * stopped publishing.
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

  /**
   * The time scrubber's own tick list — the UNION of RainViewer's past frames and the selected
   * domain's hourly forecast steps (`buildTimeTicks`, `map-layers.ts`), sorted and de-duplicated.
   *
   * The EUMETSAT/GIBS observation rows (`lightning`/`cloud`/`cloud-ir`/`cloud-top`) contribute
   * NOTHING here and do NOT follow this scrubber at all — that is deliberate, not a bug: none of
   * the four carries a forecast or a history worth scrubbing through, so they keep asking for
   * "latest published" off their own independent clocks (`weatherLayerTime`'s `timeGrid`s,
   * `gibsTimeValue` above) regardless of where the scrubber sits. See `TimeScrubber`'s own doc
   * below for the same point made from the render side.
   */
  const ticks = useMemo(
    () =>
      buildTimeTicks(
        radarFrames.map((f) => f.time),
        omValidTimes,
      ),
    [radarFrames, omValidTimes],
  )
  const tickCount = ticks.length

  /** Radar's own newest frame — `TimeScrubber` reads this to say plainly that radar has stalled at
   * its latest reading once the scrubber moves past it, rather than silently implying radar has a
   * forecast of its own. `null` while radar is off or has no frames yet. */
  const radarNewestTime = useMemo(
    () =>
      radarFrames.reduce<Date | null>(
        (latest, f) => (latest === null || f.time > latest ? f.time : latest),
        null,
      ),
    [radarFrames],
  )

  /**
   * The scrubber's position is held as a TIME, never as an index into `ticks`, and the index is
   * DERIVED from it every render. That inverts the obvious arrangement for a reason: the tick list
   * changes shape constantly — RainViewer republishes a smaller past-frame set on its own 5-minute
   * cadence, toggling a `'om-model'` row adds 49 hourly steps in one go, switching domain replaces
   * them with a different count — and index 7 of the old list is a different moment in the new one.
   * Holding the time keeps the scrubber pointing at the same moment across every one of those, and
   * it makes an out-of-range index structurally impossible rather than something a clamp has to
   * catch after the fact (which is what the `trackedFrameCount` guard here used to do, for the
   * radar-only list this replaced).
   *
   * Seeded to mount time, so the map OPENS on now rather than on the oldest tick it happens to
   * have — with a forecast domain on, tick 0 is that model run's reference time, which can be
   * several hours stale.
   */
  const [targetMs, setTargetMs] = useState(() => Date.now())
  // Opened with a forecast layer already on, the map starts paused too: the switch-on reset below
  // only fires on a change, and a URL that arrives with `wx=model-*` never changes.
  const [playing, setPlaying] = useState(() => !omModelActive)

  const tickIndex = useMemo(
    () => (tickCount === 0 ? 0 : (nearestTimeIndex(ticks, new Date(targetMs)) ?? 0)),
    [ticks, tickCount, targetMs],
  )
  const scrubToTick = useCallback(
    (index: number) => {
      const tick = ticks[index]
      if (tick !== undefined) setTargetMs(tick.getTime())
    },
    [ticks],
  )

  /**
   * Turning a forecast row on STOPS the loop. A radar-only list is 13 five-minute frames covering
   * the last hour — looping it by default is the whole point of that layer. A list with a model in
   * it is up to 49 hourly steps, each of which is a different `time_step` baked into the source id
   * (`omLayerId`, `map-overlays.ts`) and therefore a fresh fetch, so autoplay there would mean an
   * endless request cycle over a third-party endpoint nobody asked to animate. Play stays
   * available — watching 48 h of cloud move is genuinely useful — it just has to be asked for.
   * Derived during render, the pattern this file already uses rather than a reset `useEffect`.
   */
  const [trackedOmActive, setTrackedOmActive] = useState(omModelActive)
  if (trackedOmActive !== omModelActive) {
    setTrackedOmActive(omModelActive)
    if (omModelActive) setPlaying(false)
  }

  const currentTick = ticks[tickIndex] ?? null

  /**
   * Read by the playback loop below instead of `ticks` itself, for the same reason
   * `overlayStateRef` exists: the loop must not be torn down and rebuilt every time RainViewer
   * republishes its catalogue (every 5 minutes) or the forecast metadata refetches, which is what
   * putting `ticks` in that effect's dep array would do — the interval would reset mid-cycle and
   * the animation would stutter on a schedule the user never asked about.
   */
  const ticksRef = useRef(ticks)
  ticksRef.current = ticks

  /**
   * Each time-following layer snaps to its OWN nearest addressable time off the shared
   * `currentTick` (`nearestTimeIndex`, `map-layers.ts`) — `null` while the layer is inactive or
   * its own times have not loaded yet, so `overlayState` mounts nothing for it rather than a
   * source pointed at a bogus index. Radar needs no special case for "the scrubber moved past
   * now": RainViewer's own times never extend past "now" (its nowcast was discontinued
   * 2026-01-01), so once every candidate is behind the target the NEWEST one is already nearest —
   * see `nearestTimeIndex`'s own doc.
   */
  const nearestRadarFrame = useMemo(
    () =>
      radarActive && currentTick !== null
        ? nearestTimeIndex(
            radarFrames.map((f) => f.time),
            currentTick,
          )
        : null,
    [radarActive, radarFrames, currentTick],
  )
  const omTimeStep = useMemo(
    () =>
      omModelActive && currentTick !== null ? nearestTimeIndex(omValidTimes, currentTick) : null,
    [omModelActive, omValidTimes, currentTick],
  )

  // The one place the answer-field rule meets the map: while a weather layer is on the atlas is
  // not painted (`paintedAtlasYear`), so `map-overlays.ts` never sees a year to mount. The URL
  // state (`layers`) keeps the atlas settings, so leaving weather restores them.
  const overlayState = useMemo<OverlayState>(
    () => ({
      ...layers,
      lpYear: paintedAtlasYear(layers),
      radarFrames,
      nowMs,
      gibsTime: gibsTimeValue,
      omTimeStep,
    }),
    [layers, radarFrames, nowMs, gibsTimeValue, omTimeStep],
  )
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
  // The radar frame the CURRENT tick resolves to — `0` until the first tick has resolved anything,
  // the same "safe until real data lands" role `frameRef` used to play before radar's own frame
  // index became a DERIVED value (`nearestRadarFrame`) rather than independently-cycled state.
  const radarFrameRef = useRef(nearestRadarFrame ?? 0)
  radarFrameRef.current = nearestRadarFrame ?? 0
  // `shot-map=error` starts failed and never creates the map; `shot-map=loading` never creates it
  // either, so `styleLoaded` stays false and the pending note stays up.
  const forcedState = mapShotState()
  const [failed, setFailed] = useState(forcedState === 'error')
  // Whether the first style has loaded: until then the canvas shows a pending note and the rail
  // keys nothing (there is no canvas for a key to explain).
  const [styleLoaded, setStyleLoaded] = useState(false)
  // Bumped by the failed state's Retry: the create effect below re-runs and builds a fresh map.
  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    // A forced `shot-map=error` builds no map, so its Retry leaves the failed state standing.
    if (forcedState !== null) return
    setFailed(false)
    setAttempt((current) => current + 1)
  }

  // Create/destroy exactly once. React 19 StrictMode double-invokes effects, so the create and
  // the teardown must live in the SAME effect with an empty dep array — never split across two.
  useEffect(() => {
    if (!containerRef.current || forcedState !== null) return
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

    // OpenFreeMap's sprite lacks `circle-11`, which its town/city layers use (see map-layers.ts).
    map.on('styleimagemissing', ({ id }) => {
      if (id === FALLBACK_DOT_IMAGE_ID && !map.hasImage(id)) map.addImage(id, fallbackDotImage())
    })

    // `style.load` fires once for the initial style AND again for every style the map loads
    // afterwards, which is what makes the overlays survive a theme toggle — see the setStyle
    // effect below for why that event is guaranteed to fire on a swap.
    map.on('style.load', () => {
      hasStyleLoadedRef.current = true
      setStyleLoaded(true)
      installOverlays(map, overlayStateRef.current)
      paintOverlayState(map, overlayStateRef.current, radarFrameRef.current)
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
    // documented fix, and it also covers the sidebar collapsing and the key rail appearing or
    // wrapping.
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
      setStyleLoaded(false)
      hasFitRef.current = false
      isFirstStyleRef.current = true
    }
  }, [forcedState, attempt])

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
   * is cheap and touches no source. `cloud-ir` needs no entry here: it paints GIBS' own raw tiles
   * (plain RGBA raster, no decode), so it has no palette-derived paint to re-resolve.
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
    paintOverlayState(map, overlayState, radarFrameRef.current)
    syncTerrain(map, overlayState)
  }, [overlayState])

  // The scrubber's only per-tick work for radar: one `setPaintProperty` per frame layer, via
  // `paintRadarFrame` — never the panel-state paint work (`paintOverlayState`), and never a
  // re-add or re-request. The frames are already sources, and MapLibre's default paint transition
  // turns the step into a crossfade. `'om-model'` has no equivalent per-tick paint: a step change
  // there means a different `time_step` baked into the SOURCE id (`omLayerId`, `map-overlays.ts`),
  // so it rides the `[overlayState]` effect above (which already includes `omTimeStep`) rather
  // than a cheap paint-only path — there is no pre-mounted-at-zero-opacity frame to reveal.
  //
  // `overlayState` deliberately stays OUT of the dep array and is read off the ref instead: the
  // effect above already re-paints every panel-state value on every real `overlayState` change
  // (right after `installOverlays` syncs the sources/layers it may have just added, including the
  // current radar frame — see `paintOverlayState`'s docblock), so keeping it here too would run a
  // second, redundant paint pass on every panel toggle or opacity commit.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasStyleLoadedRef.current || nearestRadarFrame === null) return
    paintRadarFrame(map, overlayStateRef.current, nearestRadarFrame)
  }, [nearestRadarFrame])

  /*
   * The playback loop itself — steps `tickIndex` forward through the combined tick list, not
   * simulated wall-clock time (a mix of 5-minutely and hourly ticks has no single "real time"
   * speed that would make both feel right). Two shutdown paths, both required:
   *
   * - Leaving the Map tab unmounts this component (the route renders it conditionally), so the
   *   cleanup below is what stops it.
   * - Backgrounding the browser tab does NOT unmount, so `visibilitychange` pauses the interval
   *   instead. The frames are already downloaded, so a hidden loop costs no requests — but it
   *   does cost a GPU repaint every 500 ms for a canvas nobody is looking at.
   */
  useEffect(() => {
    if (!playing || tickCount === 0) return
    let timer: number | undefined
    const start = () => {
      timer ??= window.setInterval(
        () => setTargetMs((current) => nextTickMs(ticksRef.current, current)),
        omModelActive ? MODEL_FRAME_MS : RADAR_FRAME_MS,
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
  }, [playing, tickCount, omModelActive])

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
        const selected = site.id === siteId
        // The selected site is larger as well as accent-filled, and named on the canvas below: fill
        // alone disappears into a blue overlay (radar, the atlas's dark end).
        const size = selected ? '16px' : '12px'
        el.style.width = size
        el.style.height = size
        el.style.borderRadius = '50%'
        el.style.cursor = 'pointer'
        el.style.padding = '0'
        // Token REFERENCES, not resolved values: a marker lives outside React and outside
        // Mantine, but it is still in the document, so the browser re-resolves these on a
        // scheme flip by itself. Resolving them here (as the ramp has to, because MapLibre's
        // colour parser cannot) would freeze the markers in whichever scheme was current.
        el.style.border = `2px solid ${VX.surface.panel}`
        el.style.background = selected ? VX.accentFill : VX.muted
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
      const selectedSite = data.data.find((site) => site.id === siteId)
      if (selectedSite !== undefined) {
        const label = document.createElement('span')
        label.className = classes.siteLabel
        label.textContent = selectedSite.name
        markersRef.current.push(
          new Marker({ element: label, anchor: 'left', offset: [12, 0] })
            .setLngLat([selectedSite.lon, selectedSite.lat])
            .addTo(map),
        )
      }
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
    // `attempt`: a Retry built a new map, whose markers this effect has to add again.
  }, [data, siteId, attempt])

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
    // `attempt`: a Retry built a new map, which has to be fitted again.
  }, [data, attempt])

  const closeScoutPanel = useCallback(() => setScoutOpen(false), [])
  const compareSite = data.data.find((site) => site.id === siteId)
  const weatherLegends = legendableWeatherLayers(layers.weather)
  const textKeys = textKeyedWeatherLayers(layers.weather)
  const paintedYear = paintedAtlasYear(layers)
  // The weather layer that is hiding a chosen atlas, if any — the rail says so in words.
  const activeWeather =
    layers.weather[0] === undefined ? undefined : weatherLayer(layers.weather[0].id)
  const hiddenAtlasBy = layers.lpYear !== null ? activeWeather : undefined
  // A map whose style has not loaded, or has failed, shows no keys: there is no canvas for them
  // to explain.
  const showRail =
    styleLoaded &&
    !failed &&
    (tickCount > 0 ||
      paintedYear !== null ||
      weatherLegends.length > 0 ||
      textKeys.length > 0 ||
      hiddenAtlasBy !== undefined)

  return (
    <Card variant="flush" h={height} mih={MAP_MIN_HEIGHT} style={{ overflow: 'hidden' }}>
      <Flex h="100%" wrap="nowrap">
        {/* The map's own column: the key rail, a divider, then the canvas. Nothing argo draws floats
            over the canvas — every key sits in the rail, plain layout rather than a surface, so no
            surface nests inside the card. The canvas wrapper is `pos="relative"` so the failed-tiles
            message anchors to the MAP; the settings panel portals into the shell's aside region via
            `PageAside` below, so this column is the only flex child. */}
        <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
          {showRail && (
            <>
              {/* Unbounded: every key stays fully visible at rest, at 390 too. The canvas below
                  keeps a floor (`mih`) instead, and the card's own `mih` gives it room to grow. */}
              <Box px="sm" py="xs">
                <Group gap="md" wrap="wrap" align="flex-start">
                  {tickCount > 0 && (
                    <TimeScrubber
                      ticks={ticks}
                      tickIndex={tickIndex}
                      playing={playing}
                      onToggle={() => setPlaying((current) => !current)}
                      onScrub={scrubToTick}
                      radarActive={radarActive}
                      radarNewestTime={radarNewestTime}
                    />
                  )}
                  {paintedYear !== null && <LpLegend year={paintedYear} range={layers.lpRange} />}
                  {weatherLegends.map((entry) => (
                    <WeatherLegendCard key={entry.id} entry={entry} nowMs={nowMs} />
                  ))}
                  {textKeys.map(({ id, textKey, emptyMeans }) => (
                    <WeatherTextKey
                      key={id}
                      textKey={textKey}
                      // A dead forecast upstream paints nothing and has no hours to scrub: say so
                      // instead of the key's "blank means" line, which would read as clear sky.
                      emptyMeans={
                        forecastUnavailable && weatherLayer(id)?.source === 'om-model'
                          ? FORECAST_UNAVAILABLE
                          : emptyMeans
                      }
                    />
                  ))}
                  {hiddenAtlasBy !== undefined && (
                    <HiddenAtlasNote
                      layerName={weatherLayerInlineName(hiddenAtlasBy)}
                      onShow={() => onLayersChange({ ...layers, weather: [] })}
                    />
                  )}
                </Group>
              </Box>
              <Divider />
            </>
          )}
          <Box pos="relative" mih={CANVAS_MIN_HEIGHT} style={{ flex: 1 }}>
            <Box
              ref={containerRef}
              h="100%"
              style={{ visibility: failed ? 'hidden' : 'visible' }}
            />
            {(failed || !styleLoaded) && <MapPendingOrFailed failed={failed} onRetry={retry} />}
          </Box>
        </Flex>
      </Flex>
      <PageAside title="Map layers" persistKey="astro-map-layers">
        <MapLayerSections state={layers} onChange={onLayersChange} />
      </PageAside>
      <ScoutPanel
        opened={scoutOpen}
        onClose={closeScoutPanel}
        point={scoutPoint}
        compareSite={compareSite}
      />
    </Card>
  )
}

// ── Time scrubber ──────────────────────────────────────────────────────────

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const DAY_CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** The clock's zone name (`CEST`) — the scrubber's times are the viewer's local time, and the
 * clock says so. */
const ZONE_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' })
const zoneName = (at: Date) =>
  ZONE_FORMAT.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? ''

/** The `Slider`'s own fixed width — wide enough to read the two ends of a mixed 5-minutely/hourly
 * tick list without wrapping, narrow enough to sit comfortably in the key rail. */
const SCRUBBER_WIDTH = 220

/** The map canvas's floor under an unbounded key rail: below this the map stops being usable. */
const CANVAS_MIN_HEIGHT = 240

/**
 * Replaces the old `RadarClock`. Where that component only ever read `radar`'s own frames, this
 * one drives EVERY time-following layer off one shared position: `ticks` is the UNION of
 * RainViewer's 5-minutely past frames and the selected Open-Meteo domain's hourly `valid_times`
 * (`buildTimeTicks`, `map-layers.ts`), and each layer independently snaps to whichever of its OWN
 * times sits nearest that position (`nearestTimeIndex`, computed in `site-map.tsx` and threaded
 * into `OverlayState` as `nearestRadarFrame`/`omTimeStep`) — this component only renders the
 * shared position, it does not know which layers are actually listening to it.
 *
 * The EUMETSAT/GIBS observation rows (`lightning`/`cloud`/`cloud-ir`/`cloud-top`) do NOT follow
 * this scrubber at all and contribute no ticks to `ticks` — they keep asking for "latest
 * published" off their own independent clocks. That is deliberate: none of the four carries a
 * forecast or a history worth scrubbing through, so wiring them in would only let the scrubber
 * imply a forecast/history that does not exist. See `ticks`'s own doc in `site-map.tsx` for the
 * same point from the data side.
 *
 * Numerals in JetBrains Mono per DESIGN.md.
 */
function TimeScrubber({
  ticks,
  tickIndex,
  playing,
  onToggle,
  onScrub,
  radarActive,
  radarNewestTime,
}: {
  ticks: readonly Date[]
  tickIndex: number
  playing: boolean
  onToggle: () => void
  onScrub: (index: number) => void
  /** Whether `radar` is one of the layers this position is currently driving — gates the "radar
   * holds at latest" caption below, which would otherwise be a non-sequitur while radar is off. */
  radarActive: boolean
  /** Radar's own newest addressable frame, or `null` while radar has none — see `radarActive`. */
  radarNewestTime: Date | null
}) {
  const now = useNow()
  const at = ticks[Math.min(tickIndex, ticks.length - 1)] ?? null
  const first = ticks[0]
  const last = ticks[ticks.length - 1]
  if (at === null || first === undefined || last === undefined) return null
  // A span that crosses midnight (a 48 h forecast) names the weekday on every time, or its two
  // ends read as the same `20:00`.
  const clock = first.toDateString() === last.toDateString() ? CLOCK_FORMAT : DAY_CLOCK_FORMAT
  // Without radar every tick is a model hour: a forecast even at or before now, never "observed".
  const forecast = !radarActive || at.getTime() > now
  // Radar has no forecast of its own (RainViewer discontinued its nowcast 2026-01-01) — once the
  // scrubber moves past radar's own newest frame, `nearestTimeIndex` (map-layers.ts) already
  // clamps radar's paint to that frame with no special case; this caption is the one place that
  // has to SAY so, or a scrubbed-forward radar layer would silently look like a working forecast.
  const radarHoldsAtLatest =
    radarActive && radarNewestTime !== null && at.getTime() > radarNewestTime.getTime()

  return (
    <Stack gap={4} w={SCRUBBER_WIDTH}>
      <Group gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={playing ? 'Pause timeline' : 'Play timeline'}
          onClick={onToggle}
        >
          {playing ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
        </ActionIcon>
        <Text ff="monospace" size="xs">
          {clock.format(at)} {zoneName(at)}
        </Text>
        <Text size="xs" c="dimmed">
          {forecast ? 'forecast' : 'observed'}
        </Text>
      </Group>
      <Slider
        value={tickIndex}
        onChange={onScrub}
        min={0}
        max={Math.max(ticks.length - 1, 0)}
        step={1}
        label={(index) => {
          const tick = ticks[index]
          return tick === undefined ? '' : clock.format(tick)
        }}
        aria-label="Timeline position"
      />
      <Text ff="monospace" size="xs" c="dimmed">
        {clock.format(first)}–{clock.format(last)}
      </Text>
      {radarHoldsAtLatest && (
        <Text size="xs" c="dimmed">
          Radar holds at its latest frame past now — it has no forecast of its own.
        </Text>
      )}
    </Stack>
  )
}

/**
 * The canvas while the style has not loaded, or after it failed: the loaded shape (a rail band over
 * a canvas), never a spinner in an empty card. Pending is a skeleton rail over an empty
 * graticule; failed states the cause in the rail band with a Retry, over the same graticule.
 */
function MapPendingOrFailed({
  failed,
  onRetry,
}: {
  failed: boolean
  onRetry: (() => void) | null
}) {
  return (
    <Flex pos="absolute" inset={0} direction="column">
      <Box px="sm" py="xs">
        {failed ? (
          <Stack gap={4} align="flex-start" role="alert">
            <Group gap="xs">
              <StatusDot color={VX.badSolid} />
              <Text size="sm" fw={600}>
                Could not load map
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              The base map&apos;s tile server did not answer.
            </Text>
            {onRetry !== null && (
              <Button variant="light" onClick={onRetry}>
                Retry
              </Button>
            )}
          </Stack>
        ) : (
          <Stack gap="xs" role="status" aria-busy="true">
            <VisuallyHidden>Loading map</VisuallyHidden>
            <Skeleton h={12} w={180} radius="xl" />
            <Skeleton h={12} w={260} radius="xl" />
          </Stack>
        )}
      </Box>
      <Divider />
      <MapGraticule />
    </Flex>
  )
}

/** Graticule spacing, px: a map's empty frame, drawn while there is no map to show. */
const GRATICULE_STEP = 48

/** The canvas placeholder: grid lines in the chart-grid ink, so the card keeps a map's shape. */
function MapGraticule() {
  // SVG ids are document-global; `useId`'s colons are not valid in a `url(#…)` reference.
  const patternId = `graticule-${useId().replaceAll(':', '')}`
  return (
    <Box style={{ flex: 1 }}>
      <svg width="100%" height="100%" aria-hidden="true">
        <defs>
          <pattern
            id={patternId}
            width={GRATICULE_STEP}
            height={GRATICULE_STEP}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${GRATICULE_STEP} 0 L 0 0 0 ${GRATICULE_STEP}`}
              fill="none"
              stroke={VX.grid}
              strokeWidth={1}
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </Box>
  )
}

const FORECAST_UNAVAILABLE =
  'Forecast unavailable: Open-Meteo did not answer, so nothing is painted.'

/** The rail's one line about what is hidden: the atlas stays in the URL while a weather layer is on,
 * and this is the way back to it without opening the drawer. */
function HiddenAtlasNote({ layerName, onShow }: { layerName: string; onShow: () => void }) {
  return (
    <Stack gap="xs" w={LEGEND_WIDTH} maw="100%" align="flex-start">
      <Text size="xs" c="dimmed">
        Light pollution hidden while {layerName} is on
      </Text>
      <Button variant="light" onClick={onShow}>
        Show light pollution
      </Button>
    </Stack>
  )
}

// ── Legend ─────────────────────────────────────────────────────────────────

/** One key's fixed width in the rail; the rail's `Group` wraps keys onto their own rows when the card
 * is narrower than the keys side by side. */
const LEGEND_WIDTH = 220

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
    <Stack gap={4} w={LEGEND_WIDTH}>
      <Text size="xs" fw={600}>
        Light pollution
      </Text>
      <Box h={6} style={{ backgroundImage: legendGradient(range), borderRadius: VX.radiusCtrl }} />
      <Group justify="space-between" gap={4}>
        <Text ff="monospace" size="xs" c="dimmed">
          {fmtMag(range[0])}
        </Text>
        <Text ff="monospace" size="xs" c="dimmed">
          {fmtMag(range[1])}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        mag/arcsec² · blue from{' '}
        <Text span ff="monospace" size="xs" c="dimmed">
          {fmtMag(remappedSiteBand)}
        </Text>
        , where the sites sit ·{' '}
        <Text span ff="monospace" size="xs" c="dimmed">
          {year}
        </Text>{' '}
        atlas
      </Text>
    </Stack>
  )
}

// ── Weather legends ────────────────────────────────────────────────────────

/**
 * The active weather layers that carry a legend — EUMETSAT's, both the single-disc (`lightning`) and
 * two-disc (`cloud-top`) shapes (`legendUrl`'s `GetLegendGraphic` builder is generic GeoServer, not
 * host- or disc-specific — `legendSource` resolves either shape to the one `{host, wmsLayer}` pair
 * it needs). Each becomes one `WeatherLegendCard` in the key rail, which answers the two halves of
 * "toggle it on, nothing appears, is this broken": what colour means what (the legend image), and
 * what an empty render means (`entry.emptyMeans`, right under it — a quiet night is data, not a
 * failure).
 */
function legendableWeatherLayers(weather: readonly WeatherSelection[]): LegendableWeatherLayer[] {
  return weather
    .map((selection) => weatherLayer(selection.id))
    .filter(
      (entry): entry is LegendableWeatherLayer =>
        entry?.legend === true && (entry.source === 'wms' || entry.source === 'wms-multi'),
    )
}

/**
 * The active weather layers that carry a plain text key instead of a legend image (`textKey`,
 * `map-layers.ts` — radar). Narrowed to a non-optional `textKey` so the caller needs no re-check.
 */
function textKeyedWeatherLayers(weather: readonly WeatherSelection[]): {
  id: WeatherSelection['id']
  textKey: NonNullable<WeatherLayer['textKey']>
  emptyMeans: string
}[] {
  return weather.flatMap((selection) => {
    const entry = weatherLayer(selection.id)
    if (entry?.textKey === undefined) return []
    return [{ id: selection.id, textKey: entry.textKey, emptyMeans: entry.emptyMeans }]
  })
}

/** A text-only key: the same anatomy as the image keys (bold title, then dimmed lines). */
function WeatherTextKey({
  textKey,
  emptyMeans,
}: {
  textKey: NonNullable<WeatherLayer['textKey']>
  /** What an empty render means, the same line a legend card ends on. */
  emptyMeans: string
}) {
  return (
    <Stack gap={4} w={LEGEND_WIDTH} maw="100%">
      <Text size="xs" fw={600}>
        {textKey.title}
      </Text>
      {textKey.lines.map((line) => (
        <Text key={line} size="xs" c="dimmed">
          {line}
        </Text>
      ))}
      <Text size="xs" c="dimmed">
        {emptyMeans}
      </Text>
    </Stack>
  )
}

/** The plate behind a third-party legend raster: white in both schemes, the one literal colour in
 * this file, because the raster's black text cannot be recoloured (DESIGN.md, App deviations). */
const LEGEND_PLATE = 'white'

/**
 * One legend card. The image is a third-party PNG on a host we don't control — `onError` hides it
 * quietly rather than letting a broken-image glyph sit on the map; the label and `emptyMeans` line
 * still render either way, so the card degrades to text instead of vanishing.
 *
 * The raster is black text on a transparent background in BOTH schemes: the server ignores
 * `fontColor`, `bgColor` and `transparent=false`, so the white plate behind it is ours (a `Box`
 * with `bg="white"`, no radius, shadow or border — a key, not a surface; DESIGN.md, App
 * deviations).
 */
function WeatherLegendCard({ entry, nowMs }: { entry: LegendableWeatherLayer; nowMs: number }) {
  const [imageFailed, setImageFailed] = useState(false)
  const frameAt = new Date(weatherLayerTime(entry, new Date(nowMs)))
  return (
    <Stack gap={4} w={LEGEND_IMAGE_CROP.width} maw="100%">
      <Text size="xs" fw={600}>
        {entry.label}
      </Text>
      {/* These layers do not follow the scrubber: they show the provider's latest published frame,
          so the key names its time, from the same `nowMs` the tile request is built from. */}
      <Text ff="monospace" size="xs" c="dimmed">
        frame {CLOCK_FORMAT.format(frameAt)} {zoneName(frameAt)}
      </Text>
      {!imageFailed && (
        <Box bg={LEGEND_PLATE} w={LEGEND_IMAGE_CROP.width} maw="100%">
          <Image
            src={legendUrl(legendSource(entry))}
            alt={`${entry.label} legend`}
            w={LEGEND_IMAGE_CROP.width}
            maw="100%"
            h={LEGEND_IMAGE_CROP.height}
            fit="cover"
            style={{ objectPosition: 'left top' }}
            onError={() => setImageFailed(true)}
          />
        </Box>
      )}
      <Text size="xs" c="dimmed">
        {entry.emptyMeans}
      </Text>
    </Stack>
  )
}
