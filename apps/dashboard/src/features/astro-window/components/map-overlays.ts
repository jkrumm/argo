import { addProtocol, type AddLayerObject, type Map as MapLibreMap } from 'maplibre-gl'
import mlcontour from 'maplibre-contour'
import type { RainViewerFrame } from '../../../lib/queries/rainviewer'
import {
  BASE_STACK_INDEX,
  baseLayer,
  CLOUD_RAMP,
  CONTOUR_ELEVATION_KEY,
  CONTOUR_LABEL_FONT,
  CONTOUR_LAYER_NAME,
  CONTOUR_LEVEL_KEY,
  CONTOUR_STACK_INDEX,
  CONTOUR_THRESHOLDS,
  gibsTileUrl,
  GIBS_MAXZOOM,
  lpAttribution,
  LP_RAMP,
  LP_RANGE_FULL,
  LP_STACK_INDEX,
  lpTileUrl,
  remapLpRampStops,
  TERRAIN_3D_EXAGGERATION,
  TERRAIN_ATTRIBUTION,
  TERRAIN_DEM_URL,
  TERRAIN_STACK_INDEX,
  TRAILS_ATTRIBUTION,
  TRAILS_STACK_INDEX,
  TRAILS_TILES,
  wmsTileUrl,
  weatherLayer,
  weatherLayerTime,
  type HillshadeMethod,
  type MapLayerState,
  type WeatherLayerId,
} from '../map-layers'

/**
 * Everything MapLibre-shaped that Argo's own layers need: turning the catalogue in
 * `map-layers.ts` into sources, layers and paint, and keeping the map in step with the drawer.
 *
 * `site-map.tsx` keeps the lifecycle (create/destroy, the worker URL, the ResizeObserver, the
 * `{ diff: false }` style swap and the `style.load` gating); this module keeps the content. The
 * split is what stops the component from growing a layer registry inside a `useEffect`.
 */

/**
 * `SourceSpecification` is not re-exported by `maplibre-gl` — it lives in
 * `@maplibre/maplibre-gl-style-spec`, which is a TRANSITIVE dependency here. Reading the type off
 * the method that consumes it keeps the import list to packages this app actually declares.
 */
type SourceSpec = Parameters<MapLibreMap['addSource']>[1]

/**
 * Every source and layer this app owns is prefixed, so a resync can enumerate its own additions
 * off the live style instead of keeping a parallel registry that can drift out of date. Nothing
 * in an OpenFreeMap / VersaTiles style uses this prefix.
 */
const OWN_PREFIX = 'argo-'

const lpLayerId = (year: number) => `${OWN_PREFIX}lp-${year}`
const weatherLayerId = (id: WeatherLayerId) => `${OWN_PREFIX}wx-${id}`
const TRAILS_LAYER_ID = `${OWN_PREFIX}trails`

/**
 * ONE `raster-dem` source doubles as both the hillshade layer's input AND the `setTerrain`
 * source — the brief is explicit that a second copy of the same DEM is not the answer. The
 * hillshade LAYER only renders when `state.terrain.hillshade` is on, but the source is mounted
 * whenever hillshade OR 3D terrain is wanted, because `setTerrain` needs a source that already
 * exists in the style.
 */
const TERRAIN_SOURCE_ID = `${OWN_PREFIX}terrain-dem`

const CONTOUR_SOURCE_ID = `${OWN_PREFIX}contours`
const CONTOUR_LINE_LAYER_ID = `${OWN_PREFIX}contours-line`
const CONTOUR_LABEL_LAYER_ID = `${OWN_PREFIX}contours-label`

/** Same DEM ceiling as `TERRAIN_SOURCE_ID`'s `raster-dem` source — the terrarium bucket has
 * nothing past z15, so both sources declare it and let MapLibre overzoom beyond it. */
const DEM_MAXZOOM = 15

/**
 * ONE `DemSource` for the whole module, constructed at MODULE SCOPE rather than inside a
 * component or effect. A module is evaluated exactly once by the ESM loader no matter how many
 * times a consuming effect re-runs — unlike a `useEffect`, which React 19 StrictMode
 * double-invokes — so registering the protocol here needs no extra double-registration guard,
 * the way `demSource.setupMaplibre` would need one if called from inside `site-map.tsx`'s effects.
 *
 * `worker: false` is a deliberate override, not the package default (which is `true`). The
 * package's worker is NOT a plain file `new Worker(new URL(...))` — Vite's `?worker&url` pipeline
 * (the fix `site-map.tsx`'s own long import comment documents for maplibre-gl's worker) has
 * nothing to intercept, because `maplibre-contour`'s `dist/index.mjs` builds the worker at
 * RUNTIME by string-concatenating its own UMD-wrapped chunks into a `Blob` and handing MapLibre
 * `URL.createObjectURL(...)` of that string — there is no separate worker entry file to route
 * through the optimizer at all. Rather than gamble on Vite surviving a pattern it was never built
 * to recognise, DEM decoding and isoline generation run on the main thread here. This is a real
 * perf tradeoff (contour tiles compute synchronously instead of off-thread), acceptable for a
 * personal dashboard; `worker: true` is the thing to revisit if contour toggling ever visibly
 * jank. `bun run --cwd apps/dashboard build` is what actually proves this choice survives Vite —
 * a passing typecheck never touches the runtime Blob-URL path either way.
 */
const demSource = new mlcontour.DemSource({
  url: TERRAIN_DEM_URL,
  encoding: 'terrarium',
  maxzoom: DEM_MAXZOOM,
  worker: false,
})
demSource.setupMaplibre({ addProtocol })

const CONTOUR_TILE_OPTIONS = {
  thresholds: CONTOUR_THRESHOLDS,
  contourLayer: CONTOUR_LAYER_NAME,
  elevationKey: CONTOUR_ELEVATION_KEY,
  levelKey: CONTOUR_LEVEL_KEY,
}

/**
 * The frame's own timestamp is baked into the id, not just the index. `installOverlays` decides
 * what to add/keep by comparing ids against its `wanted` set — if RainViewer's `refetchInterval`
 * publishing a fresh `radarFrames` array kept the same index-only ids, the OLD sources would look
 * "already wanted" and never get swept, so the map would keep rendering frames whose tile URL
 * (baked to a specific RainViewer mosaic hash) disagrees with whatever a clock label next to it
 * now shows. Folding the timestamp into the id makes that mismatch structurally impossible: a new
 * batch of frames is a new set of ids, so the stale ones fall out of `wanted` and get removed like
 * any other overlay change.
 */
const radarFrameLayerId = (index: number, time: string) =>
  `${OWN_PREFIX}wx-radar-${index}-${time.replace(/[:.]/g, '-')}`

/**
 * The same id-changing discipline as `radarFrameLayerId` above, for every `'wms'` row
 * (`radar-de`/`lightning`/`cells`/`cloud-top`): each carries a baked `time`, floored onto its own
 * `timeGrid` by `weatherLayerTime` (`map-layers.ts`), and if its id did not move when that time
 * refreshes, `installOverlays` would see the stale source as still "wanted" and never sweep it —
 * the map would keep painting a slot that has aged out of its own grid's extent.
 */
const staticTimedLayerId = (id: WeatherLayerId, time: string) =>
  `${OWN_PREFIX}wx-${id}-${time.replace(/[:.]/g, '-')}`

/**
 * `cloud`'s two EUMETSAT discs (`msg_fes:clm`, `msg_iodc:clm`) share one catalogue row but mount
 * as two independent `raster-dem` + `color-relief` sources — this is the per-disc id. No `time`
 * baked in: `cloud` keeps asking for the latest slot with no `time` param at all, same as the
 * opaque wash it replaced.
 */
const cloudLayerId = (index: number) => `${weatherLayerId('cloud')}-${index}`

/**
 * `cloud-ir`'s three GIBS satellites share one catalogue row but mount as three independent
 * raster sources, each carrying the same id-changing discipline as `staticTimedLayerId` — GIBS'
 * own `TIME` dimension refreshes on `OverlayState.gibsTime`, a different grid on a different
 * clock from the DWD one `staticTimedLayerId` serves.
 */
const gibsLayerId = (index: number, time: string) =>
  `${OWN_PREFIX}wx-cloud-ir-${index}-${time.replace(/[:.]/g, '-')}`

// ── The light-pollution ramp ───────────────────────────────────────────────

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
 * Reads the live palette and returns the paint expression. Called on every `style.load`, on a
 * bare scheme flip, AND on a sensitivity-range commit, so the ramp is always built from the
 * shades actually mounted and the domain the drawer's `RangeSlider` currently asks for — not from
 * whichever scheme or range happened to be current when the layer was added.
 *
 * `range` defaults to `LP_RANGE_FULL` (the ramp's own un-windowed domain) so every existing call
 * site that has not been taught about sensitivity yet keeps painting the same stops as before.
 * The actual remap is `remapLpRampStops` (`map-layers.ts`) — pure and DOM-free, so its own
 * correctness is unit-tested directly; this function's job is only to pair each remapped stop
 * back up with its row's resolved colour. The cast is unavoidable: spreading a variable-length
 * stop list widens the tuple that `ExpressionSpecification` is, and the shape is validated by the
 * style spec at runtime anyway.
 */
export function buildLpRamp(range: readonly [number, number] = LP_RANGE_FULL): LpRampExpression {
  const cs = getComputedStyle(document.documentElement)
  const remappedStops = remapLpRampStops(range)
  const stops = LP_RAMP.flatMap(({ token, alpha: opacity }, index) => [
    remappedStops[index]!,
    resolveStopColor(cs, token, opacity),
  ])
  return ['interpolate', ['linear'], ['elevation'], ...stops] as LpRampExpression
}

// ── The cloud mask ramp ──────────────────────────────────────────────────────

/**
 * `cloud`'s decode ramp — `CLOUD_RAMP`'s stops are already the raw 0–255 domain the `raster-dem`
 * `encoding: 'custom'` source decodes the EUMETSAT red channel into (see that constant's own
 * doc), so unlike `buildLpRamp` there is no remap step: every stop is used verbatim. Read fresh on
 * every `style.load` and scheme flip, same as `buildLpRamp`, since `cloudHigh` resolves to a
 * different hex per scheme.
 */
export function buildCloudRamp(): LpRampExpression {
  const cs = getComputedStyle(document.documentElement)
  const stops = CLOUD_RAMP.flatMap(({ stop, token, alpha: opacity }) => [
    stop,
    resolveStopColor(cs, token, opacity),
  ])
  return ['interpolate', ['linear'], ['elevation'], ...stops] as LpRampExpression
}

// ── The hillshade relief ────────────────────────────────────────────────────

type HillshadeLayer = Extract<AddLayerObject, { type: 'hillshade' }>
type HillshadePaint = NonNullable<HillshadeLayer['paint']>

/**
 * Achromatic, not palette tokens — deliberately NOT `--vx-surface-*`. An earlier version pointed
 * shadow/highlight at `--vx-surface-bg`/`--vx-surface-elevated`, two adjacent steps of the SAME
 * zinc surface ladder: their luminance differs by only a few percent, so the relief rendered as
 * two near-identical greys and read as no relief at all. Hillshading is a physical LIGHT model
 * (which slope faces the sun, which faces away), not palette ink, and MapLibre's own spec
 * defaults are `#000000`/`#FFFFFF` for exactly this reason — the widest luminance span available.
 * `series.ts`'s `ARGO_DERIVED` is the guard-exempt file such achromatic values legitimately live
 * in; see `--vx-hillshadeShadow`/`--vx-hillshadeHighlight`/`--vx-hillshadeAccent` there.
 * `hillshade-accent-color` shares the shadow's own black rather than minting a third tone —
 * MapLibre's own default does the same (`accent` only diverges from `shadow` on a style that
 * wants a tinted ridge outline, which this calm-neutral relief deliberately does not).
 */
const HILLSHADE_SHADOW_VAR = '--vx-hillshadeShadow'
const HILLSHADE_HIGHLIGHT_VAR = '--vx-hillshadeHighlight'
const HILLSHADE_ACCENT_VAR = '--vx-hillshadeAccent'

/** MapLibre's own single-light defaults (`hillshade-illumination-direction`/`-altitude`), reused
 * verbatim for `standard` and `igor` — a single-light method has nothing to distribute across
 * multiple directions, so a 4-element array here would be silently ignored by the renderer. */
const HILLSHADE_SINGLE_DIRECTION = 335
const HILLSHADE_SINGLE_ALTITUDE = 45

/**
 * Swiss-style multidirectional relief's own light rig — MapLibre's official multidirectional
 * example (Austria/Switzerland-centred). That example's rainbow `hillshade-shadow-color`/
 * `-highlight-color` arrays exist only to demonstrate the ARRAY FORM `ColorArraySpecification`
 * (`string | string[]`) allows for a per-direction colour — cartography, not colour choice, so
 * they are not reused here. A single resolved string per colour applies uniformly to all four
 * lights instead, which is what "calm neutral zinc shading, not tinted colour" (the brief this
 * shipped against) asks for. Only `multidirectional` reads a 4-element direction/altitude array;
 * `standard`/`igor` read the scalar MapLibre defaults above.
 */
const HILLSHADE_MULTI_DIRECTIONS = [270, 315, 0, 45]
const HILLSHADE_MULTI_ALTITUDES = [30, 30, 30, 30]

/** The illumination direction/altitude pair for a given light model — shared by
 * `buildHillshadePaint` and every `setPaintProperty` call site that pushes a method change
 * without a full re-add (`paintOverlayState`, `refreshHillshade`), so the two never drift. */
function hillshadeIllumination(method: HillshadeMethod): {
  direction: number | number[]
  altitude: number | number[]
} {
  return method === 'multidirectional'
    ? { direction: HILLSHADE_MULTI_DIRECTIONS, altitude: HILLSHADE_MULTI_ALTITUDES }
    : { direction: HILLSHADE_SINGLE_DIRECTION, altitude: HILLSHADE_SINGLE_ALTITUDE }
}

/**
 * Called on every `style.load` AND on a bare scheme flip (`refreshHillshade`, mirroring
 * `buildLpRamp`/`refreshLpRamp`), so the relief always paints the shades actually mounted.
 */
export function buildHillshadePaint({
  exaggeration,
  method,
}: {
  exaggeration: number
  method: HillshadeMethod
}): HillshadePaint {
  const cs = getComputedStyle(document.documentElement)
  const { direction, altitude } = hillshadeIllumination(method)
  return {
    'hillshade-method': method,
    'hillshade-illumination-direction': direction,
    'hillshade-illumination-altitude': altitude,
    'hillshade-exaggeration': exaggeration,
    'hillshade-shadow-color': resolveStopColor(cs, HILLSHADE_SHADOW_VAR, 1),
    'hillshade-highlight-color': resolveStopColor(cs, HILLSHADE_HIGHLIGHT_VAR, 1),
    'hillshade-accent-color': resolveStopColor(cs, HILLSHADE_ACCENT_VAR, 1),
  }
}

// ── Contour lines ────────────────────────────────────────────────────────────

/** `--vx-muted` — readable but subordinate, the same secondary-ink role the legend caption below
 * uses; the line and its label share one colour. `--vx-surface-bg` behind the label text is this
 * app's own page tone rather than a scheme-blind literal, so the halo still reads against
 * whichever basemap is mounted. */
const CONTOUR_LINE_VAR = '--vx-muted'
const CONTOUR_HALO_VAR = '--vx-surface-bg'

/** Minor lines thinner and fainter than major ones — the visual half of "context, not answer". */
const CONTOUR_MINOR_WIDTH = 0.5
const CONTOUR_MAJOR_WIDTH = 1.1
const CONTOUR_MINOR_OPACITY = 0.35
const CONTOUR_MAJOR_OPACITY = 0.65

/** Resolved once per stack build, same `getComputedStyle` trick as `buildHillshadePaint`. */
function buildContourColors(): { line: string; halo: string } {
  const cs = getComputedStyle(document.documentElement)
  return {
    line: resolveStopColor(cs, CONTOUR_LINE_VAR, 1),
    halo: resolveStopColor(cs, CONTOUR_HALO_VAR, 1),
  }
}

/** `--vx-muted` — the same opaque secondary-ink token DESIGN.md documents using in place of
 * `--vx-tooltipMuted` for bespoke labels, which this WMS legend caption is. */
const LEGEND_FONT_VAR = '--vx-muted'

/** Neutral zinc-400 — never actually reached (`--vx-muted` always resolves to a 6-digit hex in
 * both schemes), but a `0x`-prefixed literal keeps the return type honest if a future palette
 * swap ever hands back something `SIX_DIGIT_HEX` cannot parse. */
const LEGEND_FONT_FALLBACK = '0xa1a1aa'

/**
 * The DWD `LEGEND_OPTIONS` `fontColor`, resolved from the live palette rather than hardcoded — the
 * one probed 2026-08-19 (`0xd4d4d8`) was the DARK scheme's `--vx-muted` value, not a constant, and
 * hardcoding it would leave the legend's own caption unreadable the moment the page is in light
 * mode. Same `getComputedStyle(document.documentElement)` read `resolveStopColor` already uses,
 * converting the palette's `#rrggbb` to the `0xrrggbb` GeoServer's `LEGEND_OPTIONS` expects.
 */
export function resolveLegendFontColor(): string {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(LEGEND_FONT_VAR).trim()
  return SIX_DIGIT_HEX.test(hex) ? `0x${hex.slice(1)}` : LEGEND_FONT_FALLBACK
}

// ── The desired stack ──────────────────────────────────────────────────────

/**
 * One entry of the stack. `id` is the source id; `layers` is everything mounted off that ONE
 * source — one item for every raster/DEM entry, two for contours (a `line` and a `symbol` layer
 * sharing the same vector source, since a line and its label cannot be one MapLibre layer).
 *
 * `stackIndex` is the catalogue's single ordering scale (`BASE_STACK_INDEX` / `LP_STACK_INDEX` /
 * `WeatherLayer.stackIndex`), carried here so the whole stack is sorted ONCE at the end rather
 * than assembled in whatever order the branches happen to run.
 */
type StackEntry = {
  id: string
  stackIndex: number
  source: SourceSpec
  layers: readonly AddLayerObject[]
}

/** The layer state plus the derived, periodically-refreshed weather timestamps. */
export type OverlayState = MapLayerState & {
  /** Empty unless the RainViewer global radar is on. Sourced from `rainviewerQueries.radar()` in
   * `site-map.tsx`, not computed here — a dead/loading third-party feed resolves to `[]`, which
   * `desiredStack` below already renders as "no frames" rather than a broken layer. */
  radarFrames: readonly RainViewerFrame[]
  /** The wall clock every `'wms'` row's baked `time` is computed against — each row floors this
   * against its OWN `timeGrid` via `weatherLayerTime` (`map-layers.ts`), so one `nowMs` now
   * anchors every grid (DWD's PT5M, EUMETSAT's PT5M and PT15M) instead of one field per grid.
   * Refreshed on `site-map.tsx`'s shared `epoch` clock, not read live off `Date.now()` here, so a
   * re-render between ticks reuses the exact instant every other derived value in this state was
   * computed from. Always populated (cheap to compute) even when no `'wms'` row is on. */
  nowMs: number
  /** The one GIBS grid slot `cloud-ir` bakes into its id — see `gibsTime` in `map-layers.ts`.
   * Always populated for the same reason `nowMs` is. */
  gibsTime: string
}

function rasterEntry({
  id,
  stackIndex,
  tiles,
  attribution,
  opacity,
  maxzoom,
}: {
  id: string
  stackIndex: number
  tiles: readonly string[]
  attribution: string
  opacity: number
  maxzoom?: number
}): StackEntry {
  return {
    id,
    stackIndex,
    source: {
      type: 'raster',
      tiles: [...tiles],
      tileSize: 256,
      attribution,
      ...(maxzoom !== undefined && { maxzoom }),
    },
    layers: [{ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } }],
  }
}

/**
 * The stack the current state asks for, ordered BOTTOM first.
 *
 * Order is the whole contract here, and it is decided by ONE number per entry — the catalogue's
 * shared stack scale — not by the order these branches run in. See `map-layers.ts`'s "Stack
 * order" section for the current derivation: the cloud layer decodes to real transparency now
 * (`CLOUD_RAMP`), so it no longer needs to sit UNDER the pollution ramp the way the old opaque
 * EUMETSAT wash did — it sits just above it instead, grouped with its infrared complement, with
 * radar/storm cells/lightning stacked above both as the more urgent, sparser annotations.
 *
 * The sort is stable (ES2019+), so a multi-frame source's frames (radar's RainViewer-sized set,
 * cloud's two EUMETSAT discs, cloud-ir's three GIBS satellites) keep the order they were pushed
 * in.
 */
function desiredStack(state: OverlayState): StackEntry[] {
  const stack: StackEntry[] = []

  const base = baseLayer(state.base)
  if (base.kind === 'imagery') {
    stack.push(
      rasterEntry({
        id: `${OWN_PREFIX}base-${base.id}`,
        stackIndex: BASE_STACK_INDEX,
        tiles: base.tiles,
        attribution: base.attribution ?? '',
        opacity: base.defaultOpacity,
        maxzoom: base.maxzoom,
      }),
    )
  }

  if (state.terrain.hillshade || state.terrain.extruded) {
    stack.push({
      id: TERRAIN_SOURCE_ID,
      stackIndex: TERRAIN_STACK_INDEX,
      source: {
        type: 'raster-dem',
        // `sharedDemProtocolUrl`, not `TERRAIN_DEM_URL` directly — the whole reason to route this
        // through `maplibre-contour` rather than fetching the terrarium PNGs a second time: the
        // hillshade layer, 3D terrain and the contour generator below all read ONE decoded DEM
        // tile cache instead of three independent fetches of the same bytes.
        tiles: [demSource.sharedDemProtocolUrl],
        tileSize: 256,
        maxzoom: DEM_MAXZOOM,
        encoding: 'terrarium',
        attribution: TERRAIN_ATTRIBUTION,
      },
      layers: [
        {
          id: TERRAIN_SOURCE_ID,
          type: 'hillshade',
          source: TERRAIN_SOURCE_ID,
          paint: buildHillshadePaint({
            exaggeration: state.terrain.hillshadeExaggeration,
            method: state.terrain.hillshadeMethod,
          }),
          // The source is mounted whenever hillshade OR 3D terrain is on — `setTerrain` (called
          // from `syncTerrain`, below) needs the source to already exist in the style — but the
          // shaded RENDER only draws when hillshade itself is requested. 3D-only leaves this
          // layer resident and invisible, one DEM shared by both toggles rather than two copies.
          layout: { visibility: state.terrain.hillshade ? 'visible' : 'none' },
        },
      ],
    })
  }

  // Contour lines — a second consumer of the SAME shared DEM cache as the hillshade source above,
  // independent of whether hillshade/3D are on: a hiker reading isolines has no need for shading.
  if (state.terrain.contours) {
    const { line, halo } = buildContourColors()
    stack.push({
      id: CONTOUR_SOURCE_ID,
      stackIndex: CONTOUR_STACK_INDEX,
      source: {
        type: 'vector',
        tiles: [demSource.contourProtocolUrl(CONTOUR_TILE_OPTIONS)],
        maxzoom: DEM_MAXZOOM,
        attribution: TERRAIN_ATTRIBUTION,
      },
      layers: [
        {
          id: CONTOUR_LINE_LAYER_ID,
          type: 'line',
          source: CONTOUR_SOURCE_ID,
          'source-layer': CONTOUR_LAYER_NAME,
          paint: {
            'line-color': line,
            // Readable but subordinate — the sky data is this map's answer, contours are context
            // (the same argument `TERRAIN_STACK_INDEX`'s comment makes for the hillshade). Driven
            // off the `level` property the library sets (0 = minor, 1 = major) with an
            // expression, not two hand-built sources.
            'line-width': [
              'case',
              ['==', ['get', CONTOUR_LEVEL_KEY], 1],
              CONTOUR_MAJOR_WIDTH,
              CONTOUR_MINOR_WIDTH,
            ],
            'line-opacity': [
              'case',
              ['==', ['get', CONTOUR_LEVEL_KEY], 1],
              CONTOUR_MAJOR_OPACITY,
              CONTOUR_MINOR_OPACITY,
            ],
          },
        },
        {
          id: CONTOUR_LABEL_LAYER_ID,
          type: 'symbol',
          source: CONTOUR_SOURCE_ID,
          'source-layer': CONTOUR_LAYER_NAME,
          // Labels only on major lines — minor-line labels at this density would be noise.
          filter: ['==', ['get', CONTOUR_LEVEL_KEY], 1],
          layout: {
            'symbol-placement': 'line',
            'text-field': ['concat', ['to-string', ['get', CONTOUR_ELEVATION_KEY]], ' m'],
            // `Noto Sans Regular`, not JetBrains Mono — see `CONTOUR_GLYPHS_URL`'s docstring in
            // `map-layers.ts` for why DESIGN.md's mono-numerals rule does not apply here.
            'text-font': [CONTOUR_LABEL_FONT],
            'text-size': 10,
          },
          paint: {
            'text-color': line,
            'text-halo-color': halo,
            'text-halo-width': 1,
          },
        },
      ],
    })
  }

  if (state.lpYear !== null) {
    const id = lpLayerId(state.lpYear)
    stack.push({
      id,
      stackIndex: LP_STACK_INDEX,
      source: {
        // Not terrain: the tiles are terrarium-ENCODED DATA (mpsas × 100), and `raster-dem` +
        // `color-relief` is the only MapLibre path that colours a numeric raster with our own
        // ramp. Mapbox's `raster-color` does not exist here (ASTRO-MAP-RESEARCH §6.3).
        type: 'raster-dem',
        tiles: [lpTileUrl(state.lpYear)],
        tileSize: 256,
        minzoom: 5,
        maxzoom: 9,
        encoding: 'terrarium',
        attribution: lpAttribution(state.lpYear),
      },
      layers: [
        {
          id,
          type: 'color-relief',
          source: id,
          paint: {
            'color-relief-color': buildLpRamp(state.lpRange),
            'color-relief-opacity': state.lpOpacity,
            // `resampling`, NOT `raster-resampling`. The latter is a RASTER-layer property; the
            // style-spec validator rejects it on a color-relief layer with `unknown property
            // "raster-resampling"` and the layer never gets added — verified against the shipped
            // @maplibre/maplibre-gl-style-spec. Drawer-controlled (`state.lpResampling`); MapLibre's
            // own default is `linear`, which smooths between the atlas's 30 arcsec samples — the
            // honest-granularity argument for `nearest` (the source stops at z9, so everything
            // above it overzooms) is a caveat the drawer states in one line, not a fixed veto.
            resampling: state.lpResampling,
          },
        },
      ],
    })
  }

  // Waymarked Trails — independent of hillshade/3D (both read the shared DEM; this reads its own
  // hiking tile server) but grouped into `state.terrain` because the drawer's Terrain section is
  // where "can I get there" lives. See `TRAILS_STACK_INDEX` in `map-layers.ts` for why it sits
  // above the ramp and below the weather annotations.
  if (state.terrain.trails !== null) {
    stack.push(
      rasterEntry({
        id: TRAILS_LAYER_ID,
        stackIndex: TRAILS_STACK_INDEX,
        tiles: TRAILS_TILES,
        attribution: TRAILS_ATTRIBUTION,
        opacity: state.terrain.trails,
      }),
    )
  }

  for (const selection of state.weather) {
    const entry = weatherLayer(selection.id)
    if (entry === undefined) continue

    if (entry.source === 'rainviewer') {
      // Pattern 3 from ASTRO-MAP-RESEARCH §6.5: one source PER FRAME, crossfaded by animating
      // `raster-opacity`. It beats `setTiles` (a full re-request every frame) and `updateImage`
      // because the frames stay in the tile cache, and at opacity 0 MapLibre skips the layer
      // entirely in render — so idle frames cost nothing per draw. Tile URLs come straight off
      // the query's already-resolved frames (`rainviewerQueries.radar()`), not `wmsTileUrl` —
      // RainViewer is not a WMS host. A loading or failed query resolves `state.radarFrames` to
      // `[]` here, so this branch simply pushes nothing — a dead third-party feed does not mount.
      state.radarFrames.forEach((frame, index) => {
        stack.push(
          rasterEntry({
            id: radarFrameLayerId(index, frame.time.toISOString()),
            stackIndex: entry.stackIndex,
            tiles: [frame.tileUrl],
            attribution: entry.attribution,
            // Every frame starts invisible; `paintOverlayState`/`paintRadarFrame` reveal exactly one.
            opacity: 0,
          }),
        )
      })
      continue
    }

    if (entry.source === 'cloud-mask') {
      // Two independent EUMETSAT discs, each its own `raster-dem` + `color-relief` pair — see
      // `CLOUD_RAMP`'s doc for the decode (`encoding: 'custom'` reading the red channel as
      // elevation) and `buildCloudRamp` for the paint expression it feeds.
      entry.hosts.forEach((host, index) => {
        const wmsLayer = entry.wmsLayers[index]
        if (wmsLayer === undefined) return
        const id = cloudLayerId(index)
        stack.push({
          id,
          stackIndex: entry.stackIndex,
          source: {
            type: 'raster-dem',
            tiles: [wmsTileUrl({ host, layer: wmsLayer })],
            tileSize: 256,
            encoding: 'custom',
            redFactor: 1,
            greenFactor: 0,
            blueFactor: 0,
            baseShift: 0,
            attribution: entry.attribution,
          },
          layers: [
            {
              id,
              type: 'color-relief',
              source: id,
              paint: {
                'color-relief-color': buildCloudRamp(),
                'color-relief-opacity': selection.opacity,
                // NOT `linear` (MapLibre's own default): a boundary-pixel census of one tile
                // found 7 034 distinct colours, nearly all of them anti-aliasing at cloud edges —
                // smoothing between them would smear the mask's genuinely binary field into a
                // haze. `resampling`, not `raster-resampling` — see the LP ramp's own paint block
                // above for why the latter fails the style-spec validator on this layer type.
                resampling: 'nearest',
              },
            },
          ],
        })
      })
      continue
    }

    if (entry.source === 'gibs-ir') {
      // Three independent satellites, one toggle. `gibsLayerId` folds the shared `gibsTime` into
      // each id, the same discipline `staticTimedLayerId` uses for the DWD grid.
      entry.gibsLayers.forEach((layer, index) => {
        stack.push(
          rasterEntry({
            id: gibsLayerId(index, state.gibsTime),
            stackIndex: entry.stackIndex,
            tiles: [gibsTileUrl(layer, state.gibsTime)],
            attribution: entry.attribution,
            opacity: selection.opacity,
            maxzoom: GIBS_MAXZOOM,
          }),
        )
      })
      continue
    }

    // `entry.source === 'wms'` — every remaining catalogue row (`radar-de`, `lightning`, `cells`,
    // `cloud-top`). Same one-source-per-timestamp shape as the radar frames, just with exactly one
    // frame: none of the four has a nowcast to animate, but the `time` its OWN `timeGrid` resolves
    // to (`weatherLayerTime`, `map-layers.ts`) still ages out of that grid's extent, so the id has
    // to move with it — see `staticTimedLayerId`. A new WMS row is a new row in the table and
    // nothing here changes, since `timeGrid` is required on every row rather than branched on here.
    const time = weatherLayerTime(entry, new Date(state.nowMs))
    stack.push(
      rasterEntry({
        id: staticTimedLayerId(entry.id, time),
        stackIndex: entry.stackIndex,
        tiles: [wmsTileUrl({ host: entry.host, layer: entry.wmsLayer, time })],
        attribution: entry.attribution,
        opacity: selection.opacity,
      }),
    )
  }

  return stack.toSorted((a, b) => a.stackIndex - b.stackIndex)
}

// ── Install / sync ─────────────────────────────────────────────────────────

/** Layer types that paint the GROUND — the thing our rasters have to cover to be readable. */
const GROUND_FILL_TYPES = new Set(['fill', 'fill-extrusion'])

/**
 * Where our rasters go in somebody else's style: above the basemap's ground, below its labels.
 *
 * "The first symbol layer" is the obvious anchor and it is WRONG on styles that order their layers
 * unusually. Measured across the four bases the catalogue ships (2026-08-18, first symbol layer by
 * index): fiord 31/48 `water_name`, positron 36/55 `waterway_line_label`, eclipse 276/324
 * `poi-amenity` — but ofm-dark puts `water_name` at 8 of 47, with `building` (an opaque
 * `rgb(10,10,10)` fill), `aeroway-area` and the entire road and rail network ABOVE it. Anchoring
 * there buries the pollution ramp and the radar under the built-up areas at exactly the zooms
 * where a city dome is what you came to look at.
 *
 * So the anchor is the first symbol layer that comes after the LAST ground fill. On fiord,
 * positron and eclipse that resolves to the same layer as before — verified, all three unchanged —
 * and on ofm-dark it moves from index 8 to 23, clearing the buildings and the motorways while
 * still leaving every place name on top. Roads that remain above are lines, not fills: they thin
 * the data rather than hide it, and the catalogue already warns that this base draws them loud.
 *
 * `undefined` (append on top) stays correct for a style with no symbol layer at all: no labels to
 * bury.
 */
function labelAnchorId(layers: readonly AddLayerObject[]): string | undefined {
  const lastGroundFill = layers.findLastIndex((layer) => GROUND_FILL_TYPES.has(layer.type))
  return layers.find((layer, index) => layer.type === 'symbol' && index > lastGroundFill)?.id
}

/**
 * Adds one raster below the label anchor — and below the app's OWN layers that belong further up
 * the stack, or a layer toggled on later would land on top of one that should cover it.
 *
 * `beforeId` resolves to the first already-mounted layer that belongs above this one, falling back
 * to the anchor.
 */
function addRasterBelowLabels(
  map: MapLibreMap,
  layer: AddLayerObject,
  above: readonly string[],
  anchorId: string | undefined,
): void {
  const mounted = above.find((id) => map.getLayer(id) !== undefined)
  map.addLayer(layer, mounted ?? anchorId)
}

/**
 * Registers every source and layer THIS app owns on top of whatever basemap style is current, and
 * removes the ones the state no longer asks for.
 *
 * Wired to `style.load` rather than called once, because a style swap destroys the entire style
 * object — sources and layers included — so this has to be able to rebuild the whole stack from
 * nothing. It is equally the incremental path for a drawer toggle: adds are guarded by `getLayer`
 * and removals are driven off the live style, so calling it twice with the same state is a no-op.
 */
export function installOverlays(map: MapLibreMap, state: OverlayState): void {
  /*
   * `getStyle()` is typed `StyleSpecification` but genuinely returns `undefined` for a window that
   * this app walks through on every base pick and on every scheme flip with no base pinned:
   * `setStyle(url, { diff: false })` synchronously installs a brand-new, UNLOADED `Style`
   * (`Map._updateStyle`), and `Style.serialize()` returns early while `_loaded` is false — so
   * `style.layers` would throw a TypeError out of a React effect. It is a window rather than a
   * failure: a base pick changes `styleUrl` and the overlay state in the SAME commit, and effects
   * run in declaration order, so the style-swap effect fires first and this one lands inside it.
   *
   * Returning is not a loss of work. `style.load` fires when the new style resolves and runs this
   * function again against the current state ref, which is the same path a theme toggle already
   * relies on. Verified against maplibre-gl 6.3.0.
   */
  const style: ReturnType<MapLibreMap['getStyle']> | undefined = map.getStyle()
  if (style === undefined) return

  const stack = desiredStack(state)
  // Two sets, not one: a source id (`entry.id`) and its layer ids no longer coincide now that
  // contours mount two layers off one source, so the removal sweep below has to check each
  // against the right one.
  const wantedSources = new Set(stack.map((entry) => entry.id))
  const wantedLayers = new Set(stack.flatMap((entry) => entry.layers.map((layer) => layer.id)))

  // Layers first, then their sources — MapLibre refuses to remove a source a layer still uses.
  for (const layer of style.layers) {
    if (layer.id.startsWith(OWN_PREFIX) && !wantedLayers.has(layer.id)) map.removeLayer(layer.id)
  }
  for (const sourceId of Object.keys(style.sources)) {
    if (sourceId.startsWith(OWN_PREFIX) && !wantedSources.has(sourceId)) map.removeSource(sourceId)
  }

  // Resolved once: `getStyle()` serialises the entire style, and a twelve-frame radar loop would
  // otherwise pay for that twelve times on a single toggle.
  const anchorId = labelAnchorId(style.layers)

  stack.forEach((entry, index) => {
    if (map.getSource(entry.id) === undefined) map.addSource(entry.id, entry.source)
    // Every id above THIS entry in stack order — not just the next entry's, since `entry.layers`
    // itself carries more than one layer for contours. Layers within `entry.layers` are pushed in
    // array order against this SAME `above` target, so the line (pushed first) lands directly
    // below the label (pushed second) purely from insertion order — no separate within-entry
    // ordering pass needed.
    const above = stack.slice(index + 1).flatMap((later) => later.layers.map((layer) => layer.id))
    for (const layer of entry.layers) {
      if (map.getLayer(layer.id) !== undefined) continue
      addRasterBelowLabels(map, layer, above, anchorId)
    }
  })
}

/**
 * The radar loop's ONLY per-frame work: drives `raster-opacity` on every mounted radar-frame
 * layer, revealing `radarFrame` and hiding the rest. Called on every `RADAR_FRAME_MS` tick from
 * `site-map.tsx`'s `[frame]` effect — nothing else in this module belongs on that path, because
 * everything else is drawer state that only ever changes on a state commit, not twice a second.
 *
 * Also called once from {@link paintOverlayState} (see its docblock for why): a fresh set of
 * frame layers from `installOverlays` all start at opacity 0 and need the current frame revealed.
 */
export function paintRadarFrame(map: MapLibreMap, state: OverlayState, radarFrame: number): void {
  for (const selection of state.weather) {
    const entry = weatherLayer(selection.id)
    if (entry === undefined || entry.source !== 'rainviewer') continue
    state.radarFrames.forEach((frame, index) => {
      const id = radarFrameLayerId(index, frame.time.toISOString())
      if (map.getLayer(id) === undefined) return
      map.setPaintProperty(id, 'raster-opacity', index === radarFrame ? selection.opacity : 0)
    })
  }
}

/**
 * Opacity only — never a re-add. `setPaintProperty` is what makes a slider cheap: the source and
 * its tiles stay put and only the paint value changes, where re-adding the layer would drop the
 * tile cache and re-request everything for a drag of a few pixels.
 *
 * Everything here is drawer-commit state — lp opacity/resampling/range, the five non-animated
 * weather kinds (`radar-de`/`lightning`/`cells`/`cloud-top`, `cloud`'s two discs, `cloud-ir`'s
 * three satellites), trails opacity, hillshade exaggeration/method — independent of `radarFrame`,
 * so it belongs on the state-change path (`site-map.tsx`'s `[overlayState]` effect and the `style.load`
 * handler) and NOT on the per-frame radar loop: writing these same values twice a second for no
 * reason was FIX 4 of the map-overlays review, split out into {@link paintRadarFrame} above.
 *
 * `hillshade-exaggeration`, `-method` and the illumination direction/altitude pair all follow the
 * same discipline: each is a drawer control value, so a change is one `setPaintProperty` call,
 * never a layer re-add (that would drop the DEM tile cache and re-decode every visible tile for a
 * drag of a few pixels or a flip of the `SegmentedControl`).
 *
 * The pollution ramp's own opacity, resampling mode AND sensitivity range follow the identical
 * discipline — all three are drawer control values (a slider, a smooth/sharp toggle, a
 * `RangeSlider`), so all three are `setPaintProperty` calls on the already-mounted `color-relief`
 * layer rather than a re-add that would drop the atlas tile cache for a drag of a few pixels.
 *
 * Ends by calling {@link paintRadarFrame} for the CURRENT frame — `installOverlays` may have just
 * mounted a brand new set of frame layers (all starting at opacity 0), and this is the one call on
 * the state-change path that reveals the one that should already be showing.
 */
export function paintOverlayState(map: MapLibreMap, state: OverlayState, radarFrame: number): void {
  if (state.lpYear !== null) {
    const id = lpLayerId(state.lpYear)
    if (map.getLayer(id) !== undefined) {
      map.setPaintProperty(id, 'color-relief-opacity', state.lpOpacity)
      map.setPaintProperty(id, 'resampling', state.lpResampling)
      // The sensitivity window is a drawer control like opacity/resampling above, not a source
      // reload — `RangeSlider`'s `onChangeEnd` lands here on the same commit path, never a
      // re-add (that would drop the atlas tile cache for a drag of the range handles).
      map.setPaintProperty(id, 'color-relief-color', buildLpRamp(state.lpRange))
    }
  }

  for (const selection of state.weather) {
    const entry = weatherLayer(selection.id)
    if (entry === undefined || entry.source === 'rainviewer') continue

    if (entry.source === 'cloud-mask') {
      entry.hosts.forEach((_host, index) => {
        const id = cloudLayerId(index)
        if (map.getLayer(id) === undefined) return
        map.setPaintProperty(id, 'color-relief-opacity', selection.opacity)
      })
      continue
    }

    if (entry.source === 'gibs-ir') {
      entry.gibsLayers.forEach((_layer, index) => {
        const id = gibsLayerId(index, state.gibsTime)
        if (map.getLayer(id) === undefined) return
        map.setPaintProperty(id, 'raster-opacity', selection.opacity)
      })
      continue
    }

    // `entry.source === 'wms'` — every row here bakes a `time` off its own `timeGrid`, so the id
    // is always the timed form; see the identical branch in `desiredStack` above.
    const id = staticTimedLayerId(entry.id, weatherLayerTime(entry, new Date(state.nowMs)))
    if (map.getLayer(id) === undefined) continue
    map.setPaintProperty(id, 'raster-opacity', selection.opacity)
  }

  if (state.terrain.trails !== null && map.getLayer(TRAILS_LAYER_ID) !== undefined) {
    map.setPaintProperty(TRAILS_LAYER_ID, 'raster-opacity', state.terrain.trails)
  }

  if (map.getLayer(TERRAIN_SOURCE_ID) !== undefined) {
    map.setPaintProperty(
      TERRAIN_SOURCE_ID,
      'hillshade-exaggeration',
      state.terrain.hillshadeExaggeration,
    )
    // The light model is a drawer `SegmentedControl`, not a source reload — a method flip has to
    // land here (never a layer re-add) for the same DEM-tile-cache reason as exaggeration above.
    const { direction, altitude } = hillshadeIllumination(state.terrain.hillshadeMethod)
    map.setPaintProperty(TERRAIN_SOURCE_ID, 'hillshade-method', state.terrain.hillshadeMethod)
    map.setPaintProperty(TERRAIN_SOURCE_ID, 'hillshade-illumination-direction', direction)
    map.setPaintProperty(TERRAIN_SOURCE_ID, 'hillshade-illumination-altitude', altitude)
  }

  paintRadarFrame(map, state, radarFrame)
}

/**
 * Re-resolves the ramp against the live palette without touching the source.
 *
 * Needed because the scheme and the style URL are no longer the same event: pinning an explicit
 * basemap in the drawer means a dark/light toggle changes the CSS variables but loads no new
 * style, so nothing fires `style.load` and the ramp would keep painting the other scheme's shades.
 */
export function refreshLpRamp(map: MapLibreMap, state: OverlayState): void {
  if (state.lpYear === null) return
  const id = lpLayerId(state.lpYear)
  if (map.getLayer(id) === undefined) return
  map.setPaintProperty(id, 'color-relief-color', buildLpRamp(state.lpRange))
}

/**
 * Same shape, same guard as {@link refreshLpRamp} — `cloud`'s `cloudHigh` token also resolves to
 * a different hex per scheme, so a bare dark/light flip with no style reload would otherwise
 * leave both EUMETSAT discs painting the other scheme's shade.
 */
export function refreshCloudRamp(map: MapLibreMap, state: OverlayState): void {
  const selection = state.weather.find((entry) => entry.id === 'cloud')
  if (selection === undefined) return
  const entry = weatherLayer('cloud')
  if (entry === undefined || entry.source !== 'cloud-mask') return
  entry.hosts.forEach((_host, index) => {
    const id = cloudLayerId(index)
    if (map.getLayer(id) === undefined) return
    map.setPaintProperty(id, 'color-relief-color', buildCloudRamp())
  })
}

/**
 * Same shape, same guards as {@link refreshLpRamp}: the hillshade's shadow/highlight/accent
 * colours are palette-derived, so a bare scheme flip with no style reload leaves them painting the
 * other scheme's tokens until this re-resolves them. `hillshade-exaggeration` is deliberately NOT
 * touched here — it is drawer state, not palette state, and `paintOverlayState` already keeps it
 * in sync on every state change. `hillshade-method` and the illumination direction/altitude pair
 * ARE pushed here too, alongside the colours: they come out of the same `buildHillshadePaint`
 * call as the colours, so re-resolving one without the other would need a second source of truth
 * for what `state.terrain.hillshadeMethod` currently is — `paintOverlayState` already keeps them
 * current on every drawer change, so this is redundant-but-cheap on that path and load-bearing
 * on the scheme-flip-with-no-source-touch path this function exists for.
 */
export function refreshHillshade(map: MapLibreMap, state: OverlayState): void {
  if (!state.terrain.hillshade && !state.terrain.extruded) return
  if (map.getLayer(TERRAIN_SOURCE_ID) === undefined) return
  const paint = buildHillshadePaint({
    exaggeration: state.terrain.hillshadeExaggeration,
    method: state.terrain.hillshadeMethod,
  })
  map.setPaintProperty(TERRAIN_SOURCE_ID, 'hillshade-method', paint['hillshade-method'])
  map.setPaintProperty(
    TERRAIN_SOURCE_ID,
    'hillshade-illumination-direction',
    paint['hillshade-illumination-direction'],
  )
  map.setPaintProperty(
    TERRAIN_SOURCE_ID,
    'hillshade-illumination-altitude',
    paint['hillshade-illumination-altitude'],
  )
  map.setPaintProperty(TERRAIN_SOURCE_ID, 'hillshade-shadow-color', paint['hillshade-shadow-color'])
  map.setPaintProperty(
    TERRAIN_SOURCE_ID,
    'hillshade-highlight-color',
    paint['hillshade-highlight-color'],
  )
  map.setPaintProperty(TERRAIN_SOURCE_ID, 'hillshade-accent-color', paint['hillshade-accent-color'])
}

/**
 * Same shape again, for the contour line/label colours — both derived from the palette
 * (`buildContourColors`), so they go stale on the same bare scheme flip `refreshLpRamp` and
 * `refreshHillshade` already guard against.
 */
export function refreshContours(map: MapLibreMap, state: OverlayState): void {
  if (!state.terrain.contours) return
  if (map.getLayer(CONTOUR_LINE_LAYER_ID) === undefined) return
  const { line, halo } = buildContourColors()
  map.setPaintProperty(CONTOUR_LINE_LAYER_ID, 'line-color', line)
  if (map.getLayer(CONTOUR_LABEL_LAYER_ID) !== undefined) {
    map.setPaintProperty(CONTOUR_LABEL_LAYER_ID, 'text-color', line)
    map.setPaintProperty(CONTOUR_LABEL_LAYER_ID, 'text-halo-color', halo)
  }
}

/**
 * The same unloaded-style window `installOverlays` guards against with its own `getStyle() ===
 * undefined` check (see that function's docblock for the full mechanism) — but `map.setTerrain`
 * does not degrade the way `installOverlays` does. Its implementation opens with
 * `this.style._checkLoaded()`, which THROWS `"Style is not done loading."` rather than no-opping
 * (verified against the installed maplibre-gl 6.3.0 `Map.setTerrain` source). `syncTerrain` and
 * `detachTerrainIfUnwanted` both call `setTerrain`, so both need this guard — it is REQUIRED to
 * stop the throw from aborting the rest of a `style.load`/state-change handler (which would strand
 * `installOverlays`'/`paintOverlayState`'s work half-applied), not merely defensive.
 */
function isStyleLoaded(map: MapLibreMap): boolean {
  return map.getStyle() !== undefined
}

/**
 * 3D terrain is map-level state (`map.setTerrain`), not a layer — `installOverlays` above only
 * gets the hillshade LAYER and the shared DEM source onto the style; this is the other half.
 *
 * **Order is load-bearing in BOTH directions, so this runs on both sides of `installOverlays`.**
 * Turning 3D on needs the DEM source in the style before `setTerrain` names it. Turning it off
 * needs `setTerrain(null)` before `installOverlays` drops that source — and MapLibre will not
 * catch the mistake: `Style.removeSource` refuses to remove a source a LAYER is using, but has
 * no equivalent check for one the TERRAIN is using (verified in the installed
 * maplibre-gl 6.3.0 `Style.removeSource`), so it would delete the tile manager out from under
 * the terrain renderer and fail later, somewhere else. This ordering is untouched by the
 * `isStyleLoaded` guard below — that guard decides WHETHER `setTerrain` may run at all, not where.
 *
 * Both calls are idempotent: {@link detachTerrainIfUnwanted} no-ops when 3D is staying on, and
 * `syncTerrain` no-ops when the source is not mounted yet or the terrain already matches.
 */
export function syncTerrain(map: MapLibreMap, state: OverlayState): void {
  if (!isStyleLoaded(map)) return
  if (!state.terrain.extruded) {
    detachTerrainIfUnwanted(map, state)
    return
  }
  if (map.getSource(TERRAIN_SOURCE_ID) === undefined) return
  const current = map.getTerrain()
  if (current?.source === TERRAIN_SOURCE_ID && current.exaggeration === TERRAIN_3D_EXAGGERATION) {
    return
  }
  map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_3D_EXAGGERATION })
}

/**
 * Drop `setTerrain` BEFORE the stack sync can remove the DEM source it points at. See
 * {@link syncTerrain} for why MapLibre does not do this for us, and {@link isStyleLoaded} for why
 * this guards the same unloaded-style window `syncTerrain` does — this function is also called
 * directly (`site-map.tsx`'s `[overlayState]` effect), not only via `syncTerrain`.
 */
export function detachTerrainIfUnwanted(map: MapLibreMap, state: OverlayState): void {
  if (!isStyleLoaded(map)) return
  if (state.terrain.extruded) return
  if (map.getTerrain() !== null) map.setTerrain(null)
}
