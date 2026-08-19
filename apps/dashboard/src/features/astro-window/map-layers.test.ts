import { describe, expect, it } from 'bun:test'
import type { MapLayerState, WeatherSelection } from './map-layers'

// map-layers.ts imports `lib/api-base`, which reads `window.location.origin` at
// module-evaluation time when VITE_API_URL is unset — there is no DOM under plain
// `bun test`. Setting VITE_API_URL here, before the dynamic import below triggers
// that evaluation, sidesteps it without faking `window` (same workaround
// `features/hermes-chat/threads-store.test.ts` uses — `import.meta.env.*` reads
// live off `process.env` under bun).
process.env['VITE_API_URL'] = 'http://test.local/api'

const {
  CLOUD_RAMP,
  DEFAULT_LP_YEAR,
  GIBS_LAG_MINUTES,
  GIBS_STEP_MINUTES,
  HILLSHADE_EXAGGERATION_DEFAULT,
  HILLSHADE_METHOD_DEFAULT,
  LP_OPACITY_DEFAULT,
  LP_PARAM_OFF,
  LP_RAMP,
  LP_RANGE_FULL,
  LP_RANGE_MAX,
  LP_RANGE_MIN,
  LP_RANGE_MIN_WIDTH,
  LP_RESAMPLING_DEFAULT,
  RADAR_LAG_MINUTES,
  RADAR_STEP_MINUTES,
  TERRAIN_OFF,
  TRAILS_DEFAULT_OPACITY,
  WEATHER_LAYERS,
  baseLayer,
  formatLpParam,
  formatTerrainParam,
  formatWeatherParam,
  gibsTileUrl,
  gibsTime,
  lpTileUrl,
  parseLpParam,
  parseTerrainParam,
  parseWeatherParam,
  rainviewerTileUrl,
  remapLpRampStops,
  weatherLayerTime,
  wmsTileUrl,
} = await import('./map-layers')

// ── URL codec round-trips ───────────────────────────────────────────────────

describe('weather param codec', () => {
  it('round-trips an empty selection through the absent-param case', () => {
    expect(formatWeatherParam([])).toBeUndefined()
    expect(parseWeatherParam(undefined)).toEqual([])
    expect(parseWeatherParam('')).toEqual([])
  })

  it('round-trips a selection with a default and an overridden opacity', () => {
    // cloud (stackIndex 20) sits before lightning (stackIndex 50) — already
    // in the order `parseWeatherParam` sorts to, so a clean round-trip proves
    // the codec rather than incidentally proving the sort too.
    const selection: WeatherSelection[] = [
      { id: 'cloud', opacity: 1 }, // matches the catalogue default — encodes bare
      { id: 'lightning', opacity: 0.3 }, // overrides the catalogue default (0.9) — encodes `:30`
    ]

    const encoded = formatWeatherParam(selection)
    expect(encoded).toBe('cloud.lightning:30')
    expect(parseWeatherParam(encoded)).toEqual(selection)
  })

  it('round-trips every new catalogue id at its default opacity', () => {
    for (const id of ['radar-de', 'cloud', 'cloud-ir', 'cloud-top'] as const) {
      const decoded = parseWeatherParam(id)
      expect(decoded).toHaveLength(1)
      expect(decoded[0]!.id).toBe(id)
      expect(formatWeatherParam(decoded)).toBe(id)
    }
  })

  it('sorts a decoded selection into stack order regardless of URL order', () => {
    // lightning (50) written before radar (30) in the URL — the decode must
    // still hand back bottom-first stack order, not URL order.
    const decoded = parseWeatherParam('lightning.radar')
    expect(decoded.map((s) => s.id)).toEqual(['radar', 'lightning'])
  })

  it('sorts cloud-top (24) above cloud-ir (22) and below radar (30) — the new cloud group slot', () => {
    const decoded = parseWeatherParam('radar.cloud-top.cloud-ir')
    expect(decoded.map((s) => s.id)).toEqual(['cloud-ir', 'cloud-top', 'radar'])
  })

  it('sorts the full six-layer catalogue into the derived stack order', () => {
    // cloud (20) < cloud-ir (22) < radar (30) < radar-de (32) < cells (40) < lightning (50) —
    // see map-layers.ts's "Stack order" section for the reasoning.
    const decoded = parseWeatherParam('lightning.radar-de.cloud-ir.cells.radar.cloud')
    expect(decoded.map((s) => s.id)).toEqual([
      'cloud',
      'cloud-ir',
      'radar',
      'radar-de',
      'cells',
      'lightning',
    ])
  })

  it('drops an id the catalogue does not know, without throwing', () => {
    expect(parseWeatherParam('not-a-real-layer')).toEqual([])
    // A `Map`-backed catalogue lookup, not a plain object — `__proto__` is just
    // an unknown key, never a prototype-pollution vector.
    expect(parseWeatherParam('__proto__:60')).toEqual([])
  })

  it('falls back to the catalogue default opacity for a garbage or out-of-range value', () => {
    expect(parseWeatherParam('radar:notanumber')).toEqual([{ id: 'radar', opacity: 0.75 }])
    expect(parseWeatherParam('radar:999')).toEqual([{ id: 'radar', opacity: 0.75 }])
    expect(parseWeatherParam('radar:-5')).toEqual([{ id: 'radar', opacity: 0.75 }])
  })

  it('ignores extra `:`-delimited segments rather than choking on them', () => {
    expect(parseWeatherParam('radar:50:hack:more')).toEqual([{ id: 'radar', opacity: 0.5 }])
  })

  it('keeps only the first occurrence of a repeated id', () => {
    expect(parseWeatherParam('radar.radar:10')).toEqual([{ id: 'radar', opacity: 0.75 }])
  })
})

describe('lp param codec', () => {
  it('round-trips every published year and the off switch, at every default', () => {
    for (const year of [2016, 2020, 2022, 2023, 2024, 2025] as const) {
      const selection = {
        year,
        opacity: LP_OPACITY_DEFAULT,
        resampling: LP_RESAMPLING_DEFAULT,
        range: LP_RANGE_FULL,
      }
      const encoded = formatLpParam(selection)
      expect(encoded).toBe(String(year)) // no suffix at the defaults
      expect(parseLpParam(encoded)).toEqual(selection)
    }
    const off = {
      year: null,
      opacity: LP_OPACITY_DEFAULT,
      resampling: LP_RESAMPLING_DEFAULT,
      range: LP_RANGE_FULL,
    }
    expect(formatLpParam(off)).toBe(LP_PARAM_OFF)
    expect(parseLpParam(LP_PARAM_OFF)).toEqual(off)
  })

  it('round-trips a committed opacity, dropping the resampling/range suffixes while both stay default', () => {
    const selection = {
      year: 2025 as const,
      opacity: 0.6,
      resampling: LP_RESAMPLING_DEFAULT,
      range: LP_RANGE_FULL,
    }
    const encoded = formatLpParam(selection)
    expect(encoded).toBe('2025:60')
    expect(parseLpParam(encoded)).toEqual(selection)
  })

  it('round-trips sharp resampling, carrying the opacity along even at its default', () => {
    const selection = {
      year: 2025 as const,
      opacity: LP_OPACITY_DEFAULT,
      resampling: 'nearest' as const,
      range: LP_RANGE_FULL,
    }
    const encoded = formatLpParam(selection)
    expect(encoded).toBe('2025:100:sharp')
    expect(parseLpParam(encoded)).toEqual(selection)
  })

  it('round-trips a committed opacity together with sharp resampling', () => {
    const selection = {
      year: 2025 as const,
      opacity: 0.6,
      resampling: 'nearest' as const,
      range: LP_RANGE_FULL,
    }
    const encoded = formatLpParam(selection)
    expect(encoded).toBe('2025:60:sharp')
    expect(parseLpParam(encoded)).toEqual(selection)
  })

  it('round-trips a narrowed sensitivity range, filling the resampling slot with "smooth" to reach it', () => {
    const selection = {
      year: 2025 as const,
      opacity: LP_OPACITY_DEFAULT,
      resampling: LP_RESAMPLING_DEFAULT,
      range: [2100, 2200] as const,
    }
    const encoded = formatLpParam(selection)
    expect(encoded).toBe('2025:100:smooth:2100-2200')
    expect(parseLpParam(encoded)).toEqual(selection)
  })

  it('round-trips a narrowed range together with sharp resampling', () => {
    const selection = {
      year: 2025 as const,
      opacity: 0.6,
      resampling: 'nearest' as const,
      range: [1900, 2150] as const,
    }
    const encoded = formatLpParam(selection)
    expect(encoded).toBe('2025:60:sharp:1900-2150')
    expect(parseLpParam(encoded)).toEqual(selection)
  })

  it('accepts "smooth" as an explicit synonym for linear, reaching the range slot without it', () => {
    expect(parseLpParam('2025:100:smooth:2100-2200')).toEqual({
      year: 2025,
      opacity: LP_OPACITY_DEFAULT,
      resampling: 'linear',
      range: [2100, 2200],
    })
  })

  it('falls back to the full range for a malformed range token, without touching the other fields', () => {
    const fallback = { year: 2025, opacity: 0.6, resampling: 'linear', range: LP_RANGE_FULL }
    expect(parseLpParam('2025:60:smooth:not-a-range')).toEqual(fallback)
    expect(parseLpParam('2025:60:smooth:2200-2100')).toEqual(fallback) // reversed
    expect(parseLpParam('2025:60:smooth:1000-3000')).toEqual(fallback) // outside LP_RANGE_MIN/MAX
  })

  it('falls back to the full range for a degenerate (too-narrow) window', () => {
    expect(parseLpParam('2025:100:smooth:2000-2000').range).toEqual(LP_RANGE_FULL)
    expect(parseLpParam('2025:100:smooth:2000-2001').range).toEqual(LP_RANGE_FULL)
  })

  it('falls back to the full range for a window one unit narrower than LP_RANGE_MIN_WIDTH', () => {
    const min = 2100
    const max = min + LP_RANGE_MIN_WIDTH - 1
    expect(parseLpParam(`2025:100:smooth:${min}-${max}`).range).toEqual(LP_RANGE_FULL)
  })

  it('round-trips a window exactly LP_RANGE_MIN_WIDTH wide, and remaps it to strictly ascending stops', () => {
    const min = 2100
    const max = min + LP_RANGE_MIN_WIDTH
    const selection = {
      year: 2025 as const,
      opacity: LP_OPACITY_DEFAULT,
      resampling: LP_RESAMPLING_DEFAULT,
      range: [min, max] as const,
    }
    const encoded = formatLpParam(selection)
    expect(parseLpParam(encoded)).toEqual(selection)
    const stops = remapLpRampStops([min, max])
    for (let i = 1; i < stops.length; i += 1) {
      expect(stops[i]!).toBeGreaterThan(stops[i - 1]!)
    }
  })

  it('keeps every legacy 1-, 2- and 3-slot form parsing exactly as before, defaulting the range', () => {
    expect(parseLpParam('off')).toEqual({
      year: null,
      opacity: LP_OPACITY_DEFAULT,
      resampling: LP_RESAMPLING_DEFAULT,
      range: LP_RANGE_FULL,
    })
    expect(parseLpParam('2025')).toEqual({
      year: 2025,
      opacity: LP_OPACITY_DEFAULT,
      resampling: LP_RESAMPLING_DEFAULT,
      range: LP_RANGE_FULL,
    })
    expect(parseLpParam('2025:60')).toEqual({
      year: 2025,
      opacity: 0.6,
      resampling: LP_RESAMPLING_DEFAULT,
      range: LP_RANGE_FULL,
    })
    expect(parseLpParam('2025:60:sharp')).toEqual({
      year: 2025,
      opacity: 0.6,
      resampling: 'nearest',
      range: LP_RANGE_FULL,
    })
  })

  it('falls back to the default year rather than returning NaN or undefined for a hostile string', () => {
    expect(parseLpParam('<script>alert(1)</script>').year).toBe(DEFAULT_LP_YEAR)
    expect(parseLpParam('9999999999999999999999').year).toBe(DEFAULT_LP_YEAR)
    expect(parseLpParam('').year).toBe(DEFAULT_LP_YEAR)
    expect(parseLpParam('2019').year).toBe(DEFAULT_LP_YEAR) // a real number, but never a published vintage
  })

  it('falls back to the default opacity for a garbage or out-of-range percent, without touching the year', () => {
    const fallback = {
      year: 2025 as const,
      opacity: LP_OPACITY_DEFAULT,
      resampling: LP_RESAMPLING_DEFAULT,
      range: LP_RANGE_FULL,
    }
    expect(parseLpParam('2025:notanumber')).toEqual(fallback)
    expect(parseLpParam('2025:999')).toEqual(fallback)
    expect(parseLpParam('2025:-5')).toEqual(fallback)
  })

  it('treats anything other than the literal "sharp" suffix as linear', () => {
    expect(parseLpParam('2025:60:hack').resampling).toBe('linear')
    expect(parseLpParam('2025:60').resampling).toBe('linear')
  })
})

describe('remapLpRampStops', () => {
  it('reconstructs the canonical stops exactly for the full range', () => {
    expect(remapLpRampStops(LP_RANGE_FULL)).toEqual(LP_RAMP.map((row) => row.stop))
  })

  it('always produces strictly ascending stops, including at the minimum non-degenerate width', () => {
    const ranges: ReadonlyArray<readonly [number, number]> = [
      LP_RANGE_FULL,
      [2100, 2200],
      [1900, 2150],
      [LP_RANGE_MIN, LP_RANGE_MAX],
      [2190, 2200], // as narrow as the tightest canonical gap — degenerate, falls back, still ascends
    ]
    for (const range of ranges) {
      const stops = remapLpRampStops(range)
      for (let i = 1; i < stops.length; i += 1) {
        expect(stops[i]!).toBeGreaterThan(stops[i - 1]!)
      }
    }
  })

  it('falls back to the canonical stops for a window too narrow to keep every stop distinct', () => {
    // A 1-unit-wide window cannot possibly hold 11 distinct integer stops.
    expect(remapLpRampStops([2100, 2101])).toEqual(LP_RAMP.map((row) => row.stop))
  })
})

describe('LP_RAMP geometry', () => {
  it('ascends strictly in stop, as MapLibre interpolate requires', () => {
    for (let i = 1; i < LP_RAMP.length; i += 1) {
      expect(LP_RAMP[i]!.stop).toBeGreaterThan(LP_RAMP[i - 1]!.stop)
    }
  })

  it('has its alpha minimum exactly at the neutral crossing (stop 2130), rising monotonically in both directions away from it — no dips anywhere else', () => {
    let minIndex = 0
    for (let i = 1; i < LP_RAMP.length; i += 1) {
      if (LP_RAMP[i]!.alpha < LP_RAMP[minIndex]!.alpha) minIndex = i
    }
    expect(LP_RAMP[minIndex]!.stop).toBe(2130)

    for (let i = 1; i <= minIndex; i += 1) {
      expect(LP_RAMP[i]!.alpha).toBeLessThan(LP_RAMP[i - 1]!.alpha)
    }
    for (let i = minIndex + 1; i < LP_RAMP.length; i += 1) {
      expect(LP_RAMP[i]!.alpha).toBeGreaterThan(LP_RAMP[i - 1]!.alpha)
    }
  })
})

describe('terrain param codec', () => {
  it('round-trips both-off through the absent-param case', () => {
    expect(formatTerrainParam(TERRAIN_OFF)).toBeUndefined()
    expect(parseTerrainParam(undefined)).toEqual(TERRAIN_OFF)
    expect(parseTerrainParam('')).toEqual(TERRAIN_OFF)
  })

  it('round-trips hillshade alone, 3D alone, and both together', () => {
    const hillshadeOnly = { ...TERRAIN_OFF, hillshade: true }
    const extrudedOnly = { ...TERRAIN_OFF, extruded: true }
    const both = { ...TERRAIN_OFF, hillshade: true, extruded: true }

    expect(formatTerrainParam(hillshadeOnly)).toBe('hillshade')
    expect(parseTerrainParam('hillshade')).toEqual(hillshadeOnly)

    expect(formatTerrainParam(extrudedOnly)).toBe('3d')
    expect(parseTerrainParam('3d')).toEqual(extrudedOnly)

    expect(formatTerrainParam(both)).toBe('hillshade.3d')
    expect(parseTerrainParam('hillshade.3d')).toEqual(both)
    // Token order in the URL must not matter for the decode.
    expect(parseTerrainParam('3d.hillshade')).toEqual(both)
  })

  it('drops an id the catalogue does not know, without throwing', () => {
    expect(parseTerrainParam('not-a-real-layer')).toEqual(TERRAIN_OFF)
    expect(parseTerrainParam('__proto__')).toEqual(TERRAIN_OFF)
  })

  it('round-trips the trails overlay at its default and a committed opacity', () => {
    const trailsDefault = { ...TERRAIN_OFF, trails: TRAILS_DEFAULT_OPACITY }
    const trailsCustom = { ...TERRAIN_OFF, trails: 0.4 }
    const trailsWithHillshade = { ...TERRAIN_OFF, hillshade: true, trails: TRAILS_DEFAULT_OPACITY }

    // A default-opacity trails toggle drops the percent — same convention as `wx`.
    expect(formatTerrainParam(trailsDefault)).toBe('trails')
    expect(parseTerrainParam('trails')).toEqual(trailsDefault)

    expect(formatTerrainParam(trailsCustom)).toBe('trails:40')
    expect(parseTerrainParam('trails:40')).toEqual(trailsCustom)

    // Token order must not matter, and trails composes with the other two toggles.
    expect(formatTerrainParam(trailsWithHillshade)).toBe('hillshade.trails')
    expect(parseTerrainParam('hillshade.trails')).toEqual(trailsWithHillshade)
    expect(parseTerrainParam('trails.hillshade')).toEqual(trailsWithHillshade)
  })

  it('round-trips hillshade exaggeration at its default and a committed value', () => {
    const hillshadeDefault = { ...TERRAIN_OFF, hillshade: true }
    const hillshadeCustom = { ...TERRAIN_OFF, hillshade: true, hillshadeExaggeration: 0.8 }

    // A default-exaggeration hillshade toggle drops the percent — same convention as `trails`.
    expect(formatTerrainParam(hillshadeDefault)).toBe('hillshade')
    expect(parseTerrainParam('hillshade')).toEqual(hillshadeDefault)

    expect(formatTerrainParam(hillshadeCustom)).toBe('hillshade:80')
    expect(parseTerrainParam('hillshade:80')).toEqual(hillshadeCustom)

    // Exaggeration is dropped from the URL once hillshade itself is off, mirroring trails'
    // opacity-follows-toggle shape — the custom value never round-trips through an off state.
    expect(formatTerrainParam({ ...TERRAIN_OFF, hillshadeExaggeration: 0.8 })).toBeUndefined()
  })

  it('round-trips a non-default hillshade method, filling the percent slot to reach it', () => {
    const standard = { ...TERRAIN_OFF, hillshade: true, hillshadeMethod: 'standard' as const }
    const multi = { ...TERRAIN_OFF, hillshade: true, hillshadeMethod: 'multidirectional' as const }

    // The percent slot has to carry the real (default) value once the method past it is
    // non-default — `hillshade::standard` is not a token this codec accepts.
    expect(formatTerrainParam(standard)).toBe(
      `hillshade:${Math.round(HILLSHADE_EXAGGERATION_DEFAULT * 100)}:standard`,
    )
    expect(parseTerrainParam(formatTerrainParam(standard))).toEqual(standard)

    expect(formatTerrainParam(multi)).toBe(
      `hillshade:${Math.round(HILLSHADE_EXAGGERATION_DEFAULT * 100)}:multidirectional`,
    )
    expect(parseTerrainParam(formatTerrainParam(multi))).toEqual(multi)

    // The catalogue default itself needs no suffix at all.
    expect(formatTerrainParam({ ...TERRAIN_OFF, hillshade: true })).toBe('hillshade')
  })

  it('round-trips a non-default method together with a non-default exaggeration', () => {
    const custom = {
      ...TERRAIN_OFF,
      hillshade: true,
      hillshadeExaggeration: 0.4,
      hillshadeMethod: 'standard' as const,
    }
    const encoded = formatTerrainParam(custom)
    expect(encoded).toBe('hillshade:40:standard')
    expect(parseTerrainParam(encoded)).toEqual(custom)
  })

  it('falls back to the default hillshade method for an unrecognised method token, without throwing', () => {
    expect(parseTerrainParam('hillshade:70:not-a-method')).toEqual({
      ...TERRAIN_OFF,
      hillshade: true,
      hillshadeExaggeration: 0.7,
      hillshadeMethod: HILLSHADE_METHOD_DEFAULT,
    })
    // No percent at all, straight to an (unrecognised) third slot — still never throws.
    expect(parseTerrainParam('hillshade:__proto__')).toEqual({
      ...TERRAIN_OFF,
      hillshade: true,
    })
  })

  it('round-trips the contours toggle, bare and composed with the other toggles', () => {
    const contoursOnly = { ...TERRAIN_OFF, contours: true }
    const contoursWithHillshade = { ...TERRAIN_OFF, hillshade: true, contours: true }

    expect(formatTerrainParam(contoursOnly)).toBe('contours')
    expect(parseTerrainParam('contours')).toEqual(contoursOnly)

    expect(formatTerrainParam(contoursWithHillshade)).toBe('hillshade.contours')
    expect(parseTerrainParam('hillshade.contours')).toEqual(contoursWithHillshade)
    // Token order must not matter for the decode.
    expect(parseTerrainParam('contours.hillshade')).toEqual(contoursWithHillshade)
  })
})

// ── base + light pollution coexistence (the exclusion rule is gone) ────────

function stateFixture(overrides: Partial<MapLayerState>): MapLayerState {
  return {
    base: 'ofm-fiord',
    lpYear: null,
    lpOpacity: LP_OPACITY_DEFAULT,
    lpResampling: LP_RESAMPLING_DEFAULT,
    lpRange: LP_RANGE_FULL,
    weather: [],
    terrain: TERRAIN_OFF,
    ...overrides,
  }
}

describe('base + light pollution coexistence', () => {
  it('keeps a raster base and a pollution year together through the same param round-trip', () => {
    // A raster base (Satellite, Topographic) used to zero `lpYear` on decode
    // (`normaliseLayerState`, since removed) and the drawer used to swing the base back to a
    // vector style the moment a year was picked. Neither exists anymore — the two controls are
    // independent, and a state carrying both survives a round-trip through the `lp` codec intact.
    const state = stateFixture({ base: 'eox-s2cloudless', lpYear: 2025, lpOpacity: 0.6 })
    const encoded = formatLpParam({
      year: state.lpYear,
      opacity: state.lpOpacity,
      resampling: state.lpResampling,
      range: state.lpRange,
    })
    const decoded = parseLpParam(encoded)

    expect(baseLayer(state.base).kind).not.toBe('style') // a genuinely raster base
    expect(decoded.year).toBe(2025) // still on
    expect(decoded.opacity).toBe(0.6)
    expect(state.base).toBe('eox-s2cloudless') // nothing swings it back to a vector style
  })
})

// ── weatherLayerTime / gibsTime ────────────────────────────────────────────

function wmsRow(id: string) {
  const entry = WEATHER_LAYERS.find((row) => row.id === id)
  if (entry === undefined || entry.source !== 'wms') throw new Error(`missing wms row '${id}'`)
  return entry
}

describe('weatherLayerTime', () => {
  // The wall-clock instant every lag in `WeatherTimeGrid`'s table was measured against.
  const FIXED_NOW = new Date('2026-08-19T08:30:00.000Z')

  it('every wms row carries a timeGrid whose lag is at least a full step past the grid', () => {
    for (const entry of WEATHER_LAYERS) {
      if (entry.source !== 'wms') continue
      expect(entry.timeGrid.stepMinutes).toBeGreaterThan(0)
      expect(entry.timeGrid.lagMinutes).toBeGreaterThanOrEqual(entry.timeGrid.stepMinutes)
    }
  })

  it('floors radar-de and cells to the DWD PT5M grid, lagged by RADAR_LAG_MINUTES (15)', () => {
    expect(RADAR_LAG_MINUTES).toBe(15)
    expect(RADAR_STEP_MINUTES).toBe(5)
    for (const id of ['radar-de', 'cells']) {
      const entry = wmsRow(id)
      expect(entry.timeGrid).toEqual({
        stepMinutes: RADAR_STEP_MINUTES,
        lagMinutes: RADAR_LAG_MINUTES,
      })
      // 08:30:00Z minus 15 min = 08:15:00Z, already on the 5-minute grid.
      expect(weatherLayerTime(entry, FIXED_NOW)).toBe('2026-08-19T08:15:00.000Z')
    }
  })

  it('floors lightning to its own EUMETSAT PT5M lag (25 — measured 15 plus two 5-minute steps, not RADAR_LAG_MINUTES)', () => {
    const entry = wmsRow('lightning')
    expect(entry.timeGrid).toEqual({ stepMinutes: 5, lagMinutes: 25 })
    // 08:30:00Z minus 25 min = 08:05:00Z, already on the 5-minute grid.
    expect(weatherLayerTime(entry, FIXED_NOW)).toBe('2026-08-19T08:05:00.000Z')
  })

  it('floors cloud-top to its own EUMETSAT PT15M grid, lagged by 35 (measured 30 plus one 15-minute step)', () => {
    const entry = wmsRow('cloud-top')
    expect(entry.timeGrid).toEqual({ stepMinutes: 15, lagMinutes: 35 })
    // 08:30:00Z minus 35 min = 07:55:00Z, floored to the 15-minute grid = 07:45:00Z.
    expect(weatherLayerTime(entry, FIXED_NOW)).toBe('2026-08-19T07:45:00.000Z')
  })

  it('is a pure function of the clock it is given, not of the real one', () => {
    const entry = wmsRow('radar-de')
    expect(weatherLayerTime(entry, FIXED_NOW)).toBe(
      weatherLayerTime(entry, new Date(FIXED_NOW.getTime())),
    )
  })
})

describe('gibsTime', () => {
  const FIXED_NOW = new Date('2026-08-19T07:37:12.456Z')

  it('floors to the GIBS PT10M grid, lagged by GIBS_LAG_MINUTES, with no milliseconds', () => {
    expect(GIBS_LAG_MINUTES).toBe(40)
    expect(GIBS_STEP_MINUTES).toBe(10)
    // 07:37:12.456Z minus 40 min = 06:57:12.456Z, floored to the 10-minute grid.
    expect(gibsTime(FIXED_NOW)).toBe('2026-08-19T06:50:00Z')
  })

  it('never emits a `.000Z`-style millisecond suffix, unlike weatherLayerTime', () => {
    expect(gibsTime(FIXED_NOW)).not.toContain('.')
  })
})

// ── URL builders ─────────────────────────────────────────────────────────────

describe('wmsTileUrl', () => {
  it('uses WMS 1.1.1 and leaves the MapLibre bbox placeholder un-encoded', () => {
    const url = wmsTileUrl({ host: 'https://maps.dwd.de/geoserver/dwd/wms', layer: 'dwd:test' })
    expect(url).toContain('version=1.1.1')
    expect(url).toContain('srs=EPSG%3A3857')
    // MUST stay a literal `{bbox-epsg-3857}` — running it through URLSearchParams
    // would percent-encode the braces and MapLibre's substitution would never fire.
    expect(url.endsWith('&bbox={bbox-epsg-3857}')).toBe(true)
  })

  it('adds the time param only when a frame time is given', () => {
    const withoutTime = wmsTileUrl({ host: 'https://x', layer: 'l' })
    const withTime = wmsTileUrl({ host: 'https://x', layer: 'l', time: '2026-08-18T22:30:00.000Z' })
    expect(withoutTime).not.toContain('time=')
    expect(withTime).toContain('time=2026-08-18T22%3A30%3A00.000Z')
  })
})

describe('rainviewerTileUrl', () => {
  it('builds a well-formed tile template — colour scheme 2, options 1_1, literal {z}/{x}/{y}', () => {
    const url = rainviewerTileUrl('https://tilecache.rainviewer.com', '/v2/radar/1755000000')
    expect(url).toBe(
      'https://tilecache.rainviewer.com/v2/radar/1755000000/256/{z}/{x}/{y}/2/1_1.png',
    )
  })

  it('leaves the MapLibre placeholders un-encoded', () => {
    const url = rainviewerTileUrl('https://tilecache.rainviewer.com', '/v2/radar/x')
    expect(url).toContain('{z}/{x}/{y}')
  })
})

describe('gibsTileUrl', () => {
  it('uses WMTS z/y/x order — NOT z/x/y, unlike every other row in this catalogue', () => {
    const url = gibsTileUrl('GOES-East_ABI_Band13_Clean_Infrared', '2026-08-19T07:00:00Z')
    const marker = '/GoogleMapsCompatible_Level6/'
    const template = url.slice(url.lastIndexOf(marker) + marker.length)
    expect(template).toBe('{z}/{y}/{x}.png')
  })

  it('bakes the layer and time into the path', () => {
    const url = gibsTileUrl('Himawari_AHI_Band13_Clean_Infrared', '2026-08-19T07:00:00Z')
    expect(url).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/2026-08-19T07:00:00Z/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
    )
  })
})

describe('CLOUD_RAMP', () => {
  it('ascends strictly in stop, as MapLibre interpolate requires', () => {
    for (let i = 1; i < CLOUD_RAMP.length; i += 1) {
      expect(CLOUD_RAMP[i]!.stop).toBeGreaterThan(CLOUD_RAMP[i - 1]!.stop)
    }
  })

  it('is fully transparent for clear sky (0, 96) and fully opaque at the top (255)', () => {
    expect(CLOUD_RAMP[0]!.alpha).toBe(0)
    expect(CLOUD_RAMP[1]!.alpha).toBe(0)
    expect(CLOUD_RAMP.at(-1)!.alpha).toBe(1)
  })
})

describe('lpTileUrl', () => {
  it('builds off the shared API base, not a hardcoded origin', () => {
    expect(lpTileUrl(2025)).toBe('http://test.local/api/astro/tiles/lp/2025/{z}/{x}/{y}.png')
  })
})
