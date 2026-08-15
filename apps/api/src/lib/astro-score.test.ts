import { describe, expect, it } from 'bun:test'
import { resolveNight } from './astro-night.js'
import {
  ASTRO_WEIGHTS,
  astroWindowConfig,
  evaluationSamples,
  MAX_MOON_ILLUMINATION,
  MIN_CORE_ALTITUDE,
  peakCoreAltitudeInDarkness,
  peakMoonAltitude,
  type AstroScoreInput,
} from './astro-score.js'
import { scoreWindow } from './window-score.js'

const MUNICH = { lat: 48.1374, lon: 11.5755 }
const TZ = 'Europe/Berlin'

function night(date: string, observer = MUNICH) {
  return resolveNight({ observer, timeZone: TZ, date, minCoreAltitude: MIN_CORE_ALTITUDE })
}

function input(date: string, weather: Partial<AstroScoreInput> = {}): AstroScoreInput {
  return {
    night: night(date),
    cloudLow: 0,
    cloudMid: 0,
    cloudHigh: 0,
    transparency: 1,
    bortle: 4,
    ...weather,
  }
}

describe('hard gates', () => {
  it('passes a clear new-moon night in mid-August', () => {
    const result = scoreWindow(astroWindowConfig, input('2026-08-15'))
    expect(result.gated).toBe(false)
    expect(result.killers).toEqual([])
    expect(result.score).toBeGreaterThan(90)
  })

  it('kills a night with no astronomical darkness, naming the reason', () => {
    // 48.6°N on the solstice: the sun tops out at −17.97°.
    const result = scoreWindow(astroWindowConfig, {
      ...input('2026-06-21'),
      night: night('2026-06-21', { lat: 48.6, lon: MUNICH.lon }),
    })
    expect(result.gated).toBe(true)
    expect(result.killers.map((k) => k.id)).toEqual(['darkness'])
    expect(result.killers[0]!.reason).toContain('−18°')
    expect(result.score).toBe(0)
  })

  it('does not double-report the core gate when darkness is the real problem', () => {
    const result = scoreWindow(astroWindowConfig, {
      ...input('2026-06-21'),
      night: night('2026-06-21', { lat: 49, lon: MUNICH.lon }),
    })
    expect(result.killers).toHaveLength(1)
    expect(result.killers[0]!.id).toBe('darkness')
  })

  it('kills a winter night where the core never clears the floor while dark', () => {
    // In December the core is a daytime object from Munich.
    const result = scoreWindow(astroWindowConfig, input('2026-12-15'))
    expect(result.gated).toBe(true)
    expect(result.killers.map((k) => k.id)).toContain('core-altitude')
    expect(result.killers.find((k) => k.id === 'core-altitude')!.reason).toContain(
      `${MIN_CORE_ALTITUDE}° floor`,
    )
  })

  it('kills a bright moon that is up during the window', () => {
    // 2026-08-27 is a waxing gibbous well above the horizon after dark.
    const august27 = input('2026-08-27')
    expect(august27.night.moonIllumination).toBeGreaterThan(MAX_MOON_ILLUMINATION)
    const result = scoreWindow(astroWindowConfig, august27)
    expect(result.killers.map((k) => k.id)).toContain('moon')
    expect(result.killers.find((k) => k.id === 'moon')!.reason).toMatch(/above the horizon/)
  })

  it('forgives a bright moon that has already set', () => {
    const base = night('2026-08-15')
    const forged = {
      ...input('2026-08-15'),
      night: { ...base, moonIllumination: 0.9 },
    }
    // The August 15 moon sets at 19:24 UTC, well before the 20:33 dark start.
    expect(peakMoonAltitude(forged.night)).toBeLessThan(0)
    expect(scoreWindow(astroWindowConfig, forged).gated).toBe(false)
  })

  it('kills a bright moon that never sets during a window-less night', () => {
    const base = night('2026-12-15')
    const forged = { ...input('2026-12-15'), night: { ...base, moonIllumination: 0.9 } }
    const result = scoreWindow(astroWindowConfig, forged)
    expect(result.killers.map((k) => k.id)).toContain('core-altitude')
  })
})

describe('weighted factors', () => {
  const clear = input('2026-08-15')

  it('scores a perfectly clear, dark, transparent night near 100', () => {
    const result = scoreWindow(astroWindowConfig, { ...clear, bortle: 1 })
    expect(result.score).toBe(100)
    expect(result.coverage).toBe(1)
    expect(result.verdict).toBe('excellent')
  })

  it('punishes low cloud hardest', () => {
    const low = scoreWindow(astroWindowConfig, { ...clear, cloudLow: 40 })
    const mid = scoreWindow(astroWindowConfig, { ...clear, cloudMid: 40 })
    const high = scoreWindow(astroWindowConfig, { ...clear, cloudHigh: 40 })
    expect(low.score).toBeLessThan(mid.score)
    expect(mid.score).toBeLessThan(high.score)
  })

  it('zeroes the low-cloud factor once cover passes the ruin threshold', () => {
    const result = scoreWindow(astroWindowConfig, { ...clear, cloudLow: 60 })
    expect(result.factors.find((f) => f.id === 'cloud-low')!.value).toBe(0)
  })

  it('weights transparency above sky darkness', () => {
    expect(ASTRO_WEIGHTS.transparency).toBeGreaterThan(ASTRO_WEIGHTS.bortle)
    const haze = scoreWindow(astroWindowConfig, { ...clear, transparency: 8 })
    const bright = scoreWindow(astroWindowConfig, { ...clear, bortle: 9 })
    expect(haze.score).toBeLessThan(bright.score)
  })

  it('prefers the Alpenvorland over Munich, all else equal', () => {
    const alpenvorland = scoreWindow(astroWindowConfig, { ...clear, bortle: 4 })
    const munich = scoreWindow(astroWindowConfig, { ...clear, bortle: 8 })
    expect(alpenvorland.score).toBeGreaterThan(munich.score)
  })

  it('never scores seeing — it is irrelevant at 12 mm', () => {
    expect(astroWindowConfig.factors.map((f) => f.id)).not.toContain('seeing')
  })

  it('degrades coverage rather than the score when an upstream is missing', () => {
    const result = scoreWindow(astroWindowConfig, { ...clear, bortle: 1, transparency: null })
    expect(result.coverage).toBeLessThan(1)
    expect(result.factors.find((f) => f.id === 'transparency')!.value).toBeNull()
    // Everything that *did* report is perfect, so the score stays 100 — only
    // the confidence in it drops.
    expect(result.score).toBe(100)
  })

  it('carries a human-readable detail per factor', () => {
    const result = scoreWindow(astroWindowConfig, { ...clear, cloudLow: 12, bortle: 4 })
    expect(result.factors.find((f) => f.id === 'cloud-low')!.detail).toBe('12%')
    expect(result.factors.find((f) => f.id === 'bortle')!.detail).toBe('Bortle 4')
    expect(result.factors.find((f) => f.id === 'transparency')!.detail).toBe('band 1/8')
  })
})

describe('window helpers', () => {
  it('restricts evaluation samples to the recommended window', () => {
    const resolved = night('2026-08-15')
    const samples = evaluationSamples(resolved)
    expect(samples.length).toBeGreaterThan(5)
    for (const sample of samples) {
      expect(sample.time >= resolved.window!.start).toBe(true)
      expect(sample.time <= resolved.window!.end).toBe(true)
    }
  })

  it('falls back to the dark stretch when there is no window', () => {
    const resolved = night('2026-12-15')
    expect(resolved.window).toBeNull()
    const samples = evaluationSamples(resolved)
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.every((s) => s.astroDark)).toBe(true)
  })

  it('reports the core’s peak during darkness, not its peak overall', () => {
    const resolved = night('2026-08-15')
    const duringDark = peakCoreAltitudeInDarkness(resolved)!
    const overall = resolved.samples.reduce((m, s) => Math.max(m, s.coreAltitude), -90)
    expect(duringDark).toBeLessThan(overall)
    expect(duringDark).toBeCloseTo(resolved.window!.peakCoreAltitude, 5)
  })
})
