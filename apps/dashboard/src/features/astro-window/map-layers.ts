import { apiBase } from '../../lib/api-base'
import { LP } from '../../lib/series'

/**
 * The astro map's layer catalogue — ONE typed table the settings drawer renders from, so no
 * control is hand-written per layer and a new source is a new row rather than a new component.
 *
 * Every endpoint below was probed live from this machine on 2026-08-18 with the exact URL this
 * module builds; the byte counts are in the Phase 5 report. Two traps are baked into the builder
 * rather than left to the caller:
 *
 * 1. **WMS 1.1.1 with `SRS=EPSG:3857`, never 1.3.0 with `CRS=`.** 1.3.0 re-reads the BBOX in the
 *    CRS's declared axis order, and the failure mode is a 200 with an empty PNG — which reads as
 *    "no weather right now", not as a bug. 1.1.1 has one axis order and no such ambiguity.
 * 2. **`bbox={bbox-epsg-3857}` is appended raw, after `URLSearchParams`.** Running the template
 *    through the encoder turns the braces into `%7B…%7D` and MapLibre's substitution never fires,
 *    so the request goes out with a literal placeholder.
 *
 * Deliberately NOT in this catalogue, so the next person does not re-research them:
 *
 * - **Esri World Imagery** — works keyless, but its own terms want a free developer account, cap
 *   it at <1M requests/month for non-commercial use, and mandate a `Powered by Esri` credit plus
 *   a fixed `Sources:` string. EOX s2cloudless answers the same question (what does the ground
 *   actually look like) under a plain CC BY-NC-SA 4.0 that a personal tool can satisfy with one
 *   attribution line, so the imagery slot went to EOX and Esri was dropped.
 * - **CARTO basemaps** — Enterprise-only since 2025-10-16 (ASTRO-MAP-RESEARCH §6.1). Not a
 *   licensing grey area; do not add them.
 * - **DWD Meteosat RGB** (`dwd:Satellite_meteosat_1km_euat_rgb_day_hrv_and_night_ir108_3h`) — a
 *   3 h cadence cannot answer "is it clear tonight". EUMETSAT's `msg_fes:clm` is the same picture
 *   at PT15M.
 * - **DWD warning polygons** (`dwd:Autowarn_*`) — a civil-protection product. It says "hail is
 *   coming", not "the sky is clear", and nothing here reads it.
 * - **RainViewer** — its nowcast and satellite products were discontinued 2026-01-01 (verified:
 *   the API returns empty arrays). DWD RV covers the same ground at 1 km with a real nowcast.
 * - **Core-direction glow rose, drive-time isochrones** — real features, but they need API
 *   surface that does not exist yet (`/astro/skyglow` returns a rose but nothing renders it as a
 *   map layer) and are out of scope here. Terrain (hillshade + optional 3D) shipped below.
 */

// ── Ids ────────────────────────────────────────────────────────────────────

export type BaseLayerId =
  | 'ofm-fiord'
  | 'ofm-positron'
  | 'ofm-dark'
  | 'versatiles-eclipse'
  | 'eox-s2cloudless'
  | 'otm'

/** Ids ride in a URL search param, so they carry no `.` — that is the delimiter. */
export type WeatherLayerId = 'radar' | 'lightning' | 'cells' | 'cloudmask'

/**
 * Atlas vintages. `apps/api/src/lib/lorenz-decode.ts` → `LORENZ_YEARS` is the AUTHORITY — the
 * tile route validates `:year` against it and 422s on anything else. This list is the client's
 * copy so the drawer can render without a round-trip; if the API ever publishes a new vintage,
 * this is the second place to edit.
 */
export const LP_YEARS = [2016, 2020, 2022, 2023, 2024, 2025] as const
export type LpYear = (typeof LP_YEARS)[number]

/** The vintage the map opens on — the latest the atlas has published. */
export const DEFAULT_LP_YEAR: LpYear = 2025

// ── Stack order ────────────────────────────────────────────────────────────

/**
 * Every raster this app mounts — an imagery base, the pollution ramp, each weather overlay — is
 * sorted onto ONE scale, bottom first. "Which layer covers which" is then a number in this file
 * rather than the order some loop happened to push things in.
 *
 * The cloud mask is why the ramp has to be ON that scale rather than hardcoded under the weather
 * group. EUMETSAT's `msg_fes:clm` is an OPAQUE RGB PNG — probed 2026-08-18 with the exact URL
 * `wmsTileUrl` emits: colour type 2, no alpha channel, no `tRNS`, and inside the product footprint
 * every single pixel is painted (white for cloud, green for clear land, blue for clear sea).
 * `transparent=true` only clears the area OUTSIDE the disc. Stacked above the ramp it is a 45 %
 * sheet across the whole viewport and the blue-is-dark-sky reading this page exists for is gone;
 * below it, it is the wash it was always described as. Radar, storm cells and lightning are sparse
 * annotations and stay above the ramp, where burying them would make them worthless.
 *
 * Hillshade sits between the base and everything else: it is CONTEXT for reading the ramp (which
 * ridge blocks which valley), not an answer of its own, so it renders under the pollution ramp
 * and under the weather group too (`docs/ASTRO-HORIZON-RESEARCH.md` §6 — "the ramp is the answer
 * and the hillshade is context").
 *
 * The Waymarked Trails hiking overlay sits above the ramp for the opposite reason: a trail is an
 * ANSWER ("can I walk there"), not context, so burying it under a city dome would make it
 * pointless. It still sits below the weather annotations, because a storm cell or lightning
 * strike is more urgent than the path it may be closing.
 */
export const BASE_STACK_INDEX = 0
export const TERRAIN_STACK_INDEX = 5

/**
 * The contour lines — terrain context, the same argument `TERRAIN_STACK_INDEX`'s comment already
 * makes for the hillshade, not an answer of its own. Sits above the hillshade (5) and below the
 * cloud mask / pollution ramp (10/15): a deliberate gap of its own rather than sharing the cloud
 * mask's 10, so the stable sort never has to break a tie between two conceptually different
 * layers.
 */
export const CONTOUR_STACK_INDEX = 8
export const LP_STACK_INDEX = 15

/**
 * The Waymarked Trails hiking overlay. Above the ramp — a path buried under a 90 % alpha city-dome
 * stop is worthless — but below the weather annotations (radar/cells/lightning start at 20), so a
 * storm cell or lightning strike still reads over the trail network it might rain out.
 */
export const TRAILS_STACK_INDEX = 18

// ── WMS plumbing ───────────────────────────────────────────────────────────

const DWD_WMS = 'https://maps.dwd.de/geoserver/dwd/wms'
const EUMETSAT_WMS = 'https://view.eumetsat.int/geoserver/wms'

/** Both WMS hosts are asked for 256 px tiles, matching MapLibre's default raster tile size. */
const WMS_TILE_SIZE = 256

/** See the module docstring — the version and the BBOX handling are the whole trap surface. */
export function wmsTileUrl({
  host,
  layer,
  time,
}: {
  host: string
  layer: string
  time?: string
}): string {
  const query = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    layers: layer,
    styles: '',
    format: 'image/png',
    transparent: 'true',
    srs: 'EPSG:3857',
    width: String(WMS_TILE_SIZE),
    height: String(WMS_TILE_SIZE),
  })
  if (time !== undefined) query.set('time', time)
  return `${host}?${query.toString()}&bbox={bbox-epsg-3857}`
}

/**
 * `GetLegendGraphic` for a DWD layer — a plain PNG, no bbox/tile plumbing needed. Verified
 * 2026-08-18/19 (see the module docstring's live-probe date): radar 5367 B, Blitzdichte 4906 B,
 * Gewitterzellen 2762 B at 161×80 px. EUMETSAT is a different host with its own legend contract
 * and is out of scope — callers must not call this for a `WeatherLayer` with `legend` unset.
 *
 * `transparent=true` plus `LEGEND_OPTIONS` are both required, not cosmetic: the plain URL returns
 * colour-type 2 (RGB, no alpha) with a solid WHITE background — a glaring slab on this app's dark
 * zinc surface — and `fontColor` is what makes the labels legible against it once it is gone.
 * Re-verified with `LEGEND_OPTIONS` run through `URLSearchParams` (its `;` separators arrive
 * percent-encoded as `%3B`, not literal): GeoServer decodes the query string before parsing the
 * option list, so the encoded form returns the identical colour-type-6 RGBA PNG as a raw `;` —
 * probed both ways 2026-08-19, 112×344 px either way. `fontColor` is caller-supplied rather than
 * hardcoded so it can be resolved from the live palette (`resolveLegendFontColor` in
 * `components/map-overlays.ts`) and re-requested on a scheme flip.
 */
export function legendUrl(entry: WeatherLayer, fontColor: string): string {
  const query = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetLegendGraphic',
    format: 'image/png',
    layer: entry.wmsLayer,
    transparent: 'true',
    LEGEND_OPTIONS: `fontColor:${fontColor};fontAntiAliasing:true;bgColor:0x000000;fontSize:10;dpi:96`,
  })
  return `${entry.host}?${query.toString()}`
}

// ── Attribution ────────────────────────────────────────────────────────────

/**
 * Attribution reaches MapLibre through the SOURCE, never through `customAttribution` — Phase 4
 * measured that passing both prints the credit twice. A `null` here means the provider's own
 * style JSON / TileJSON already carries the string and MapLibre will compose it unaided.
 */
const DWD_ATTRIBUTION = '<a href="https://www.dwd.de" target="_blank">DWD</a>'
const EUMETSAT_ATTRIBUTION = '<a href="https://www.eumetsat.int" target="_blank">EUMETSAT</a>'

/**
 * EOX's own credit, condensed to one attribution line — NOT verbatim, which is worth writing down
 * because the licence is what makes this string load-bearing.
 *
 * The canonical wording is the `ows:Abstract` of `s2cloudless-2025_3857` in
 * https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml (re-read 2026-08-18): "EOxCloudless
 * https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data
 * 2025) released under [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International
 * License]. For commercial usage please see https://cloudless.eox.at".
 *
 * Kept: the product name, the rights holder, the modified-Copernicus notice and the LINKED licence
 * — everything CC BY-NC-SA 4.0 actually requires. Dropped: the commercial-usage pointer, because a
 * personal dashboard is the non-commercial case it points away from. Re-read the capabilities
 * before editing this string; do not trust the paraphrase above.
 */
const EOX_ATTRIBUTION =
  '<a href="https://cloudless.eox.at" target="_blank">EOxCloudless</a> by EOX IT Services GmbH ' +
  '(contains modified Copernicus Sentinel data 2025), released under ' +
  '<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="license">CC BY-NC-SA 4.0</a>'

/**
 * OpenTopoMap's mandated credit, exactly the required form (licence CC-BY-SA 3.0 — attribution is
 * not optional): "Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap
 * (CC-BY-SA)", with `OpenStreetMap` → the OSM copyright page, `OpenTopoMap` → the project site,
 * and `CC-BY-SA` → the licence text, all linked.
 */
const OTM_ATTRIBUTION =
  'Map data: © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, SRTM | ' +
  'Map style: © <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> ' +
  '(<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="license">CC-BY-SA</a>)'

/**
 * The Lorenz atlas licence requires the credit; our own tile source declares it. Vintage-scoped —
 * the drawer offers every year in `LP_YEARS`, so a hard-coded 2025 would credit the wrong atlas
 * the moment anyone selects 2016/2020/2022/2023/2024. Wording matches
 * `apps/api/src/clients/lorenz-atlas.ts`'s `sourceLabel(year)` exactly, since that is the
 * server-side half of the same credit and the two must agree.
 */
export function lpAttribution(year: LpYear): string {
  return `Light Pollution Atlas ${year}, David J. Lorenz`
}

// ── Base group (exclusive) ─────────────────────────────────────────────────

/**
 * A base is one of three things, and the union says which:
 *
 * - `style` — a whole MapLibre style JSON. Swapping it tears down every source and layer, which
 *   is exactly why `installOverlays` is wired to `style.load` rather than called once.
 * - `imagery` — a raster source mounted OVER the scheme's default vector style, inserted below
 *   the first symbol layer so the place names survive on top of it. Cheaper and more useful than
 *   a bespoke imagery-only style: the labels are what make a satellite view navigable.
 * - `raster-style` — a raster source that IS the whole style, with no vector style underneath and
 *   no labels of its own to preserve. OpenTopoMap ships its own contour lines, marked paths and
 *   place names baked into the tile, so mounting it the `imagery` way (over OpenFreeMap's vector
 *   labels) would stack two independent label sets on top of each other. `site-map.tsx` builds
 *   this one an inline `StyleSpecification` object rather than a URL — see `mapStyle` there.
 */
export type BaseLayer = {
  id: BaseLayerId
  label: string
  /** What the base actually shows — the reason to pick it over the neighbouring row. */
  description: string
  defaultOpacity: number
  /** `null` = the provider's style JSON supplies its own credit. */
  attribution: string | null
} & (
  | { kind: 'style'; styleUrl: string; tiles?: never; maxzoom?: never }
  | { kind: 'imagery'; styleUrl?: never; tiles: readonly string[]; maxzoom: number }
  | { kind: 'raster-style'; styleUrl?: never; tiles: readonly string[]; maxzoom: number }
)

export const BASE_LAYERS: readonly BaseLayer[] = [
  {
    id: 'ofm-fiord',
    kind: 'style',
    label: 'Fiord',
    description:
      'Cool blue-grey vector map with quiet roads and legible Alpine relief. The dark-mode default — it leaves the light-pollution domes as the only loud thing on the map.',
    styleUrl: 'https://tiles.openfreemap.org/styles/fiord',
    defaultOpacity: 1,
    attribution: null,
  },
  {
    id: 'ofm-positron',
    kind: 'style',
    label: 'Positron',
    description:
      'Near-white vector map. The light-mode default, and the one the light-scheme ramp shades were tuned against.',
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
    defaultOpacity: 1,
    attribution: null,
  },
  {
    id: 'ofm-dark',
    kind: 'style',
    label: 'Dark',
    description:
      'The darker OpenFreeMap style. Kept as an option, not a default: its road network renders near-black and heavy, so the roads read louder than the data sitting under them.',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark',
    defaultOpacity: 1,
    attribution: null,
  },
  {
    id: 'versatiles-eclipse',
    kind: 'style',
    label: 'Eclipse',
    description:
      'VersaTiles dark style — a second, independent tile host if OpenFreeMap is down. Its orange roads collide with the warm half of the pollution ramp, so it reads best with the ramp off.',
    styleUrl: 'https://tiles.versatiles.org/assets/styles/eclipse/style.json',
    defaultOpacity: 1,
    attribution: null,
  },
  {
    id: 'eox-s2cloudless',
    kind: 'imagery',
    label: 'Satellite',
    description:
      'Cloud-free Sentinel-2 mosaic — what the ground actually looks like: forest, water, the field you would park in. Mutually exclusive with the pollution ramp.',
    tiles: [
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
    ],
    // Sentinel-2 is 10 m ground sample distance — roughly z14. Past that MapLibre overzooms the
    // cached tile instead of asking for detail the mosaic does not have.
    maxzoom: 14,
    defaultOpacity: 1,
    attribution: EOX_ATTRIBUTION,
  },
  {
    id: 'otm',
    kind: 'raster-style',
    label: 'Topographic',
    description:
      'Contour lines, marked hiking paths, hut and peak names — OpenTopoMap\'s own labels baked into the tile. Pick this when the question is "can I walk to this spot in the dark", not "how bright is the sky here". Mutually exclusive with the pollution ramp.',
    tiles: [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    // Probed 2026-08-18: z17 → 200, z18 blank. Beyond 17 the server has nothing to serve.
    maxzoom: 17,
    defaultOpacity: 1,
    attribution: OTM_ATTRIBUTION,
  },
]

const BASE_BY_ID = new Map(BASE_LAYERS.map((entry) => [entry.id, entry]))

/** The Zod enum for the `base` search param, derived from the table so the two cannot drift. */
export const BASE_LAYER_IDS = BASE_LAYERS.map((entry) => entry.id) as [
  BaseLayerId,
  ...BaseLayerId[],
]

/**
 * The scheme's default base — what an untouched URL resolves to, and what an LP pick falls back to.
 *
 * `fiord` replaced `dark` on 2026-08-18 (ASTRO-MAP-RESEARCH §6.6, decided by rendering the real
 * tiles against four basemaps): ofm-dark's road network renders near-black and heavy, so the roads
 * read louder than the light-pollution data sitting under them. fiord is cool blue-grey with quiet
 * roads and legible Alpine terrain shading, which leaves the domes as the only loud thing on the
 * map.
 */
export const SCHEME_DEFAULT_BASE = {
  dark: 'ofm-fiord',
  light: 'ofm-positron',
} as const satisfies Record<'dark' | 'light', BaseLayerId>

export function baseLayer(id: BaseLayerId): BaseLayer {
  const found = BASE_BY_ID.get(id)
  // The id comes out of a Zod-validated search param, so this is a type narrowing rather than a
  // real branch — but a hand-edited URL must not be able to blank the map.
  return found ?? (BASE_LAYERS[0] as BaseLayer)
}

/**
 * The scheme defaults resolved to their style URLs — DERIVED, never re-typed. An imagery base is a
 * raster mounted over the scheme's own vector style, so the map needs the URL as well as the id;
 * spelling the two OpenFreeMap links a second time in the component is what would let
 * `SCHEME_DEFAULT_BASE` and the style actually mounted drift apart without anything noticing.
 *
 * The throw is the point: it can only fire if a scheme default is pointed at an imagery row, which
 * is a configuration mistake, and a module-load failure is a far better way to learn about it than
 * a map that silently mounts the wrong basemap.
 */
function styleUrlOf(id: BaseLayerId): string {
  const entry = baseLayer(id)
  if (entry.kind !== 'style') throw new Error(`Scheme default base '${id}' is not a vector style`)
  return entry.styleUrl
}

export const SCHEME_STYLE_URL = {
  dark: styleUrlOf(SCHEME_DEFAULT_BASE.dark),
  light: styleUrlOf(SCHEME_DEFAULT_BASE.light),
} as const satisfies Record<'dark' | 'light', string>

// ── Light pollution (exclusive) ────────────────────────────────────────────

/**
 * Built from the app's one shared API base (`lib/api-base`), never hardcoded — in production the
 * dashboard is served from `argo.jkrumm.com` and the API lives under `/api` on the same origin,
 * so a localhost literal here would leave the map with no data at all.
 */
export function lpTileUrl(year: LpYear): string {
  return `${apiBase}/astro/tiles/lp/${year}/{z}/{x}/{y}.png`
}

/** Percent, 0–100 integer. Anything else means "use the default". Shared by every `[0, 1]`
 * URL-encoded value in this module — the `wx`/`terrain` opacity suffixes and the `lp` ramp
 * opacity below all reuse it, rather than three copies of the same regex/clamp. */
function parseOpacity(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d{1,3}$/.test(raw)) return undefined
  const percent = Number(raw)
  return percent > 100 ? undefined : percent / 100
}

/**
 * `color-relief-color`'s resampling mode — MapLibre's own texture-magnification choice for a
 * `color-relief` layer, exposed as a drawer toggle rather than a fixed decision. `linear`
 * (MapLibre's own default too) smooths between the atlas's 30 arcsec samples; `nearest` renders
 * their true block granularity instead of pretending to a resolution the data does not have.
 */
export type LpResampling = 'linear' | 'nearest'
export const LP_RESAMPLING_DEFAULT: LpResampling = 'linear'

/** The `color-relief` layer's own opacity — the ramp's wash over the basemap, independent of any
 * per-stop alpha inside `LP_RAMP` (that alpha is ramp GEOMETRY; this is the layer-level control
 * the drawer's slider drives). */
export const LP_OPACITY_DEFAULT = 1

/**
 * The ramp, as ONE table so it reads as a ramp.
 *
 * `stop` is the raw tile payload — mpsas × 100, i.e. `1800` is 18.00 mag/arcsec². The stops
 * ASCEND (MapLibre's `interpolate` requires it), which is why the table runs from the polluted
 * end to the pristine one rather than the other way round.
 *
 * `alpha` is ramp GEOMETRY, not series identity — several rows below reuse ONE token at more
 * than one alpha, the pattern the cool end already established (`lpDark`/`lpDarker`/`lpPristine`
 * are one hue each, separated only by opacity) — so it lives here beside the stops rather than in
 * the token. The MINIMUM sits exactly on `lpRural`'s stop (2130, the neutral crossing this ramp
 * is diverging around — see DESIGN.md): a diverging ramp has to fade to its most transparent
 * exactly AT the crossing, not one stop past it, or the map reads as flat colour blocks rather
 * than a gradient. Alpha then rises monotonically in both directions away from that minimum — no
 * dips anywhere else in the table. The ladder is recorded in DESIGN.md under "Light pollution
 * ramp".
 */
export const LP_RAMP: ReadonlyArray<{ stop: number; token: string; alpha: number }> = [
  { stop: 1800, token: LP.lpCity, alpha: 0.9 }, // 18.00 — inner city
  { stop: 1960, token: LP.lpUrban, alpha: 0.62 }, // 19.60
  { stop: 2060, token: LP.lpSuburban, alpha: 0.4 }, // 20.60
  { stop: 2095, token: LP.lpSuburban, alpha: 0.24 }, // 20.95 — suburban fading toward the crossing
  { stop: 2130, token: LP.lpRural, alpha: 0.12 }, // 21.30 — the neutral crossing, the alpha minimum
  { stop: 2145, token: LP.lpRural, alpha: 0.15 }, // 21.45 — rural opening back up past the crossing
  { stop: 2155, token: LP.lpDark, alpha: 0.18 }, // 21.55 — the band our sites live in
  { stop: 2170, token: LP.lpDark, alpha: 0.25 }, // 21.70
  { stop: 2180, token: LP.lpDarker, alpha: 0.31 }, // 21.80
  { stop: 2190, token: LP.lpDarker, alpha: 0.37 }, // 21.90
  { stop: 2200, token: LP.lpPristine, alpha: 0.44 }, // 22.00 — natural sky
]

/** The two ends of the ramp, in mpsas × 100 — the legend's axis and the gradient's domain. */
export const LP_RAMP_MIN = LP_RAMP[0]?.stop ?? 0
export const LP_RAMP_MAX = LP_RAMP[LP_RAMP.length - 1]?.stop ?? 0

/** Where the ramp crosses into the cool half — read off the table, not restated as a literal.
 * `lpDark` appears twice in the table now (2155 and 2170); `.find` takes the first, which is the
 * real value this constant has always named — Walchensee's own measured zenith mpsas. */
export const LP_SITE_BAND = LP_RAMP.find((s) => s.token === LP.lpDark)?.stop ?? LP_RAMP_MAX

/** The `lp` search param's off value, spelled once. */
export const LP_PARAM_OFF = 'off'

/** The decoded shape of the `lp` search param — the atlas vintage (or off), the ramp's own
 * opacity, and its resampling mode. `null` year and both the opacity/resampling defaults is what
 * an untouched `?lp=off` decodes to. */
export type LpSelection = { year: LpYear | null; opacity: number; resampling: LpResampling }

/**
 * `lp` search param → the catalogue's light-pollution selection: `off`, or
 * `<year>[:<percent>[:sharp]]` — the same `id[:opacity]` shape `wx`/`terrain` already use for
 * their overlays, extended with one more optional suffix. `sharp` is the only non-default
 * resampling token this reads; its absence means `linear`.
 */
export function parseLpParam(raw: string): LpSelection {
  if (raw === LP_PARAM_OFF) {
    return { year: null, opacity: LP_OPACITY_DEFAULT, resampling: LP_RESAMPLING_DEFAULT }
  }
  const [rawYear, rawPercent, rawResampling] = raw.split(':')
  const yearNum = Number(rawYear) as LpYear
  const year = LP_YEARS.includes(yearNum) ? yearNum : DEFAULT_LP_YEAR
  const opacity = parseOpacity(rawPercent) ?? LP_OPACITY_DEFAULT
  const resampling: LpResampling = rawResampling === 'sharp' ? 'nearest' : LP_RESAMPLING_DEFAULT
  return { year, opacity, resampling }
}

/** Inverse of `parseLpParam`. Drops the percent/resampling suffixes when both already match the
 * catalogue default, the same convention `formatWeatherParam`/`formatTerrainParam` use. */
export function formatLpParam(selection: LpSelection): string {
  if (selection.year === null) return LP_PARAM_OFF
  const percent = Math.round(selection.opacity * 100)
  const opacityDefault = percent === Math.round(LP_OPACITY_DEFAULT * 100)
  const resamplingDefault = selection.resampling === LP_RESAMPLING_DEFAULT
  if (opacityDefault && resamplingDefault) return String(selection.year)
  const tokens = [String(selection.year), String(percent)]
  if (!resamplingDefault) tokens.push('sharp')
  return tokens.join(':')
}

/** One line per vintage, so the drawer's year list explains itself rather than listing numbers. */
export const LP_YEAR_NOTES: Record<LpYear, string> = {
  2016: 'The oldest vintage. Ten years of LED conversion ago — useful only as the other end of a trend.',
  2020: 'Mid-decade reference.',
  2022: 'Mid-decade reference.',
  2023: 'Mid-decade reference.',
  2024: 'Second-latest — the sanity check on 2025.',
  2025: 'The latest published atlas. Every measured site figure in this app is read from it.',
}

// ── Weather now (multi) ────────────────────────────────────────────────────

/**
 * DWD RV is a 5-minutely product with a +0…+105 min nowcast attached, so a frame is a `&time=`
 * on the same GetMap URL. Twelve frames at 5 min is the shipped loop: it opens on three real
 * observations (enough to read which way a band is travelling — the only thing a loop is for)
 * and then runs 40 minutes forward, which is roughly the drive to the nearest sites. Twenty-one
 * frames would cover the whole +105 nowcast, but each frame is a separate source with its own
 * tile pyramid: 21 of them nearly doubles the request count on open for nowcast skill that is
 * already decaying past the first hour.
 */
export const RADAR_FRAME_COUNT = 12
export const RADAR_STEP_MINUTES = 5

/**
 * How far behind the wall clock the first frame sits. The WMS advertises its newest analysis in
 * `REFERENCE_TIME`, which trailed the clock by ~7 min when this was probed; 15 min is that lag
 * with room to spare, so the loop never opens on a timestamp DWD has not published. Asking for
 * an unpublished or off-grid time returns a `ServiceExceptionReport`, not a blank tile — loud,
 * but still worth not triggering.
 */
export const RADAR_LAG_MINUTES = 15

/** Milliseconds per frame. `raster-opacity` transitions by default, so the step crossfades. */
export const RADAR_FRAME_MS = 500

const MINUTE_MS = 60_000

/**
 * How often the radar frame set — and the static `time` baked into lightning/cells (below) — gets
 * recomputed while on screen. Matches `RADAR_STEP_MINUTES`: the grid itself only advances every
 * 5 minutes, so refreshing faster buys nothing and refreshing slower risks a frame ageing past the
 * extent between refreshes.
 */
export const RADAR_REFRESH_MS = RADAR_STEP_MINUTES * MINUTE_MS

/** Floored to the `PT5M` grid, lagged by `RADAR_LAG_MINUTES` — the anchor every DWD RV request in
 * this app is built from, radar's first frame included. */
function dwdGridAnchorMs(now: Date): number {
  const step = RADAR_STEP_MINUTES * MINUTE_MS
  return Math.floor((now.getTime() - RADAR_LAG_MINUTES * MINUTE_MS) / step) * step
}

/**
 * The frame timestamps, oldest first, in the exact format the WMS advertises:
 * `2026-08-18T10:45:00.000Z`. `toISOString()` emits precisely that — milliseconds and a literal
 * `Z` — and DWD's `time` extent is a `PT5M` grid, so the anchor is floored to the 5-minute grid
 * in UTC. A timestamp off the grid is rejected with a service exception rather than served empty.
 */
export function radarFrameTimes(now: Date): string[] {
  const step = RADAR_STEP_MINUTES * MINUTE_MS
  const anchor = dwdGridAnchorMs(now)
  return Array.from({ length: RADAR_FRAME_COUNT }, (_, index) =>
    new Date(anchor + index * step).toISOString(),
  )
}

/**
 * The single newest grid slot `lightning`/`cells` are allowed to ask for. Same anchor math as
 * radar's first frame, which matters here specifically because these two layers carry NO nowcast
 * of their own (fact 3 in the brief this shipped against): asking ahead of this returns a
 * `ServiceExceptionReport`, not a blank tile.
 */
export function staticWeatherTime(now: Date): string {
  return new Date(dwdGridAnchorMs(now)).toISOString()
}

export type WeatherLayer = {
  id: WeatherLayerId
  label: string
  /** What the layer actually shows. In six months this is the only thing that will still help. */
  description: string
  /** WMS host + layer name — everything `wmsTileUrl` needs. */
  host: string
  wmsLayer: string
  defaultOpacity: number
  attribution: string
  /**
   * Where the layer sits in the raster stack, low number = further down — on the SAME scale as
   * `BASE_STACK_INDEX` and `LP_STACK_INDEX`, so a value below the ramp's really does render under
   * the atlas. This is NOT the order the drawer lists them in: the cloud mask is a full-disc wash
   * and belongs under everything, while lightning and storm cells are sparse annotations that are
   * worthless buried. Ordering the stack by usefulness and listing the rows by familiarity are two
   * different jobs.
   */
  stackIndex: number
  /** True only for RV — it is the one layer with a time dimension worth animating. */
  animated?: boolean
  /**
   * True for the three DWD layers (`legendUrl` only knows the DWD `GetLegendGraphic` shape).
   * EUMETSAT's cloud mask is a different host with its own legend contract and is out of scope —
   * omitted rather than false, so a future non-DWD layer can't accidentally opt in by inheriting
   * a default.
   */
  legend?: boolean
  /** What an empty render means, in the user's words. Shown next to the layer's legend. */
  emptyMeans: string
  /** Where the product has data at all — the layer ends here with no visual cue of its own. */
  coverage: string
}

export const WEATHER_LAYERS: readonly WeatherLayer[] = [
  {
    id: 'radar',
    label: 'Radar (animated)',
    description:
      'DWD RV precipitation composite, 1 km. Loops the last 15 minutes of observation and 40 minutes of nowcast, so you can see which way a band is moving and whether it clears before you arrive.',
    host: DWD_WMS,
    wmsLayer: 'dwd:Radar_rv_product_1x1km_ger',
    defaultOpacity: 0.75,
    attribution: DWD_ATTRIBUTION,
    stackIndex: 20,
    animated: true,
    legend: true,
    emptyMeans: 'Blank means no precipitation in range.',
    coverage: 'Germany and immediate neighbours',
  },
  {
    id: 'lightning',
    label: 'Lightning density',
    description:
      'DWD Blitzdichte (NowCastMIX) — where strikes have actually been detected. Legitimately blank on a quiet night; that is data, not a broken layer.',
    host: DWD_WMS,
    wmsLayer: 'dwd:Blitzdichte',
    defaultOpacity: 0.9,
    attribution: DWD_ATTRIBUTION,
    stackIndex: 40,
    legend: true,
    emptyMeans: 'Blank means no strikes detected — normal on a quiet night.',
    coverage: 'Germany and immediate neighbours',
  },
  {
    id: 'cells',
    label: 'Storm cells',
    description:
      'DWD Gewitterzellen — the outlines of thunderstorm cells the nowcast is TRACKING, with their tracks. Lightning says where it struck; this says where the cell is going.',
    host: DWD_WMS,
    wmsLayer: 'dwd:Gewitterzellen',
    defaultOpacity: 0.9,
    attribution: DWD_ATTRIBUTION,
    stackIndex: 30,
    legend: true,
    emptyMeans: 'Blank means the nowcast is tracking no cells.',
    coverage: 'Germany and immediate neighbours',
  },
  {
    id: 'cloudmask',
    label: 'Cloud mask',
    description:
      'EUMETSAT MSG cloud mask, refreshed every 15 minutes across the whole European disc. Radar only sees rain — this is the layer that answers "is there cloud at all", which is the question a clear night turns on.',
    host: EUMETSAT_WMS,
    wmsLayer: 'msg_fes:clm',
    defaultOpacity: 0.45,
    attribution: EUMETSAT_ATTRIBUTION,
    stackIndex: 10,
    emptyMeans: 'Covers the whole European disc; it is never blank.',
    coverage: 'Full European disc',
  },
]

const WEATHER_BY_ID = new Map(WEATHER_LAYERS.map((entry) => [entry.id, entry]))

// ── Selection state, and its URL encoding ──────────────────────────────────

export type WeatherSelection = { id: WeatherLayerId; opacity: number }

/** The whole map configuration, decoded from the route's search params. */
export type MapLayerState = {
  base: BaseLayerId
  /** `null` = the ramp is off. */
  lpYear: LpYear | null
  /** The ramp's own opacity — carried even while the ramp is off, the same "remembers the last
   * value" shape `hillshadeExaggeration` already uses, so re-enabling it inside the same session
   * keeps the last setting; a fresh URL always starts it back at `LP_OPACITY_DEFAULT`. */
  lpOpacity: number
  /** `color-relief-color`'s resampling mode — see `LpResampling`. Carried the same way as
   * `lpOpacity` above. */
  lpResampling: LpResampling
  /** Active overlays, already in stack order (bottom first). */
  weather: readonly WeatherSelection[]
  /** Hillshade and 3D terrain — two independent toggles over the same DEM source. */
  terrain: TerrainSelection
}

/**
 * The one cross-field rule the map has, applied where the state is DECODED rather than only where
 * the drawer writes it.
 *
 * Any raster base and the pollution ramp are mutually exclusive. Satellite imagery started this
 * rule (ASTRO-MAP-RESEARCH §6.2 measured it: both are green and brown, and the pair is unreadable)
 * and OpenTopoMap extends it for the same underlying reason — it is already a busy, warm,
 * multi-colour raster with its own hypsometric tint, and stacking the ramp on top fights it rather
 * than reading. The predicate is therefore "base is not a vector style" rather than "base is
 * imagery": every raster base (`imagery` or `raster-style`) earns the same exclusion, so a future
 * third raster base inherits it for free. Enforcing this in the drawer's handlers alone left it
 * reachable from every other entry point — `?base=eox-s2cloudless` with no `lp` at all is enough,
 * because the `lp` param defaults to the latest vintage rather than to off. A shared or
 * hand-trimmed link would then mount exactly the combination the drawer's own copy calls
 * unreadable, with no control state saying so.
 */
export function normaliseLayerState(state: MapLayerState): MapLayerState {
  if (state.lpYear === null) return state
  return baseLayer(state.base).kind !== 'style' ? { ...state, lpYear: null } : state
}

/**
 * The active overlay set as ONE compact search param: `radar.cloudmask:30` — ids joined by `.`,
 * each optionally carrying `:<percent>` when its opacity differs from the catalogue default.
 * Four booleans and four floats would otherwise be eight query keys for one control panel.
 *
 * Unknown ids and malformed opacities are DROPPED rather than rejected: a hand-edited or stale
 * URL should open a slightly different map, not a route error on a page whose whole job is to be
 * linkable.
 */
export function parseWeatherParam(raw: string | undefined): WeatherSelection[] {
  if (raw === undefined || raw === '') return []
  const seen = new Set<WeatherLayerId>()
  const parsed: WeatherSelection[] = []
  for (const token of raw.split('.')) {
    const [rawId, rawOpacity] = token.split(':')
    const entry = rawId === undefined ? undefined : WEATHER_BY_ID.get(rawId as WeatherLayerId)
    if (entry === undefined || seen.has(entry.id)) continue
    seen.add(entry.id)
    parsed.push({ id: entry.id, opacity: parseOpacity(rawOpacity) ?? entry.defaultOpacity })
  }
  return parsed.toSorted((a, b) => stackIndexOf(a.id) - stackIndexOf(b.id))
}

function stackIndexOf(id: WeatherLayerId): number {
  return WEATHER_BY_ID.get(id)?.stackIndex ?? 0
}

/** Inverse of `parseWeatherParam`. Returns `undefined` for an empty set so the key leaves the URL. */
export function formatWeatherParam(selection: readonly WeatherSelection[]): string | undefined {
  if (selection.length === 0) return undefined
  return selection
    .map(({ id, opacity }) => {
      const entry = WEATHER_BY_ID.get(id)
      const percent = Math.round(opacity * 100)
      return entry !== undefined && Math.round(entry.defaultOpacity * 100) === percent
        ? id
        : `${id}:${percent}`
    })
    .join('.')
}

export function weatherLayer(id: WeatherLayerId): WeatherLayer | undefined {
  return WEATHER_BY_ID.get(id)
}

/**
 * `lightning` and `cells` carry no nowcast of their own (fact 3) — unlike `radar`'s twelve
 * animated frames, they get exactly one baked `time`, refreshed on the same clock. `cloudmask`
 * keeps asking with no `time` at all, so it is not in this set.
 */
const STATIC_TIME_IDS: ReadonlySet<WeatherLayerId> = new Set(['lightning', 'cells'])

export function needsStaticTime(id: WeatherLayerId): boolean {
  return STATIC_TIME_IDS.has(id)
}

// ── Terrain (independent toggles) ───────────────────────────────────────────

/**
 * The same keyless AWS bucket `apps/api/src/clients/terrarium-dem.ts` reads for the server-side
 * horizon march — one DEM, one encoding, read by both the raymarch and the map's hillshade / 3D
 * terrain. `raster-dem` + `encoding: 'terrarium'` is MapLibre's own decode of the identical RGB
 * triple `terrariumElevation` unpacks server-side. Verified against the installed `maplibre-gl`
 * 6.3.0 `.d.ts`, not from memory: `DEMEncoding` is `"mapbox" | "terrarium" | "custom"`.
 */
export const TERRAIN_DEM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

/** Matches the source label `apps/api/src/clients/terrarium-dem.ts` already hands back. */
export const TERRAIN_ATTRIBUTION = 'Terrarium DEM (SRTM/NED blend), AWS elevation-tiles-prod'

/**
 * How high 3D terrain stands the relief up. 1 is true-to-scale and reads nearly flat at map
 * pitch on the pre-alpine plain this app centres on; this is a legibility multiplier, not a
 * measurement, chosen to make a 500 m ridge readable without caricaturing the Alps into spikes.
 */
export const TERRAIN_3D_EXAGGERATION = 1.4

/**
 * `hillshade-exaggeration`'s own default (MapLibre's, and ours) — `[0, 1]`, unrelated to
 * `TERRAIN_3D_EXAGGERATION` above (that one stands the RELIEF up in 3D; this one only controls
 * how strongly the flat-shaded hillshade paint reads). User-controllable in the drawer.
 */
export const HILLSHADE_EXAGGERATION_DEFAULT = 0.5

/**
 * Elevation-line ladder for pre-alpine and alpine hiking, `[minor, major]` metres per zoom — a
 * zoom without an entry inherits the next lower zoom's (`maplibre-contour`'s own rule). Tuned
 * looser at the low zooms (a whole pre-alpine region on screen wants 200 m/1000 m, not a solid
 * black mass of lines) and tighter from z13 up, where a hiker is reading individual slopes.
 */
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
  9: [200, 1000],
  10: [100, 500],
  11: [100, 500],
  12: [50, 250],
  13: [20, 100],
  14: [10, 50],
  15: [10, 50],
}

/**
 * The vector tile layer name and property keys `map-overlays.ts` requests from `maplibre-contour`
 * — set explicitly rather than relying on the package's own defaults (which the shipped `.d.ts`
 * does not encode as literal values, only as optional fields), so a future package upgrade cannot
 * silently rename the properties the line/label layers filter and label on.
 */
export const CONTOUR_LAYER_NAME = 'contours'
export const CONTOUR_ELEVATION_KEY = 'ele'
export const CONTOUR_LEVEL_KEY = 'level'

/**
 * OpenFreeMap's public glyph endpoint — probed 2026-08-19: HTTP 200, `application/x-protobuf`, for
 * `Noto Sans Regular`. Needed because the contour LABEL layer is a `symbol` layer, and a symbol
 * layer needs a `glyphs` entry in the style it renders into. Every `kind: 'style'` base (and the
 * scheme-default vector style an `imagery` base mounts over) already ships its own `glyphs` key —
 * OpenTopoMap's inline `raster-style` in `site-map.tsx` is the one base with no vector style
 * underneath it, so that is the one place this constant gets wired in.
 *
 * `Noto Sans Regular` only — NOT JetBrains Mono. DESIGN.md's "every numeral in mono" rule is a
 * deliberate exception here: this endpoint's available fontstacks were not verified beyond Noto
 * Sans, and shipping a font family this glyph host does not serve fails silently (missing glyphs,
 * not a build error) rather than loudly.
 */
export const CONTOUR_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
export const CONTOUR_LABEL_FONT = 'Noto Sans Regular'

/**
 * Waymarked Trails' hiking overlay — an independent toggle, not a `WeatherLayer` (it is not
 * "weather now") and not a `BaseLayer` (it draws paths over whichever base is picked, it is not
 * the base). It lives in `TerrainSelection` and the drawer's Terrain section because it answers
 * the same question terrain does — "can I get there" — not "what is the sky doing".
 *
 * `tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png` (probed 2026-08-18: z12 → 200, 4314 B,
 * image/png) ships transparent overlay-only tiles designed to sit on top of a base map — no API
 * key, no registration. Tiles CC-BY-SA 3.0, project source GPL v3. **No written usage policy**:
 * both `https://hiking.waymarkedtrails.org/en/help/legal` and
 * `https://waymarkedtrails.org/en/help/legal` return 404 (checked the same day) — a good-faith
 * free service with no published request cap, not a checked-and-generous one, so usage should
 * stay as light as the DWD/EUMETSAT layers above.
 */
export const TRAILS_TILES: readonly string[] = [
  'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
]
export const TRAILS_ATTRIBUTION =
  '<a href="https://waymarkedtrails.org" target="_blank">© waymarkedtrails.org</a>, OpenStreetMap contributors (CC-BY-SA)'
export const TRAILS_LABEL = 'Hiking trails'
export const TRAILS_DESCRIPTION =
  "Waymarked Trails' marked hiking network, laid transparent over whichever base is picked — the paths that answer whether you can actually walk to a dark-sky spot."
export const TRAILS_DEFAULT_OPACITY = 0.85

export type TerrainSelection = {
  /** The flat-shaded relief layer — always legible, cheap to render. */
  hillshade: boolean
  /**
   * `hillshade-exaggeration`, `[0, 1]`. Carried even while `hillshade` is off (mirrors `trails`
   * keeping its opacity around while off) so re-enabling it inside the same session remembers the
   * last value; a fresh URL always starts it back at `HILLSHADE_EXAGGERATION_DEFAULT`.
   */
  hillshadeExaggeration: number
  /** Real 3D terrain via `map.setTerrain` — off by default, a heavier render than hillshade alone. */
  extruded: boolean
  /**
   * The trails overlay's opacity, or `null` when off. Grouped here (not in `weather`) because the
   * drawer's Terrain section is where "can I get there" lives, even though on the map it renders
   * as its own raster source, not a DEM derivative — see `TRAILS_STACK_INDEX`.
   */
  trails: number | null
  /** Contour lines generated from the same shared DEM — see `CONTOUR_THRESHOLDS`. */
  contours: boolean
}

export const TERRAIN_OFF: TerrainSelection = {
  hillshade: false,
  hillshadeExaggeration: HILLSHADE_EXAGGERATION_DEFAULT,
  extruded: false,
  trails: null,
  contours: false,
}

/**
 * One compact `terrain` search param, same convention as `wx`: `.`-joined tokens. `3d` and
 * `contours` are bare booleans; `hillshade` and `trails` each carry an optional `:<percent>`
 * suffix — the same `id[:opacity]` shape `wx` already uses, since `hillshade-exaggeration` and
 * the trails overlay are the two terrain toggles with a slider.
 */
export function parseTerrainParam(raw: string | undefined): TerrainSelection {
  if (raw === undefined || raw === '') return TERRAIN_OFF
  let hillshade = false
  let hillshadeExaggeration = HILLSHADE_EXAGGERATION_DEFAULT
  let extruded = false
  let trails: number | null = null
  let contours = false
  for (const token of raw.split('.')) {
    if (token === '3d') {
      extruded = true
      continue
    }
    if (token === 'contours') {
      contours = true
      continue
    }
    const [id, rawSuffix] = token.split(':')
    if (id === 'hillshade') {
      hillshade = true
      hillshadeExaggeration = parseOpacity(rawSuffix) ?? HILLSHADE_EXAGGERATION_DEFAULT
      continue
    }
    if (id === 'trails') trails = parseOpacity(rawSuffix) ?? TRAILS_DEFAULT_OPACITY
  }
  return { hillshade, hillshadeExaggeration, extruded, trails, contours }
}

/** Inverse of `parseTerrainParam`. Returns `undefined` for all-off so the key leaves the URL. */
export function formatTerrainParam(selection: TerrainSelection): string | undefined {
  const tokens: string[] = []
  if (selection.hillshade) {
    const percent = Math.round(selection.hillshadeExaggeration * 100)
    tokens.push(
      Math.round(HILLSHADE_EXAGGERATION_DEFAULT * 100) === percent
        ? 'hillshade'
        : `hillshade:${percent}`,
    )
  }
  if (selection.extruded) tokens.push('3d')
  if (selection.contours) tokens.push('contours')
  if (selection.trails !== null) {
    const percent = Math.round(selection.trails * 100)
    tokens.push(
      Math.round(TRAILS_DEFAULT_OPACITY * 100) === percent ? 'trails' : `trails:${percent}`,
    )
  }
  return tokens.length === 0 ? undefined : tokens.join('.')
}
