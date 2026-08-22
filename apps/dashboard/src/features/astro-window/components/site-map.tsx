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
  Slider,
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
import { openMeteoMapsQueries } from '../../../lib/queries/open-meteo-maps'
import { apiBase } from '../../../lib/api-base'
import { getToken } from '../../../lib/auth'
import { MAP_MIN_HEIGHT } from '../constants'
import { ChartEmpty } from '../charts/empty'
import {
  baseLayer,
  buildTimeTicks,
  CONTOUR_GLYPHS_URL,
  gibsTime,
  legendSource,
  legendUrl,
  LP_RAMP,
  LP_SITE_BAND,
  MODEL_FRAME_MS,
  nearestTimeIndex,
  nextTickMs,
  RADAR_FRAME_MS,
  RADAR_REFRESH_MS,
  remapLpRampStops,
  SCHEME_STYLE_URL,
  weatherLayer,
  type LegendableWeatherLayer,
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
   * The EUMETSAT legend's `LEGEND_OPTIONS` `fontColor`, re-resolved from the live palette whenever
   * the scheme flips. Producing a NEW string on the dependency change is what makes the legend
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
  const { data: omMeta } = useQuery({
    ...openMeteoMapsQueries.meta(layers.omDomain),
    enabled: omModelActive,
  })
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
  const [playing, setPlaying] = useState(true)

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

  const overlayState = useMemo<OverlayState>(
    () => ({
      ...layers,
      radarFrames,
      nowMs,
      gibsTime: gibsTimeValue,
      omTimeStep,
    }),
    [layers, radarFrames, nowMs, gibsTimeValue, omTimeStep],
  )
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
  // The radar frame the CURRENT tick resolves to — `0` until the first tick has resolved anything,
  // the same "safe until real data lands" role `frameRef` used to play before radar's own frame
  // index became a DERIVED value (`nearestRadarFrame`) rather than independently-cycled state.
  const radarFrameRef = useRef(nearestRadarFrame ?? 0)
  radarFrameRef.current = nearestRadarFrame ?? 0
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
              {/* One cluster, laid out by a Group — the time scrubber appears beside the settings
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

// ── Time scrubber ──────────────────────────────────────────────────────────

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** The `Slider`'s own fixed width — wide enough to read the two ends of a mixed 5-minutely/hourly
 * tick list without wrapping, narrow enough to sit comfortably beside the settings trigger. */
const SCRUBBER_WIDTH = 220

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
  const at = ticks[Math.min(tickIndex, ticks.length - 1)] ?? null
  if (at === null) return null
  const forecast = at.getTime() > Date.now()
  // Radar has no forecast of its own (RainViewer discontinued its nowcast 2026-01-01) — once the
  // scrubber moves past radar's own newest frame, `nearestTimeIndex` (map-layers.ts) already
  // clamps radar's paint to that frame with no special case; this caption is the one place that
  // has to SAY so, or a scrubbed-forward radar layer would silently look like a working forecast.
  const radarHoldsAtLatest =
    radarActive && radarNewestTime !== null && at.getTime() > radarNewestTime.getTime()

  return (
    <Paper py="xs" px="sm">
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
            {CLOCK_FORMAT.format(at)}
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
            return tick === undefined ? '' : CLOCK_FORMAT.format(tick)
          }}
          aria-label="Timeline position"
        />
        {radarHoldsAtLatest && (
          <Text size="xs" c="dimmed">
            Radar holds at its latest frame past now — it has no forecast of its own.
          </Text>
        )}
      </Stack>
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
 * The active weather layers' own WMS legends — EUMETSAT's, both the single-disc (`lightning`) and
 * two-disc (`cloud-top`) shapes (`legendUrl`'s `GetLegendGraphic` builder is generic GeoServer, not
 * host- or disc-specific — `legendSource` resolves either shape to the one `{host, wmsLayer}` pair
 * it needs) — a separate, bottom-RIGHT cluster so it never collides with `LpLegend` at bottom-left.
 * Answers the two halves of "toggle it on, nothing appears, is this broken": what colour means what
 * (the legend image), and what an empty render means (`entry.emptyMeans`, right under it — a quiet
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
    .filter(
      (entry): entry is LegendableWeatherLayer =>
        entry?.legend === true && (entry.source === 'wms' || entry.source === 'wms-multi'),
    )
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
 * session after one transient failure against EUMETSAT, even once a scheme flip produces a URL
 * that would load fine. Same derive-during-render reset `OpacitySlider` uses in
 * `map-settings-panel.tsx` for its `committed`/`draft` pair, preferred over a `useEffect`.
 */
function WeatherLegendCard({
  entry,
  fontColor,
}: {
  entry: LegendableWeatherLayer
  fontColor: string
}) {
  const src = legendUrl(legendSource(entry), fontColor)
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
