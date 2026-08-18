import type { AddLayerObject, Map as MapLibreMap } from 'maplibre-gl'
import {
  BASE_STACK_INDEX,
  baseLayer,
  LP_ATTRIBUTION,
  LP_RAMP,
  LP_STACK_INDEX,
  lpTileUrl,
  wmsTileUrl,
  weatherLayer,
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
const radarFrameLayerId = (index: number) => `${OWN_PREFIX}wx-radar-${index}`

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
 * Reads the live palette and returns the paint expression. Called on every `style.load` AND on a
 * bare scheme flip, so the ramp is always built from the shades that are actually mounted rather
 * than from whichever scheme happened to be current when the layer was added. The cast is
 * unavoidable: spreading a variable-length stop list widens the tuple that
 * `ExpressionSpecification` is, and the shape is validated by the style spec at runtime anyway.
 */
export function buildLpRamp(): LpRampExpression {
  const cs = getComputedStyle(document.documentElement)
  const stops = LP_RAMP.flatMap(({ stop, token, alpha: opacity }) => [
    stop,
    resolveStopColor(cs, token, opacity),
  ])
  return ['interpolate', ['linear'], ['elevation'], ...stops] as LpRampExpression
}

// ── The desired stack ──────────────────────────────────────────────────────

/**
 * One entry of the stack. `id` doubles as the source id — one source, one layer.
 *
 * `stackIndex` is the catalogue's single ordering scale (`BASE_STACK_INDEX` / `LP_STACK_INDEX` /
 * `WeatherLayer.stackIndex`), carried here so the whole stack is sorted ONCE at the end rather
 * than assembled in whatever order the branches happen to run.
 */
type StackEntry = { id: string; stackIndex: number; source: SourceSpec; layer: AddLayerObject }

/** The layer state plus the frame timestamps, which are derived once and then held steady. */
export type OverlayState = MapLayerState & {
  /** Empty unless the radar layer is on. Held in a ref by the component so a restyle reuses it. */
  radarTimes: readonly string[]
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
    layer: { id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } },
  }
}

/**
 * The stack the current state asks for, ordered BOTTOM first.
 *
 * Order is the whole contract here, and it is decided by ONE number per entry — the catalogue's
 * shared stack scale — not by the order these branches run in. That is what lets the cloud mask
 * (an opaque full-disc wash) sit UNDER the pollution ramp while the sparse annotations sit over
 * it; a stack assembled imagery → ramp → weather could only ever put every overlay on top.
 *
 * The sort is stable (ES2019+), so the radar's twelve frames keep the order they were pushed in.
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
        attribution: LP_ATTRIBUTION,
      },
      layer: {
        id,
        type: 'color-relief',
        source: id,
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
      },
    })
  }

  for (const selection of state.weather) {
    const entry = weatherLayer(selection.id)
    if (entry === undefined) continue

    if (entry.animated) {
      // Pattern 3 from ASTRO-MAP-RESEARCH §6.5: one source PER FRAME, crossfaded by animating
      // `raster-opacity`. It beats `setTiles` (a full re-request every frame) and `updateImage`
      // because the frames stay in the tile cache, and at opacity 0 MapLibre skips the layer
      // entirely in render — so eleven idle frames cost nothing per draw.
      state.radarTimes.forEach((time, index) => {
        stack.push(
          rasterEntry({
            id: radarFrameLayerId(index),
            stackIndex: entry.stackIndex,
            tiles: [wmsTileUrl({ host: entry.host, layer: entry.wmsLayer, time })],
            attribution: entry.attribution,
            // Every frame starts invisible; `paintOverlays` reveals exactly one.
            opacity: 0,
          }),
        )
      })
      continue
    }

    stack.push(
      rasterEntry({
        id: weatherLayerId(entry.id),
        stackIndex: entry.stackIndex,
        tiles: [wmsTileUrl({ host: entry.host, layer: entry.wmsLayer })],
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
  const wanted = new Set(stack.map((entry) => entry.id))

  // Layers first, then their sources — MapLibre refuses to remove a source a layer still uses.
  for (const layer of style.layers) {
    if (layer.id.startsWith(OWN_PREFIX) && !wanted.has(layer.id)) map.removeLayer(layer.id)
  }
  for (const sourceId of Object.keys(style.sources)) {
    if (sourceId.startsWith(OWN_PREFIX) && !wanted.has(sourceId)) map.removeSource(sourceId)
  }

  // Resolved once: `getStyle()` serialises the entire style, and a twelve-frame radar loop would
  // otherwise pay for that twelve times on a single toggle.
  const anchorId = labelAnchorId(style.layers)

  stack.forEach((entry, index) => {
    if (map.getSource(entry.id) === undefined) map.addSource(entry.id, entry.source)
    if (map.getLayer(entry.id) !== undefined) return
    const above = stack.slice(index + 1).map((later) => later.id)
    addRasterBelowLabels(map, entry.layer, above, anchorId)
  })
}

/**
 * Opacity only — never a re-add. `setPaintProperty` is what makes a slider cheap: the source and
 * its tiles stay put and only the paint value changes, where re-adding the layer would drop the
 * tile cache and re-request everything for a drag of a few pixels.
 *
 * `radarFrame` indexes `state.radarTimes`; every other frame is driven to 0, which is what makes
 * the loop free to render.
 */
export function paintOverlays(map: MapLibreMap, state: OverlayState, radarFrame: number): void {
  for (const selection of state.weather) {
    const entry = weatherLayer(selection.id)
    if (entry === undefined) continue

    if (entry.animated) {
      state.radarTimes.forEach((_, index) => {
        const id = radarFrameLayerId(index)
        if (map.getLayer(id) === undefined) return
        map.setPaintProperty(id, 'raster-opacity', index === radarFrame ? selection.opacity : 0)
      })
      continue
    }

    const id = weatherLayerId(entry.id)
    if (map.getLayer(id) === undefined) continue
    map.setPaintProperty(id, 'raster-opacity', selection.opacity)
  }
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
  map.setPaintProperty(id, 'color-relief-color', buildLpRamp())
}
