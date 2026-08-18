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
  DEFAULT_LP_YEAR,
  LP_PARAM_OFF,
  RADAR_FRAME_COUNT,
  RADAR_LAG_MINUTES,
  RADAR_STEP_MINUTES,
  TERRAIN_OFF,
  formatLpParam,
  formatTerrainParam,
  formatWeatherParam,
  lpTileUrl,
  normaliseLayerState,
  parseLpParam,
  parseTerrainParam,
  parseWeatherParam,
  radarFrameTimes,
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
    // cloudmask (stackIndex 10) sits before lightning (stackIndex 40) — already
    // in the order `parseWeatherParam` sorts to, so a clean round-trip proves
    // the codec rather than incidentally proving the sort too.
    const selection: WeatherSelection[] = [
      { id: 'cloudmask', opacity: 0.45 }, // matches the catalogue default — encodes bare
      { id: 'lightning', opacity: 0.3 }, // overrides the catalogue default (0.9) — encodes `:30`
    ]

    const encoded = formatWeatherParam(selection)
    expect(encoded).toBe('cloudmask.lightning:30')
    expect(parseWeatherParam(encoded)).toEqual(selection)
  })

  it('sorts a decoded selection into stack order regardless of URL order', () => {
    // lightning (40) written before radar (20) in the URL — the decode must
    // still hand back bottom-first stack order, not URL order.
    const decoded = parseWeatherParam('lightning.radar')
    expect(decoded.map((s) => s.id)).toEqual(['radar', 'lightning'])
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
  it('round-trips every published year and the off switch', () => {
    for (const year of [2016, 2020, 2022, 2023, 2024, 2025] as const) {
      const encoded = formatLpParam(year)
      expect(parseLpParam(encoded)).toBe(year)
    }
    expect(formatLpParam(null)).toBe(LP_PARAM_OFF)
    expect(parseLpParam(LP_PARAM_OFF)).toBeNull()
  })

  it('falls back to the default year rather than returning NaN or undefined for a hostile string', () => {
    expect(parseLpParam('<script>alert(1)</script>')).toBe(DEFAULT_LP_YEAR)
    expect(parseLpParam('9999999999999999999999')).toBe(DEFAULT_LP_YEAR)
    expect(parseLpParam('')).toBe(DEFAULT_LP_YEAR)
    expect(parseLpParam('2019')).toBe(DEFAULT_LP_YEAR) // a real number, but never a published vintage
  })
})

describe('terrain param codec', () => {
  it('round-trips both-off through the absent-param case', () => {
    expect(formatTerrainParam(TERRAIN_OFF)).toBeUndefined()
    expect(parseTerrainParam(undefined)).toEqual(TERRAIN_OFF)
    expect(parseTerrainParam('')).toEqual(TERRAIN_OFF)
  })

  it('round-trips hillshade alone, 3D alone, and both together', () => {
    const hillshadeOnly = { hillshade: true, extruded: false }
    const extrudedOnly = { hillshade: false, extruded: true }
    const both = { hillshade: true, extruded: true }

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
})

// ── normaliseLayerState — the imagery/LP exclusion, both directions ────────

function stateFixture(overrides: Partial<MapLayerState>): MapLayerState {
  return { base: 'ofm-fiord', lpYear: null, weather: [], terrain: TERRAIN_OFF, ...overrides }
}

describe('normaliseLayerState', () => {
  it('clears the pollution ramp when the base is satellite imagery', () => {
    const state = stateFixture({ base: 'eox-s2cloudless', lpYear: 2025 })
    expect(normaliseLayerState(state).lpYear).toBeNull()
  })

  it('leaves the ramp alone when the base is imagery but the ramp is already off', () => {
    const state = stateFixture({ base: 'eox-s2cloudless', lpYear: null })
    expect(normaliseLayerState(state)).toEqual(state)
  })

  it('leaves the ramp alone when the base is a vector style, not imagery', () => {
    const state = stateFixture({ base: 'ofm-fiord', lpYear: 2025 })
    expect(normaliseLayerState(state)).toEqual(state)
  })
})

// ── radarFrameTimes ──────────────────────────────────────────────────────────

describe('radarFrameTimes', () => {
  const FIXED_NOW = new Date('2026-08-18T22:47:33.123Z')

  it('returns exactly RADAR_FRAME_COUNT frames', () => {
    expect(radarFrameTimes(FIXED_NOW)).toHaveLength(RADAR_FRAME_COUNT)
  })

  it('aligns every frame to the 5-minute grid in UTC, on the hundredth second', () => {
    for (const iso of radarFrameTimes(FIXED_NOW)) {
      const frame = new Date(iso)
      expect(frame.getUTCMinutes() % RADAR_STEP_MINUTES).toBe(0)
      expect(frame.getUTCSeconds()).toBe(0)
      expect(frame.getUTCMilliseconds()).toBe(0)
    }
  })

  it('opens on the documented lag behind the wall clock, floored to the grid', () => {
    expect(RADAR_LAG_MINUTES).toBe(15)
    const [first] = radarFrameTimes(FIXED_NOW)
    // 22:47:33.123Z minus 15 min = 22:32:33.123Z, floored to the 5-minute grid.
    expect(first).toBe('2026-08-18T22:30:00.000Z')
  })

  it('produces strictly ascending timestamps, exactly one step apart', () => {
    const frames = radarFrameTimes(FIXED_NOW).map((iso) => new Date(iso).getTime())
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i]! - frames[i - 1]!).toBe(RADAR_STEP_MINUTES * 60_000)
    }
  })

  it('is a pure function of the clock it is given, not of the real one', () => {
    expect(radarFrameTimes(FIXED_NOW)).toEqual(radarFrameTimes(new Date(FIXED_NOW.getTime())))
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

describe('lpTileUrl', () => {
  it('builds off the shared API base, not a hardcoded origin', () => {
    expect(lpTileUrl(2025)).toBe('http://test.local/api/astro/tiles/lp/2025/{z}/{x}/{y}.png')
  })
})
