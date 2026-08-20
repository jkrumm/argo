import { apiBase } from '../../lib/api-base'
import { LP, SERIES } from '../../lib/series'

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
 * - **Core-direction glow rose, drive-time isochrones** — real features, but they need API
 *   surface that does not exist yet (`/astro/skyglow` returns a rose but nothing renders it as a
 *   map layer) and are out of scope here. Terrain (hillshade + optional 3D) shipped below.
 *
 * RainViewer's OWN nowcast/satellite products (as opposed to its RADAR mosaic, which the `radar`
 * row below is now built on) were discontinued 2026-01-01 — verified: `weather-maps.json`'s
 * `radar.nowcast` and `satellite.infrared` are both permanently empty arrays. Nothing here reads
 * either.
 *
 * Every DWD product was Germany-or-neighbours-only — deliberate for the earlier build, wrong for
 * an owner who hikes in Spain, Morocco, Senegal, South America and the US. Checked 2026-08-19 for
 * a global replacement of each regional layer:
 *
 * - **`radar-de`** (DWD RV precipitation composite) and **`cells`** (DWD Gewitterzellen) were
 *   DELETED outright, not replaced — RainViewer's `radar` row above already covers 1200+ radars
 *   across 150+ countries including Germany, and no free global storm-cell-tracking product
 *   exists to take `cells`' place. Keeping either as a Germany-only extra was exactly the
 *   "fuck the rest of the world" default this pass exists to remove.
 * - **A globally-covered free lightning tile source still does not exist.** `lightning` moved off
 *   DWD onto EUMETSAT's MTG-I Lightning Imager (`mtg_fd:li_afa`, re-probed 2026-08-19) the same
 *   day this line was corrected — a hemispheric MTG-I disc (±70°) at PT5M instead of Germany
 *   alone, which is real reach, but a DISC IS NOT THE GLOBE: the Americas, the Pacific and eastern
 *   Asia still have no free lightning source, and the four findings that established that still
 *   stand — NASA GIBS serves GLM only as netCDF from the GHRC DAAC, not as WMTS tiles; Open-Meteo
 *   has no lightning tile variable at all; MET Norway discontinued its lightning products in 2019;
 *   Tomorrow.io gates lightning behind an Enterprise plan. Its `coverage` string says so plainly
 *   rather than implying otherwise.
 * - **`@openmeteo/weather-map-layer`** serves exactly the right products (global cloud cover
 *   total/low/mid/high, cloud top height) but was rejected on inspection: version `0.0.20` ships
 *   no `license` field in its `package.json`, and it depends on `maplibre-gl: ^5.20.1` against
 *   this app's v6 — installing it would pull a second, incompatible copy of MapLibre into the
 *   bundle. `bunx basalt-ui check-theme`'s dependency hygiene is not the blocker here; the
 *   license gap and the duplicate-MapLibre cost are. Cloud-top height specifically is now served
 *   natively instead, via EUMETSAT's own `msg_fes:cth`/`msg_iodc:cth` (`cloud-top` below) — one
 *   more reason this package was never worth the duplicate-MapLibre cost.
 * - **MET Norway's `cloud-area-fraction`** is genuinely global (59 hourly steps to +2.5 days),
 *   CORS-open and CC BY 4.0 — the licensing and coverage are both fine. Rejected anyway: its
 *   tiles are a DATA ENCODING with no published decode (unlike EUMETSAT's cloud mask, whose red
 *   channel this file now decodes explicitly), so there is no documented way to turn its pixels
 *   into a number this app could paint honestly.
 *
 * The remaining five rows all have a genuinely global (or global-ish) path. RainViewer's radar
 * mosaic (`radar`) and the EUMETSAT cloud mask (`cloud`, already both discs) were already this
 * shape. `cloud-top` was widened 2026-08-19: it now reads BOTH EUMETSAT MSG discs (0°, 45.5°E)
 * instead of one.
 *
 * **EUMETSAT's own IR channel was tried and dropped as `cloud-ir`'s global complement, same day.**
 * `msg_fes:ir108`/`msg_iodc:ir108`'s greyscale is compressed into roughly 31–108 of the available
 * 0–255 — cloud and clear barely separate (measured per-channel means: 56.3 over cloudy pixels vs
 * 52.8 over clear land, fully overlapping ranges), and three candidate decode ramps rendered side
 * by side against `msg_fes:clm` as ground truth all produced either a faint smear or a uniform
 * bright wash, none reproducing the mask's structure. There is no ramp that fixes it — the
 * information is not in the product, so `cloud-ir` stays the plain NASA GIBS trio it always was.
 * **GIBS is deliberately NOT decoded, either.** `GOES-East/West_ABI_Band13_Clean_Infrared` and
 * `Himawari_AHI_Band13_Clean_Infrared` are not plain greyscale — they carry a colour enhancement
 * for cold convective tops (storms render red/yellow/green over a grey field), and running that
 * through `color-relief` at either candidate ramp collapsed it to a flat pale wash with the storm
 * enhancement gone entirely. Rendered raw at `raster-opacity: 0.6` it is the best cloud picture in
 * the whole catalogue, basemap still legible underneath — so `cloud-ir` mounts its three GIBS
 * sources as plain RGBA rasters, undecoded, same as before this was tried.
 *
 * No SINGLE cloud layer here is global — `cloud`/`cloud-top` cover the two EUMETSAT discs' fixed
 * footprint, `cloud-ir` covers the Americas, the Pacific and eastern Asia (GOES-East/West plus
 * Himawari). Together, mask/top over the Meteosat discs and infrared over the rest, they reach
 * effectively the whole globe — that honest three-layer framing is the map's actual answer to
 * "is there a cloud layer for here", not any one row in isolation.
 */

// ── Ids ────────────────────────────────────────────────────────────────────

export type BaseLayerId =
  | 'ofm-fiord'
  | 'ofm-positron'
  | 'ofm-dark'
  | 'versatiles-eclipse'
  | 'eox-s2cloudless'
  | 'otm'

/**
 * Ids ride in a URL search param, so they carry no `.` — that is the delimiter.
 *
 * Five rows, all global or global-ish — `radar-de` (DWD RV precipitation) and `cells` (DWD
 * Gewitterzellen) were DELETED 2026-08-19, both Germany-only with no free global equivalent (see
 * the module docstring). `cloudmask` was renamed `cloud` when it moved from an opaque raster wash
 * to a decoded, transparent `color-relief` layer (see `CLOUD_RAMP`); `cloud-ir` is the global-ish
 * infrared complement, NASA GIBS' GOES-East/West + Himawari trio, plain undecoded rasters — see
 * the module docstring for why a EUMETSAT IR half and a decoded GIBS paint were both tried and
 * dropped 2026-08-19. `lightning` kept its id but moved providers 2026-08-19 — DWD Blitzdichte
 * (Germany only) to EUMETSAT's MTG-I Lightning Imager (the whole Meteosat disc) — so existing
 * shared URLs keep resolving to the same toggle. `cloud-top` is EUMETSAT cloud-top height, the
 * MSG discs' answer to "how high", not just "is there any" — widened to both discs 2026-08-19.
 */
export type WeatherLayerId = 'radar' | 'lightning' | 'cloud' | 'cloud-ir' | 'cloud-top'

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
 * The cloud layer used to be why the ramp had to be ON this shared scale rather than hardcoded
 * under the weather group: EUMETSAT's `msg_fes:clm` is an OPAQUE RGB PNG (colour type 2, no alpha
 * channel, no `tRNS`) with every pixel inside the product footprint painted — white for cloud,
 * green for clear land, blue for clear sea — so mounted as a plain raster it was a 45 % sheet
 * across the whole viewport, and stacking it above the ramp erased the blue-is-dark-sky reading
 * this page exists for. That reasoning is now OBSOLETE: `cloud` decodes the same red channel
 * through a `raster-dem` + `color-relief` pair (`CLOUD_RAMP`) whose own stops are transparent for
 * clear sky, so the layer no longer needs to sit under anything to stay legible — it is honestly
 * transparent now, the same way the pollution ramp itself has always been. It sits at 20, ABOVE
 * the ramp, alongside the rest of the weather-now group: cloud cover is exactly the kind of
 * annotation the other rows already are (a live reading over the pollution context, not a wash
 * under it), and grouping it with `cloud-ir` (22, its infrared complement for the hemisphere the
 * EUMETSAT discs miss) keeps "is there cloud at all" as one visual cluster. `cloud-top` sits at
 * 24, above both: it is the sparsest of the three (EUMETSAT's `msg_fes:cth` paints only where
 * there IS cloud, transparent everywhere else — a probed tile ran 3 061 B, almost entirely
 * transparent) and it is the one that answers "how high", the one distinction the binary mask
 * cannot make — burying it under either wash would waste the one row that answers a question
 * neither of the other two can. Radar (30, global) and lightning (50) stay above both —
 * increasingly urgent, sparse annotations that a city-dome-height cloud wash would make worthless
 * to bury under.
 *
 * Hillshade sits ABOVE the pollution ramp, and this is a CORRECTION (2026-08-20) of the rule that
 * used to live here. The old rule put it between the base and everything else, reasoning that
 * relief is CONTEXT for reading the ramp (which ridge blocks which valley), not an answer of its
 * own, so it belonged under the ramp and under the weather group too — "the ramp is the answer
 * and the hillshade is context". The conclusion did not survive being rendered: the ramp is a
 * near-opaque colour field (`LP_RAMP`, alpha .56–.74 at EVERY stop since the flat-alpha
 * correction), so a relief drawn
 * UNDER it is erased everywhere the ramp paints — which is everywhere. Toggling hillshade with the
 * ramp on changed nothing on screen, and the map lost the one thing a scouting trip is planned
 * from. Above the ramp it reads exactly like the cartographic pairing it always was: a
 * hypsometric tint carrying the value, shaded relief on top carrying the form. Verified side by
 * side in `docs/poc/astro-map/hillshade-context.html` — same tiles, same paint, only the order
 * changed. `igor` at 0.7 stays the default; `standard` reads slightly flatter over the ramp and
 * `multidirectional` crushes it to black (`.cache/hillshade-method.png` in that POC).
 *
 * Contours follow the hillshade above the ramp for the same reason, one step higher so the stable
 * sort never has to break a tie between two conceptually different terrain layers.
 *
 * The Waymarked Trails hiking overlay sits above the ramp for the opposite reason: a trail is an
 * ANSWER ("can I walk there"), not context, so burying it under a city dome would make it
 * pointless. It still sits below the weather annotations, because a storm cell or lightning
 * strike is more urgent than the path it may be closing.
 */
export const BASE_STACK_INDEX = 0
export const LP_STACK_INDEX = 15

/**
 * The shaded relief, ABOVE the ramp — see the "Stack order" section above for why that is a
 * correction rather than the original arrangement. Still below the trails (18) and the weather
 * group (20+): relief is the form of the ground, a trail or a storm cell is an answer about it.
 */
export const TERRAIN_STACK_INDEX = 16

/**
 * The contour lines — terrain context, the same argument `TERRAIN_STACK_INDEX`'s comment already
 * makes for the hillshade, not an answer of its own. One step above the hillshade (16) and below
 * the trails (18): a deliberate gap of its own rather than sharing the hillshade's index, so the
 * stable sort never has to break a tie between two conceptually different terrain layers.
 */
export const CONTOUR_STACK_INDEX = 17

/**
 * The Waymarked Trails hiking overlay. Above the ramp — a path buried under a 90 % alpha city-dome
 * stop is worthless — but below the weather group (`cloud` starts it at 20), so a storm cell or
 * lightning strike still reads over the trail network it might rain out.
 */
export const TRAILS_STACK_INDEX = 18

// ── WMS plumbing ───────────────────────────────────────────────────────────

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
 * `GetLegendGraphic` for a WMS layer — a plain PNG, no bbox/tile plumbing needed. `GetLegendGraphic`
 * is a generic GeoServer request, not a DWD-specific one — confirmed working against EUMETSAT's own
 * GeoServer too when `cloud-top` and the replacement `lightning` row were added 2026-08-19, so this
 * same builder covers both hosts unchanged (DWD's own rows, `radar-de`/`cells`, were deleted
 * 2026-08-19 — see the module docstring — so only the EUMETSAT host reaches this now). Takes the
 * bare `{host, wmsLayer}` pair rather than a whole catalogue row so a `'wms-multi'` row (two
 * discs, one shared legend) can hand it its first disc without a type that claims a single host.
 * Callers must still not call this for a `WeatherLayer` with `legend` unset — the guard exists for
 * a future host that does not run GeoServer at all.
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
export function legendUrl(source: { host: string; wmsLayer: string }, fontColor: string): string {
  const query = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetLegendGraphic',
    format: 'image/png',
    layer: source.wmsLayer,
    transparent: 'true',
    LEGEND_OPTIONS: `fontColor:${fontColor};fontAntiAliasing:true;bgColor:0x000000;fontSize:10;dpi:96`,
  })
  return `${source.host}?${query.toString()}`
}

/** The `{host, wmsLayer}` pair to request a legend for — the first disc for a `'wms-multi'` row
 * (both discs share the same product's legend graphic), the row's own pair for a plain `'wms'`
 * row. */
export function legendSource(entry: LegendableWeatherLayer): { host: string; wmsLayer: string } {
  return entry.source === 'wms'
    ? { host: entry.host, wmsLayer: entry.wmsLayer }
    : { host: entry.hosts[0], wmsLayer: entry.wmsLayers[0] }
}

// ── Attribution ────────────────────────────────────────────────────────────

/**
 * Attribution reaches MapLibre through the SOURCE, never through `customAttribution` — Phase 4
 * measured that passing both prints the credit twice. A `null` here means the provider's own
 * style JSON / TileJSON already carries the string and MapLibre will compose it unaided.
 */
const EUMETSAT_ATTRIBUTION = '<a href="https://www.eumetsat.int" target="_blank">EUMETSAT</a>'

/** NASA's own mandated GIBS credit — shared by the three GIBS satellites in `cloud-ir` below. */
const GIBS_ATTRIBUTION =
  'We acknowledge the use of imagery provided by services from NASA\'s <a href="https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs" target="_blank">Global Imagery Browse Services (GIBS)</a>, part of NASA\'s Earth Science Data and Information System (ESDIS).'

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
      'Cloud-free Sentinel-2 mosaic — what the ground actually looks like: forest, water, the field you would park in.',
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
      'Contour lines, marked hiking paths, hut and peak names — OpenTopoMap\'s own labels baked into the tile. Pick this when the question is "can I walk to this spot in the dark", not "how bright is the sky here".',
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

/** Type guard, not a bare `as` — same shape as `isHillshadeMethod` below, built off the table
 * that already exists (`BASE_LAYER_IDS`) rather than a second hand-written id list. Used by the
 * settings panel's base-map radio handler, which takes a string straight from user interaction. */
export function isBaseLayerId(value: string): value is BaseLayerId {
  return (BASE_LAYER_IDS as readonly string[]).includes(value)
}

/**
 * The scheme's default base — what an untouched URL resolves to.
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
const LP_RESAMPLINGS: readonly LpResampling[] = ['linear', 'nearest']

/** Type guard, not a bare `as` — same shape as `isHillshadeMethod` below. Used by the settings
 * panel's resampling `SegmentedControl`, which also takes a string straight from user
 * interaction. */
export function isLpResampling(value: string): value is LpResampling {
  return (LP_RESAMPLINGS as readonly string[]).includes(value)
}

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
 * the token.
 *
 * **CORRECTED 2026-08-19.** This table used to put the alpha MINIMUM exactly on `lpRural`'s
 * crossing stop (`.12`, rising in both directions away from it) on the theory that a diverging
 * ramp has to fade to its most transparent exactly at the point it diverges around. Rendered
 * against real tiles and shown on screen, that read as "red, then nothing, then blue" — the entire
 * rural plateau this map exists to distinguish (21.2–21.8, right around the crossing) washed out to
 * a barely-visible grey, with no yellow anywhere. The theory was wrong in practice: alpha needs to
 * stay roughly FLAT so hue alone carries the ramp, because a transparent crossing erases exactly
 * the band the map is read for. The ladder below (`.56`–`.74`, rising gently toward both ends
 * rather than dipping) renders a continuous red → orange → gold-across-the-rural-band → blue
 * gradient with every step distinguishable — verified side by side against the old ladder. The
 * corrected ladder is recorded in DESIGN.md under "Light pollution ramp", including what was tried
 * and why it failed.
 */
export const LP_RAMP: ReadonlyArray<{ stop: number; token: string; alpha: number }> = [
  { stop: 1800, token: LP.lpCity, alpha: 0.72 }, // 18.00 — inner city
  { stop: 1960, token: LP.lpUrban, alpha: 0.66 }, // 19.60
  { stop: 2060, token: LP.lpSuburban, alpha: 0.62 }, // 20.60
  { stop: 2095, token: LP.lpSuburban, alpha: 0.58 }, // 20.95 — suburban approaching the crossing
  { stop: 2130, token: LP.lpRural, alpha: 0.56 }, // 21.30 — the neutral crossing
  { stop: 2145, token: LP.lpRural, alpha: 0.56 }, // 21.45 — rural, past the crossing
  { stop: 2155, token: LP.lpDark, alpha: 0.58 }, // 21.55 — the band our sites live in
  { stop: 2170, token: LP.lpDark, alpha: 0.62 }, // 21.70
  { stop: 2180, token: LP.lpDarker, alpha: 0.66 }, // 21.80
  { stop: 2190, token: LP.lpDarker, alpha: 0.7 }, // 21.90
  { stop: 2200, token: LP.lpPristine, alpha: 0.74 }, // 22.00 — natural sky
]

/** The two ends of the ramp, in mpsas × 100 — the legend's axis and the gradient's domain. */
export const LP_RAMP_MIN = LP_RAMP[0]?.stop ?? 0
export const LP_RAMP_MAX = LP_RAMP[LP_RAMP.length - 1]?.stop ?? 0

/** Where the ramp crosses into the cool half — read off the table, not restated as a literal.
 * `lpDark` appears twice in the table now (2155 and 2170); `.find` takes the first, which is the
 * real value this constant has always named — Walchensee's own measured zenith mpsas. */
export const LP_SITE_BAND = LP_RAMP.find((s) => s.token === LP.lpDark)?.stop ?? LP_RAMP_MAX

/**
 * The ramp's SENSITIVITY window — a user-controllable domain the ramp's canonical stops (above)
 * get linearly remapped onto (`buildLpRamp` in `map-overlays.ts`), independent of the ramp's own
 * opacity (`LP_OPACITY_DEFAULT`/`lpOpacity`, the INTENSITY control). `LP_RANGE_FULL` is the
 * un-windowed domain — the same `[LP_RAMP_MIN, LP_RAMP_MAX]` the table has always spanned — and
 * the default; `LP_RANGE_MIN`/`LP_RANGE_MAX`/`LP_RANGE_STEP` bound the drawer's `RangeSlider`
 * slightly past the canonical ends (17.00–22.20) so the window can be pushed narrower than the
 * ramp's own domain on either side, in 0.1 mag steps.
 */
export const LP_RANGE_FULL = [LP_RAMP_MIN, LP_RAMP_MAX] as const satisfies readonly [number, number]
export const LP_RANGE_MIN = 1700
export const LP_RANGE_MAX = 2220
export const LP_RANGE_STEP = 10

/**
 * The narrowest window `parseLpRange` accepts before falling back to `LP_RANGE_FULL` — and the
 * same floor wired as the drawer's `RangeSlider`'s `minRange`, so the control cannot express a
 * window the codec would reject in the first place.
 *
 * Derived, not guessed. `remapStops` maps a canonical stop `s` onto a window `[min, max]` of width
 * `W = max - min` via `round(min + (s - LP_RAMP_MIN) / span * W)`, `span` being the ramp's own
 * fixed 400-unit domain (`LP_RAMP_MAX - LP_RAMP_MIN`). Two canonical stops separated by a gap `g`
 * therefore land `g * W / span` apart BEFORE rounding — and `Math.round` can only keep them
 * strictly ascending (a difference of at least 1 whole unit) once `g * W / span >= 1`, i.e.
 * `W >= span / g`. `LP_RAMP`'s tightest gap is `g = 10` (the cool-end stops — `lpDark`'s pair,
 * `lpDarker`'s pair, `lpPristine`'s neighbour — sit only 10 apart, against 160 at the polluted
 * end), so the SAFE width is `span / g = 400 / 10 = 40`: any window narrower than that can round
 * two of those tightly-clustered stops onto the same integer and break strict ascent.
 * `remapLpRampStops`'s own outcome-checked fallback is kept as a defensive backstop below this
 * floor, but with this constant enforced at both the codec and the slider, that fallback is now
 * UNREACHABLE through the UI — belt and braces, not the primary guard.
 */
export const LP_RANGE_MIN_WIDTH = 40

/**
 * The pure half of `buildLpRamp` (`map-overlays.ts`) — linearly remaps `LP_RAMP`'s canonical
 * stops from `[LP_RAMP_MIN, LP_RAMP_MAX]` onto an arbitrary window, preserving each row's ORDER
 * (never its colour — that half stays in `map-overlays.ts`, which is the only place a CSS
 * variable can be resolved). Split out and DOM-free so the remap's own correctness is directly
 * testable without a browser.
 *
 * The ramp's eleven stops are NOT evenly spaced (`LP_RAMP`'s own doc: 160 apart at the polluted
 * end, 10 apart at the pristine one) — `LP_RANGE_MIN_WIDTH`'s doc derives the exact width below
 * which the tightly-clustered cool-end stops can round onto each other, and both `parseLpRange`
 * and the drawer's `RangeSlider` (`minRange`) now enforce that floor, so a window this function
 * ever sees SHOULD already be wide enough to survive. This outcome-checked fallback stays anyway,
 * as a defensive backstop rather than the primary guard — checking the actual remapped OUTCOME is
 * what makes the guarantee real regardless of whether every caller keeps enforcing the floor:
 * `remapStops(LP_RANGE_FULL)` reconstructs the canonical stops exactly (min/max resolve to
 * identity), which is already proven strictly ascending, so it is always a safe fallback.
 */
export function remapLpRampStops(range: readonly [number, number]): readonly number[] {
  const remapped = remapStops(range)
  return isStrictlyAscending(remapped) ? remapped : remapStops(LP_RANGE_FULL)
}

function remapStops([min, max]: readonly [number, number]): number[] {
  const span = LP_RAMP_MAX - LP_RAMP_MIN
  return LP_RAMP.map(({ stop }) => Math.round(min + ((stop - LP_RAMP_MIN) / span) * (max - min)))
}

function isStrictlyAscending(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]!)
}

/** The `lp` search param's off value, spelled once. */
export const LP_PARAM_OFF = 'off'

/** The decoded shape of the `lp` search param — the atlas vintage (or off), the ramp's own
 * opacity, its resampling mode, and the sensitivity window it is remapped onto. `null` year and
 * every field at its catalogue default is what an untouched `?lp=off` decodes to. */
export type LpSelection = {
  year: LpYear | null
  opacity: number
  resampling: LpResampling
  range: readonly [number, number]
}

/** Malformed, out-of-bound or too-narrow (`< LP_RANGE_MIN_WIDTH` apart — see that constant's doc
 * for the derivation) — every case falls back to `LP_RANGE_FULL` rather than producing a range
 * `buildLpRamp` could hand `interpolate` non-ascending stops for. */
function parseLpRange(raw: string | undefined): readonly [number, number] {
  const match = raw === undefined ? null : /^(\d+)-(\d+)$/.exec(raw)
  if (match === null) return LP_RANGE_FULL
  const min = Number(match[1])
  const max = Number(match[2])
  if (min < LP_RANGE_MIN || max > LP_RANGE_MAX || max - min < LP_RANGE_MIN_WIDTH)
    return LP_RANGE_FULL
  return [min, max]
}

function formatLpRange(range: readonly [number, number]): string {
  return `${range[0]}-${range[1]}`
}

function isLpRangeDefault(range: readonly [number, number]): boolean {
  return range[0] === LP_RANGE_FULL[0] && range[1] === LP_RANGE_FULL[1]
}

/**
 * `lp` search param → the catalogue's light-pollution selection: `off`, or
 * `<year>[:<percent>[:<smooth|sharp>[:<min>-<max>]]]` — the same `id[:opacity]` shape `wx`/
 * `terrain` already use for their overlays, extended with two more optional suffixes. `sharp` is
 * the only non-default resampling token this reads; `smooth` is accepted too (an explicit
 * synonym for `linear`, since the 4th slot — the range — needs the 3rd filled to be reachable at
 * all) and anything else also falls back to `linear`. A malformed or degenerate range is dropped
 * to `LP_RANGE_FULL` rather than rejected — see `parseLpRange`.
 */
export function parseLpParam(raw: string): LpSelection {
  if (raw === LP_PARAM_OFF) {
    return {
      year: null,
      opacity: LP_OPACITY_DEFAULT,
      resampling: LP_RESAMPLING_DEFAULT,
      range: LP_RANGE_FULL,
    }
  }
  const [rawYear, rawPercent, rawResampling, rawRange] = raw.split(':')
  const yearNum = Number(rawYear) as LpYear
  const year = LP_YEARS.includes(yearNum) ? yearNum : DEFAULT_LP_YEAR
  const opacity = parseOpacity(rawPercent) ?? LP_OPACITY_DEFAULT
  const resampling: LpResampling = rawResampling === 'sharp' ? 'nearest' : LP_RESAMPLING_DEFAULT
  const range = parseLpRange(rawRange)
  return { year, opacity, resampling, range }
}

/** Inverse of `parseLpParam`. Drops the percent/resampling/range suffixes when all three already
 * match the catalogue default, the same convention `formatWeatherParam`/`formatTerrainParam`
 * use — and fills an earlier slot with its default token (`smooth`) when a later one needs to be
 * reached, since the codec is positional. */
export function formatLpParam(selection: LpSelection): string {
  if (selection.year === null) return LP_PARAM_OFF
  const percent = Math.round(selection.opacity * 100)
  const opacityDefault = percent === Math.round(LP_OPACITY_DEFAULT * 100)
  const resamplingDefault = selection.resampling === LP_RESAMPLING_DEFAULT
  const rangeDefault = isLpRangeDefault(selection.range)
  if (opacityDefault && resamplingDefault && rangeDefault) return String(selection.year)
  const tokens = [String(selection.year), String(percent)]
  if (!resamplingDefault || !rangeDefault) tokens.push(resamplingDefault ? 'smooth' : 'sharp')
  if (!rangeDefault) tokens.push(formatLpRange(selection.range))
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
 * EUMETSAT's own `PT5M` grid — `lightning`'s static frame rides it via its own `timeGrid` (see
 * `WeatherTimeGrid` below). It used to also drive DWD's `radar-de`/`cells` rows (deleted
 * 2026-08-19 — both Germany-only, see the module docstring) and twelve animated `radar` frames,
 * back when `radar` WAS `dwd:Radar_rv_product_1x1km_ger`; the animated global radar is
 * RainViewer-backed now (see `WeatherLayer.source`), so this grid is purely `lightning`'s request
 * concern today.
 */
export const RADAR_STEP_MINUTES = 5

/** Milliseconds per RainViewer radar frame. `raster-opacity` transitions by default, so the step
 * crossfades. */
export const RADAR_FRAME_MS = 500

const MINUTE_MS = 60_000

/**
 * How often the static `time` baked into every `'wms'`/`'wms-multi'` row's request
 * (`weatherLayerTime`, via its own `timeGrid`), and the GIBS `TIME` baked into `cloud-ir` (below),
 * get recomputed while on screen. Matches `RADAR_STEP_MINUTES`, the FINEST of the grids anchored
 * off it: `lightning`'s EUMETSAT PT5M grid advances every 5 minutes, so refreshing faster buys
 * nothing there — and the coarser grids sharing this same clock (`cloud-top`'s PT15M, GIBS' PT10M)
 * simply recompute the same floored value on most ticks and step to a new bucket on the ticks
 * where their own grid actually moves. The animated `radar` layer needs no clock of its own
 * anymore — its frames refresh on RainViewer's own `refetchInterval` (`lib/queries/rainviewer.ts`),
 * so this app has exactly one refresh CLOCK, even though it now anchors several independent grids
 * off it.
 */
export const RADAR_REFRESH_MS = RADAR_STEP_MINUTES * MINUTE_MS

/** Floored to an arbitrary `stepMinutes` grid, lagged by `lagMinutes` — the pure anchor logic
 * every `'wms'`/`'wms-multi'` row's `timeGrid` builds on via `weatherLayerTime` below. */
function gridAnchorMs(now: Date, stepMinutes: number, lagMinutes: number): number {
  const step = stepMinutes * MINUTE_MS
  return Math.floor((now.getTime() - lagMinutes * MINUTE_MS) / step) * step
}

/**
 * The grid a `'wms'`/`'wms-multi'` row's baked `time` param is floored onto — `stepMinutes` is the
 * host's own publish cadence, `lagMinutes` is how far behind the wall clock a request is allowed
 * to reach before asking for a slot the host has not published yet. That distinction matters
 * because **asking ahead of a host's newest published slot returns a `ServiceExceptionReport`,
 * not a blank tile** — the module docstring's WMS 1.1.1 trap note is the same failure family: a
 * request that looks reasonable fails loudly rather than rendering an empty layer.
 *
 * `lagMinutes` is always the row's MEASURED publish lag plus AT LEAST one full `stepMinutes` of
 * margin, never the bare measurement — a measurement is a snapshot, and the next publish can
 * always land a little later than the one that was probed. Every EUMETSAT-measured lag below was
 * read from the host's own live `GetCapabilities` time extent at wall-clock `2026-08-19T08:30:00Z`
 * (DWD's own `radar-de`/`cells` rows, and `RADAR_LAG_MINUTES`, the constant that used to carry
 * their shared margin, were deleted the same day — see the module docstring):
 *
 * | row | grid | newest published | measured lag | `lagMinutes` |
 * |-|-|-|-|-|
 * | `lightning` (EUMETSAT, `mtg_fd:li_afa`) | PT5M | `08:15:00Z` | 15 min | 25 |
 * | `cloud-top` (EUMETSAT, `msg_fes:cth`/`msg_iodc:cth`) | PT15M | `08:00:00Z` | 30 min | 35 |
 *
 * `lightning` measured 15 min of lag on its PT5M grid; 25 is that plus two full 5-minute steps —
 * reusing a bare 15 min margin (`RADAR_LAG_MINUTES`'s old value) landed a request exactly on the
 * newest published slot with ZERO margin, and one slow publish blanked the layer with no error
 * surfaced. `cloud-top` measured 30 min of lag on its PT15M grid; 35 floors back past one grid
 * boundary (at `now = 08:30` this lands on `07:45`) and is still comfortably inside what the host
 * had published.
 */
export type WeatherTimeGrid = { stepMinutes: number; lagMinutes: number }

/** The `TIME` a `'wms'`/`'wms-multi'` row's request bakes in, floored onto that row's own
 * `timeGrid` — see `WeatherTimeGrid` for the measured lag table and the margin rule behind every
 * value in it. Takes the bare `{timeGrid}` shape structurally, not a specific catalogue variant,
 * since both `WmsWeatherLayer` and `WmsMultiWeatherLayer` carry one. Same millisecond-bearing ISO
 * form every EUMETSAT time extent uses (`gibsTime` below is the one that has to strip them). */
export function weatherLayerTime(entry: { timeGrid: WeatherTimeGrid }, now: Date): string {
  return new Date(
    gridAnchorMs(now, entry.timeGrid.stepMinutes, entry.timeGrid.lagMinutes),
  ).toISOString()
}

// ── RainViewer (global radar) ────────────────────────────────────────────────

/**
 * The pure half of `lib/queries/rainviewer.ts`'s frame resolution — same reason `wmsTileUrl`/
 * `lpTileUrl`/`gibsTileUrl` all live here rather than beside the fetch that calls them: a URL
 * template is DOM-free and worth unit-testing directly, without pulling in `fetch` or `zod`.
 *
 * `host` and `path` come straight off RainViewer's `weather-maps.json` response (`host`, and one
 * `radar.past[].path`) — this app never constructs either itself. `256` is the tile size every
 * WMS host in this catalogue is also asked for (`WMS_TILE_SIZE`); `2` is the Universal Blue colour
 * scheme (the most legible over this app's dark zinc base) and `1_1` is smoothing-on/snow-on.
 * `{z}/{x}/{y}` are left as literal MapLibre placeholders, the same convention every other tile
 * template in this file follows.
 */
export function rainviewerTileUrl(host: string, path: string): string {
  return `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`
}

// ── NASA GIBS (global infrared complement) ──────────────────────────────────

const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

/** `GoogleMapsCompatible_Level6` — MapLibre overzooms past it, which is fine for a cloud field. */
export const GIBS_MAXZOOM = 6

/** GIBS' own time dimension is a `PT10M` grid; observed latency is ~20–40 min, so the anchor is
 * lagged by the safe end of that range before flooring to the grid — the same "never ask ahead of
 * what's published" discipline every `WeatherTimeGrid` lag in the EUMETSAT table above already
 * applies. */
export const GIBS_STEP_MINUTES = 10
export const GIBS_LAG_MINUTES = 40

/**
 * The `{TIME}` GIBS' WMTS wants, floored to its `PT10M` grid and lagged by `GIBS_LAG_MINUTES` —
 * an ISO instant with NO milliseconds (`2026-08-19T07:00:00Z`, the exact form verified serving),
 * unlike `weatherLayerTime`'s DWD/EUMETSAT form which keeps them.
 */
export function gibsTime(now: Date): string {
  const step = GIBS_STEP_MINUTES * MINUTE_MS
  const anchor = Math.floor((now.getTime() - GIBS_LAG_MINUTES * MINUTE_MS) / step) * step
  return new Date(anchor).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * `{TileMatrix}/{TileRow}/{TileCol}` — WMTS order, which is z/y/x. **Note the `{y}/{x}` order**:
 * every other row in this catalogue is a z/x/y template, and getting this one backwards does not
 * error — the tiles load, just in the wrong place.
 */
export function gibsTileUrl(layer: string, time: string): string {
  return `${GIBS_WMTS}/${layer}/default/${time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`
}

/**
 * The cloud mask's decode ramp. `raster-dem` `encoding: 'custom'` decodes `elevation` as
 * `r*redFactor + g*greenFactor + b*blueFactor - baseShift`, but MapLibre's `color-relief` layer
 * then RE-PACKS that same `elevation` back into RGB through the identical factor vector
 * (`pack()`/`getUnpackVector()` in the shipped `maplibre-gl` source) to feed the shader — so a
 * ZERO factor makes the repack degenerate and the whole layer paints one flat saturated stop,
 * regardless of the source pixel. This shipped for a while as `redFactor: 1, greenFactor: 0,
 * blueFactor: 0` (intended to read only the red channel) and was the map's actual blocking bug:
 * a diagnostic ramp rendered the entire cloud mask at its top stop on screen, while the identical
 * source with `redFactor: 1, greenFactor: 1, blueFactor: 1` rendered correct structure matching
 * the raw raster. **No factor in a `raster-dem` source built from a colour image may ever be
 * zero** — the fix in `map-overlays.ts` is `1, 1, 1`, `baseShift: 0`, and this ramp's own domain
 * changed to match: with all three factors at 1, `elevation` is the pixel's channel SUM, not its
 * red channel alone. Measured on a real tile (`msg_fes:clm`'s pixel census): cloud = white
 * `(255,255,255)` → **765**, clear land `(0,192,0)` → **192**, clear sea `(0,0,255)` → **255**.
 *
 * A single binary field earns no hue per DESIGN.md ("ink earns its colour") — `cloudHigh`, the
 * dictionary's existing neutral cloud-severity token, carries every stop here at ascending alpha
 * rather than a newly-minted colour. `0`→`400` both fully transparent — `400` clears BOTH clear
 * classes (192 and 255) while staying below the cloud sum (765), so neither clear-land nor
 * clear-sea pixels paint anything (this is also what off-disc BLACK decodes to, so the disc edge
 * needs no special case). `520` and `765` are the steep rise into cloud, at `0.55`/`0.85` rather
 * than a smooth 1.0 top so the ramp reads as an overlay wash over the ground truth, not a second
 * opaque basemap. Verified rendering correctly with these exact stops.
 */
export const CLOUD_RAMP: ReadonlyArray<{ stop: number; token: string; alpha: number }> = [
  { stop: 0, token: SERIES.cloudHigh, alpha: 0 },
  { stop: 400, token: SERIES.cloudHigh, alpha: 0 },
  { stop: 520, token: SERIES.cloudHigh, alpha: 0.55 },
  { stop: 765, token: SERIES.cloudHigh, alpha: 0.85 },
]

/**
 * A layer's tile plumbing is genuinely different per provider, not a cosmetic difference in field
 * names — this is why `source` is a real discriminant rather than an optional `host`/`wmsLayer`
 * pair every row carries and some ignore. DWD's own `'wms'` rows (`radar-de`, `cells`) were
 * deleted 2026-08-19 (see the module docstring) — every remaining `'wms'`/`'wms-multi'` row is
 * EUMETSAT now:
 *
 * - `'wms'` — a single EUMETSAT `GetMap` layer, built by `wmsTileUrl`. Only `lightning` now.
 * - `'wms-multi'` — the SAME plain-raster `GetMap` shape as `'wms'`, mounted once per disc off
 *   parallel `hosts`/`wmsLayers` arrays (the same "index `i` of one pairs with index `i` of the
 *   other" convention `'cloud-mask'` already uses) sharing one `timeGrid`. `cloud-top` is the one
 *   row here: both MSG discs, no decode, just two independent opaque-PNG raster layers.
 * - `'rainviewer'` — the global radar. Its tile URLs are RUNTIME DATA from
 *   `lib/queries/rainviewer.ts` (RainViewer publishes a new radar mosaic hash every 5 minutes),
 *   not a static template this catalogue could spell out — modelling that honestly here (no
 *   `host`/`wmsLayer` on this branch at all) is what stops a placeholder string from being
 *   smuggled in where real tile data belongs.
 * - `'cloud-mask'` — two EUMETSAT `msg_fes:clm`/`msg_iodc:clm` `raster-dem` sources, each painted
 *   through `CLOUD_RAMP`. `hosts`/`wmsLayers` are parallel arrays (index `i` of one pairs with
 *   index `i` of the other) rather than an array of `{host, layer}` pairs, matching this file's
 *   existing preference for flat arrays over one-off object shapes.
 * - `'gibs-ir'` — three independent NASA GIBS WMTS sources (GOES-East, GOES-West, Himawari),
 *   mounted together as one toggle, plain undecoded RGBA rasters. Deliberately NOT `raster-dem` +
 *   `color-relief`: GIBS' Clean Infrared product carries a colour enhancement for cold convective
 *   tops that `color-relief` discards (see the module docstring for the 2026-08-19 finding) — the
 *   raw tile IS the picture.
 */
/**
 * At least one element. The parallel `hosts`/`wmsLayers` arrays below are a STATIC catalogue, so
 * "this row has a first disc" is a fact the compiler can hold rather than a fallback every reader
 * has to re-check — `legendSource` used to spell that as `?? ''`, which would have built a
 * `GetLegendGraphic` URL with an empty host and failed silently in the network layer instead of
 * loudly at the malformed row.
 */
type NonEmpty<T> = readonly [T, ...T[]]

export type WeatherLayer = {
  id: WeatherLayerId
  label: string
  /** What the layer actually shows. In six months this is the only thing that will still help. */
  description: string
  defaultOpacity: number
  /**
   * Where the layer sits in the raster stack, low number = further down — on the SAME scale as
   * `BASE_STACK_INDEX` and `LP_STACK_INDEX`. See the module's "Stack order" section for the
   * current derivation (cloud/cloud-ir/cloud-top just above the ramp, then radar, then lightning
   * on top as the most urgent, sparse annotation). This is NOT the order the drawer lists them in
   * — ordering the stack by usefulness and listing the rows by familiarity are two different jobs.
   */
  stackIndex: number
  /**
   * True for the two GeoServer-shaped layers — `lightning` (`'wms'`) and `cloud-top`
   * (`'wms-multi'`, legend requested off its first disc — see `legendSource`). `legendUrl`'s
   * `GetLegendGraphic` request is a generic GeoServer operation, so both satisfy the same shape —
   * omitted, never `false`, so a future layer whose host does not run GeoServer can't accidentally
   * opt in by inheriting a default. `radar`, `cloud` and `cloud-ir` are explicitly `false`: none
   * of the three has a `GetLegendGraphic`-shaped legend, so each carries a plain `emptyMeans` line
   * instead — "I turned it on and nothing appeared" still needs an answer without one.
   */
  legend?: boolean
  /** What an empty render means, in the user's words. Shown next to the layer's legend (or in its
   * place, for the three layers with `legend: false`). */
  emptyMeans: string
  /** Where the product has data at all — the layer ends here with no visual cue of its own. */
  coverage: string
} & (
  | {
      source: 'wms'
      host: string
      wmsLayer: string
      attribution: string
      /** Required, not optional — every `'wms'`/`'wms-multi'` row bakes a `time` param
       * (`weatherLayerTime`), so a new row cannot forget to state its own measured grid. See
       * `WeatherTimeGrid` for the lag table and the margin rule every value here has to satisfy. */
      timeGrid: WeatherTimeGrid
    }
  | {
      source: 'wms-multi'
      hosts: NonEmpty<string>
      wmsLayers: NonEmpty<string>
      attribution: string
      timeGrid: WeatherTimeGrid
    }
  | { source: 'rainviewer'; attribution: string }
  | {
      source: 'cloud-mask'
      hosts: NonEmpty<string>
      wmsLayers: NonEmpty<string>
      attribution: string
    }
  | { source: 'gibs-ir'; gibsLayers: NonEmpty<string>; attribution: string }
)

/** The narrowed shape every plain GeoServer-`'wms'` call site actually needs. */
export type WmsWeatherLayer = Extract<WeatherLayer, { source: 'wms' }>

/** The two-disc sibling of `WmsWeatherLayer` — `cloud-top`, the only `'wms-multi'` row. */
export type WmsMultiWeatherLayer = Extract<WeatherLayer, { source: 'wms-multi' }>

/** Either GeoServer shape — the union `legendSource`/`WeatherLegends` (`site-map.tsx`) actually
 * render off, since a legend card does not care whether its row has one disc or two. */
export type LegendableWeatherLayer = WmsWeatherLayer | WmsMultiWeatherLayer

export const WEATHER_LAYERS: readonly WeatherLayer[] = [
  {
    id: 'radar',
    label: 'Radar (animated, global)',
    description:
      "RainViewer's global radar mosaic — 1200+ ground radars across 150+ countries, a new frame every 5 minutes, ~2 h of history looped. Universal Blue colouring for legibility over this app's dark zinc base.",
    source: 'rainviewer',
    attribution:
      '<a href="https://www.rainviewer.com/" target="_blank">Weather data by RainViewer</a>',
    defaultOpacity: 0.75,
    stackIndex: 30,
    legend: false,
    emptyMeans:
      'Blank means no precipitation in range — or a gap between the 1200+ station radars this feed stitches together.',
    coverage: 'Global — 1200+ radars across 150+ countries.',
  },
  {
    id: 'lightning',
    label: 'Lightning density',
    description:
      'EUMETSAT MTG-I Lightning Imager — accumulated flash area over the whole Meteosat disc, where strikes have actually been detected. Replaced DWD Blitzdichte (Germany only) 2026-08-19: same question, hemispheric reach instead of one country. Legitimately blank on a quiet night; that is data, not a broken layer.',
    source: 'wms',
    host: EUMETSAT_WMS,
    wmsLayer: 'mtg_fd:li_afa',
    // EUMETSAT's own PT5M grid — 25 is the measured 15 min lag plus two full 5-minute steps of
    // margin, so a request never lands exactly on the newest published slot with zero room to
    // spare. See `WeatherTimeGrid`'s table.
    timeGrid: { stepMinutes: RADAR_STEP_MINUTES, lagMinutes: 25 },
    defaultOpacity: 0.9,
    attribution: EUMETSAT_ATTRIBUTION,
    stackIndex: 50,
    legend: true,
    emptyMeans: 'Blank means no flashes detected — normal on a quiet night.',
    coverage:
      'The MTG-I disc, roughly ±70° — the Americas, the Pacific and eastern Asia still have no free lightning source (see the module docstring).',
  },
  {
    id: 'cloud',
    label: 'Cloud mask',
    description:
      'EUMETSAT MSG cloud mask, decoded from its red channel and repainted in this app\'s own transparent ramp, refreshed every 15 minutes across two discs. Radar only sees rain — this answers "is there cloud at all", the question a clear night turns on.',
    source: 'cloud-mask',
    hosts: [EUMETSAT_WMS, EUMETSAT_WMS],
    wmsLayers: ['msg_fes:clm', 'msg_iodc:clm'],
    attribution: EUMETSAT_ATTRIBUTION,
    defaultOpacity: 1,
    stackIndex: 20,
    legend: false,
    emptyMeans:
      'Transparent means clear sky inside the two discs — this layer decodes to real transparency now, never a blank rectangle the way the old opaque wash did.',
    coverage:
      'Europe, Africa, the Middle East, western and southern Asia, the eastern Atlantic and eastern South America — the two ±77° discs, centred on 0° and 45.5°E. NOT the western Americas, the Pacific, Australia or eastern Asia.',
  },
  {
    id: 'cloud-ir',
    label: 'Infrared cloud',
    description:
      "NASA GIBS GOES-East/West + Himawari infrared (10.8 µm), covering the hemisphere the EUMETSAT mask above cannot reach. Rendered as the provider's own colour-enhanced Clean Infrared product (cold convective tops render red/yellow/green over a grey field) rather than a decoded ramp — see the module docstring for why decoding it was tried and dropped. Complements the cloud mask, does not replace it: infrared reads high cold cloud well but under-reports low cloud — measured here at IR 56.3 over cloudy pixels vs 52.8 over clear land, with fully overlapping ranges. Low cloud is exactly what ends an astro night, so treat a clear read here as a hint, not a verdict.",
    source: 'gibs-ir',
    gibsLayers: [
      'GOES-East_ABI_Band13_Clean_Infrared',
      'GOES-West_ABI_Band13_Clean_Infrared',
      'Himawari_AHI_Band13_Clean_Infrared',
    ],
    attribution: GIBS_ATTRIBUTION,
    defaultOpacity: 0.6,
    stackIndex: 22,
    legend: false,
    emptyMeans:
      "A tile past a satellite's disc edge returns nothing and MapLibre renders it blank — the edge of coverage, not a broken layer.",
    coverage:
      'The Americas and the Atlantic (GOES-East/West) plus East Asia, Australia and the western Pacific (Himawari) — roughly the hemisphere the EUMETSAT cloud mask above does not reach, with a gap over the open Pacific between the discs. NOT global on its own — see the module docstring for why no single cloud layer here is.',
  },
  {
    id: 'cloud-top',
    label: 'Cloud top height',
    description:
      'EUMETSAT MSG cloud-top height, both discs — distinguishes thin high cirrus (which costs contrast but rarely ends a session) from a low deck (which does), the one distinction the binary cloud mask above cannot make. Refreshed every 15 minutes.',
    source: 'wms-multi',
    hosts: [EUMETSAT_WMS, EUMETSAT_WMS],
    wmsLayers: ['msg_fes:cth', 'msg_iodc:cth'],
    // EUMETSAT's own PT15M grid — measured lag 30, so 35 floors back past one grid boundary and
    // still lands inside what the host had published. `msg_iodc:cth` (probed 2026-08-19: HTTP 200,
    // `image/png`, colour type 6) mounts exactly like `msg_fes:cth`, same grid. See
    // `WeatherTimeGrid`'s table.
    timeGrid: { stepMinutes: 15, lagMinutes: 35 },
    defaultOpacity: 0.9,
    attribution: EUMETSAT_ATTRIBUTION,
    stackIndex: 24,
    legend: true,
    emptyMeans:
      'Nothing drawn means no cloud top was retrieved over that area — usually clear sky. The product paints only where there IS cloud (a probed tile ran 3 061 B, almost entirely transparent), so a mostly-empty render is the normal case, not a broken request.',
    coverage:
      'Both MSG discs — 0° and 45.5°E, roughly ±77° each — Europe, Africa, the Middle East, western and southern Asia, the eastern Atlantic and eastern South America, the same footprint the cloud mask above states. NOT the Americas or the Pacific.',
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
  /** The ramp's sensitivity window — see `LP_RANGE_FULL`. Carried the same way as `lpOpacity`
   * above: it is INTENSITY's sibling control, not a per-request value, so it survives the ramp
   * being toggled off and only resets on a fresh URL. */
  lpRange: readonly [number, number]
  /** Active overlays, already in stack order (bottom first). */
  weather: readonly WeatherSelection[]
  /** Hillshade and 3D terrain — two independent toggles over the same DEM source. */
  terrain: TerrainSelection
}

/**
 * The active overlay set as ONE compact search param: `radar.cloud:30` — ids joined by `.`,
 * each optionally carrying `:<percent>` when its opacity differs from the catalogue default.
 * Six booleans and six floats would otherwise be twelve query keys for one control panel.
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
 * how strongly the flat-shaded hillshade paint reads). User-controllable in the drawer. Raised
 * from the earlier `0.5` once the shadow/highlight colours actually differed (see
 * `HILLSHADE_SHADOW_VAR` in `map-overlays.ts`) — at true zinc-adjacent luminance a flatter default
 * read as barely-there relief.
 */
export const HILLSHADE_EXAGGERATION_DEFAULT = 0.7

/**
 * `hillshade-method`'s three drawer-facing options — MapLibre also ships `basic`/`combined`, left
 * out of the catalogue because they read as intermediate points on the same standard→multi
 * spectrum rather than a genuinely different look. Verified against the installed
 * `@maplibre/maplibre-gl-style-spec` (`HillshadeLayerSpecification['paint']['hillshade-method']`).
 *
 * `igor` is the default: it reads best over a coloured base (OpenTopoMap, the imagery bases) —
 * `standard`'s single low sun and `multidirectional`'s four lights both fight a basemap that
 * already carries its own colour, where igor's flat tone does not.
 */
export type HillshadeMethod = 'standard' | 'multidirectional' | 'igor'
export const HILLSHADE_METHOD_DEFAULT: HillshadeMethod = 'igor'
const HILLSHADE_METHODS: readonly HillshadeMethod[] = ['standard', 'multidirectional', 'igor']

/** Type guard, not a bare `as` — used by both the URL codec below and the drawer's
 * `SegmentedControl` handler, so a hand-edited URL or a stray value can't smuggle an unknown
 * method string into a paint expression. */
export function isHillshadeMethod(value: string | undefined): value is HillshadeMethod {
  return value !== undefined && (HILLSHADE_METHODS as readonly string[]).includes(value)
}

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
  /** The light model — `standard` (one low sun), `multidirectional` (four lights, softest) or
   * `igor` (flat-toned, reads best over a coloured base). Carried the same way as
   * `hillshadeExaggeration` — remembered while off, reset to `HILLSHADE_METHOD_DEFAULT` on a
   * fresh URL. */
  hillshadeMethod: HillshadeMethod
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

/**
 * The scheme's default terrain selection — what an untouched URL resolves to. Hillshade is ON by
 * default (2026-08-19 — "Hillshade should always be enabled right?!"); everything else stays off.
 * Named for what it actually IS, not `TERRAIN_OFF`: that name lied the moment hillshade stopped
 * being one of the things a fresh URL turns off. The checkbox in `map-settings-panel.tsx` still
 * lets it be turned off — this is only the untouched-URL default.
 */
export const TERRAIN_DEFAULT: TerrainSelection = {
  hillshade: true,
  hillshadeExaggeration: HILLSHADE_EXAGGERATION_DEFAULT,
  hillshadeMethod: HILLSHADE_METHOD_DEFAULT,
  extruded: false,
  trails: null,
  contours: false,
}

/**
 * One compact `terrain` search param, same convention as `wx`: `.`-joined tokens. `3d` and
 * `contours` are bare booleans; `trails` carries an optional `:<percent>` suffix — the same
 * `id[:opacity]` shape `wx` already uses. `hillshade` carries TWO optional suffixes,
 * `hillshade[:<percent>[:<method>]]`: `hillshade-exaggeration` and the light model
 * (`HillshadeMethod`) are both drawer sliders/toggles now, so an unrecognised or absent method
 * token falls back to `HILLSHADE_METHOD_DEFAULT` — the same never-throw contract every other
 * token in this codec already keeps.
 *
 * Hillshade being ON BY DEFAULT (`TERRAIN_DEFAULT`) flips the omit-when-default direction for this
 * ONE field versus every other token here: an absent `hillshade`/`no-hillshade` token means "on,
 * at catalogue defaults", not "off". Turning it explicitly OFF therefore needs its own token,
 * `no-hillshade` — there is no way to omit-to-mean-off when off is no longer the implicit state.
 */
export function parseTerrainParam(raw: string | undefined): TerrainSelection {
  if (raw === undefined || raw === '') return TERRAIN_DEFAULT
  let hillshade = true
  let hillshadeExaggeration = HILLSHADE_EXAGGERATION_DEFAULT
  let hillshadeMethod = HILLSHADE_METHOD_DEFAULT
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
    if (token === 'no-hillshade') {
      hillshade = false
      continue
    }
    const [id, ...suffixParts] = token.split(':')
    if (id === 'hillshade') {
      hillshade = true
      const [rawPercent, rawMethod] = suffixParts
      hillshadeExaggeration = parseOpacity(rawPercent) ?? HILLSHADE_EXAGGERATION_DEFAULT
      hillshadeMethod = isHillshadeMethod(rawMethod) ? rawMethod : HILLSHADE_METHOD_DEFAULT
      continue
    }
    if (id === 'trails') trails = parseOpacity(suffixParts[0]) ?? TRAILS_DEFAULT_OPACITY
  }
  return { hillshade, hillshadeExaggeration, hillshadeMethod, extruded, trails, contours }
}

/** Inverse of `parseTerrainParam`. Returns `undefined` for the untouched default (hillshade on at
 * catalogue defaults, everything else off) so the key leaves the URL. Hillshade being explicitly
 * OFF is the one state that needs its own token (`no-hillshade`) rather than an omission — see
 * `parseTerrainParam`'s doc for why the omit-when-default direction flips for this field. */
export function formatTerrainParam(selection: TerrainSelection): string | undefined {
  const tokens: string[] = []
  if (selection.hillshade) {
    const percent = Math.round(selection.hillshadeExaggeration * 100)
    const percentDefault = Math.round(HILLSHADE_EXAGGERATION_DEFAULT * 100) === percent
    const methodDefault = selection.hillshadeMethod === HILLSHADE_METHOD_DEFAULT
    if (!percentDefault || !methodDefault) {
      // A non-default method needs the percent slot filled even when the percent itself is
      // default — `hillshade::igor` is not a token this codec accepts, so the position has to
      // carry a real value once anything past it is non-default.
      const parts = ['hillshade', String(percent)]
      if (!methodDefault) parts.push(selection.hillshadeMethod)
      tokens.push(parts.join(':'))
    }
    // else: on, at every catalogue default — the implicit, untouched-URL state, omitted entirely.
  } else {
    tokens.push('no-hillshade')
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
