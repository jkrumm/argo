import { describe, expect, it } from 'bun:test'
import { resolveNight, type NightOptions } from './astro-night.js'
import { findSite } from './astro-sites.js'
import {
  ASTRO_WEIGHTS,
  astroWindowConfig,
  CORE_CLEARANCE_RANGE,
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

function night(
  date: string,
  observer = MUNICH,
  overrides: Partial<Pick<NightOptions, 'horizonDeg' | 'framingMarginDeg'>> = {},
) {
  return resolveNight({
    observer,
    timeZone: TZ,
    date,
    minCoreAltitude: MIN_CORE_ALTITUDE,
    ...overrides,
  })
}

function input(date: string, weather: Partial<AstroScoreInput> = {}): AstroScoreInput {
  return {
    night: night(date),
    cloudLow: 0,
    cloudMid: 0,
    cloudHigh: 0,
    transparency: 1,
    coreDirectionMpsas: 19.7,
    coreClearanceDeg: null,
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

describe('terrain-aware gates', () => {
  const MUNICH_SITE = findSite('munich')!

  // Munich never clears ~13°, well under a uniform 20° ridge plus framing margin.
  const WALL_HORIZON = Array.from({ length: 72 }, () => 20)

  it('kills a night on the ridge and names it, not the flat floor', () => {
    const result = scoreWindow(
      astroWindowConfig,
      input('2026-08-15', { night: night('2026-08-15', MUNICH, { horizonDeg: WALL_HORIZON }) }),
    )
    expect(result.gated).toBe(true)
    const killer = result.killers.find((k) => k.id === 'core-altitude')
    expect(killer).toBeDefined()
    expect(killer!.reason).toMatch(/ridge to the south stands at 20(\.0)?°/)
    expect(killer!.reason).not.toMatch(new RegExp(`${MIN_CORE_ALTITUDE}° floor`))
  })

  it('does NOT blame the ridge on a night the ridge had nothing to do with', () => {
    /*
     * Munich in December: the core peaks around −20°, twelve degrees below even
     * the flat floor, and the site's real skyline is 0.97°. Attributing that to
     * terrain would be false twice — the ridge is not the tighter floor, and the
     * core is nowhere near either of them. Regression for exactly that wording.
     */
    const result = scoreWindow(
      astroWindowConfig,
      input('2026-12-15', {
        night: night('2026-12-15', MUNICH, { horizonDeg: MUNICH_SITE.horizonDeg }),
      }),
    )
    const killer = result.killers.find((k) => k.id === 'core-altitude')
    expect(killer).toBeDefined()
    expect(killer!.reason).not.toMatch(/ridge/)
    expect(killer!.reason).toMatch(/below the 8° floor$/)
  })

  it('keeps the flat-floor wording verbatim when no profile was supplied', () => {
    const result = scoreWindow(astroWindowConfig, input('2026-12-15'))
    const killer = result.killers.find((k) => k.id === 'core-altitude')
    expect(killer!.reason).toMatch(/^core peaks at -?[\d.]+° during darkness, below the 8° floor$/)
    expect(killer!.reason).not.toMatch(/ridge/)
  })

  it('rescues a bright moon that sits behind the measured ridge, not just below the horizon', () => {
    // 2026-08-27: a waxing gibbous well above the horizon after dark at flat
    // terrain (the ungated case fails — see the "hard gates" block above).
    const flat = scoreWindow(astroWindowConfig, input('2026-08-27'))
    expect(flat.killers.map((k) => k.id)).toContain('moon')

    // Directional ridge: 25° blocking the moon's own sector (it sits around
    // azimuth 134–142° through the window that night), left low (3°, well
    // under the flat 8° floor) everywhere the core actually crosses — so the
    // core still clears and only the moon is the thing terrain changes.
    const MOON_WALL = Array.from({ length: 72 }, (_, i) => (i >= 23 && i <= 32 ? 25 : 3))
    const withRidge = scoreWindow(
      astroWindowConfig,
      input('2026-08-27', {
        night: night('2026-08-27', MUNICH, { horizonDeg: MOON_WALL }),
      }),
    )
    expect(withRidge.gated).toBe(false)
    expect(withRidge.killers.map((k) => k.id)).not.toContain('moon')
  })
})

describe('weighted factors', () => {
  const clear = input('2026-08-15')

  it('scores a perfectly clear, dark, transparent night near 100', () => {
    const result = scoreWindow(astroWindowConfig, {
      ...clear,
      coreDirectionMpsas: 21.5,
      coreClearanceDeg: CORE_CLEARANCE_RANGE.good,
    })
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
    expect(ASTRO_WEIGHTS.transparency).toBeGreaterThan(ASTRO_WEIGHTS.coreDarkness)
    const haze = scoreWindow(astroWindowConfig, { ...clear, transparency: 8 })
    const bright = scoreWindow(astroWindowConfig, { ...clear, coreDirectionMpsas: 17.3 })
    expect(haze.score).toBeLessThan(bright.score)
  })

  it('prefers the Alpenvorland over Munich, all else equal', () => {
    const alpenvorland = scoreWindow(astroWindowConfig, { ...clear, coreDirectionMpsas: 19.7 })
    const munich = scoreWindow(astroWindowConfig, { ...clear, coreDirectionMpsas: 17.31 })
    expect(alpenvorland.score).toBeGreaterThan(munich.score)
  })

  // The decision this whole rework exists to make. Bayerischer Wald has the
  // darker ZENITH (21.57 vs 21.55) and twice the drive; Walchensee is darker
  // where the camera actually points (19.98 vs 19.76), because its light dome —
  // Munich — sits behind the lens rather than across the core. Scoring the
  // zenith, or a hand-typed whole-sky class, gets this backwards.
  it('ranks Walchensee above Bayerischer Wald at equal weather, despite its brighter zenith', () => {
    const walchensee = findSite('walchensee')!
    const wald = findSite('bayerischer-wald')!

    expect(walchensee.mpsas).toBeLessThan(wald.mpsas)
    expect(walchensee.coreDirectionMpsas).toBeGreaterThan(wald.coreDirectionMpsas)

    const atWalchensee = scoreWindow(astroWindowConfig, {
      ...clear,
      coreDirectionMpsas: walchensee.coreDirectionMpsas,
    })
    const atWald = scoreWindow(astroWindowConfig, {
      ...clear,
      coreDirectionMpsas: wald.coreDirectionMpsas,
    })
    expect(atWalchensee.score).toBeGreaterThan(atWald.score)
  })

  it('never scores seeing — it is irrelevant at 12 mm', () => {
    expect(astroWindowConfig.factors.map((f) => f.id)).not.toContain('seeing')
  })

  it('degrades coverage rather than the score when an upstream is missing', () => {
    const result = scoreWindow(astroWindowConfig, {
      ...clear,
      coreDirectionMpsas: 21.5,
      transparency: null,
    })
    expect(result.coverage).toBeLessThan(1)
    expect(result.factors.find((f) => f.id === 'transparency')!.value).toBeNull()
    // Everything that *did* report is perfect, so the score stays 100 — only
    // the confidence in it drops.
    expect(result.score).toBe(100)
  })

  it('carries a human-readable detail per factor', () => {
    const result = scoreWindow(astroWindowConfig, {
      ...clear,
      cloudLow: 12,
      coreDirectionMpsas: 19.7,
    })
    expect(result.factors.find((f) => f.id === 'cloud-low')!.detail).toBe('12%')
    expect(result.factors.find((f) => f.id === 'core-darkness')!.detail).toBe('19.70 mag/arcsec²')
    expect(result.factors.find((f) => f.id === 'transparency')!.detail).toBe('band 1/8')
  })

  it('drops the clearance factor out of coverage rather than scoring it 0 when no profile was supplied', () => {
    const result = scoreWindow(astroWindowConfig, { ...clear, coreClearanceDeg: null })
    expect(result.factors.find((f) => f.id === 'core-clearance')!.value).toBeNull()
    expect(result.coverage).toBeLessThan(1)
  })

  // The decision §4.1 exists to show: clearance and darkness rank the same
  // four sites in OPPOSITE order. Walchensee has the darkest core direction of
  // the set and the tightest clearance; Munich is the flattest and brightest.
  it('orders the four committed sites by peak clearance, reversing the darkness ranking', () => {
    // docs/ASTRO-HORIZON-RESEARCH.md §4.1, "Peak clearance" column, degrees —
    // the raw measurement is strictly ordered Munich > Wald > Alpenvorland >
    // Walchensee.
    const PEAK_CLEARANCE = {
      munich: 12.5,
      alpenvorland: 10.5,
      'bayerischer-wald': 11.9,
      walchensee: 8.5,
    } as const
    expect(PEAK_CLEARANCE.munich).toBeGreaterThan(PEAK_CLEARANCE['bayerischer-wald'])
    expect(PEAK_CLEARANCE['bayerischer-wald']).toBeGreaterThan(PEAK_CLEARANCE.alpenvorland)
    expect(PEAK_CLEARANCE.alpenvorland).toBeGreaterThan(PEAK_CLEARANCE.walchensee)

    const clearanceValue = (id: keyof typeof PEAK_CLEARANCE) =>
      scoreWindow(astroWindowConfig, {
        ...clear,
        coreClearanceDeg: PEAK_CLEARANCE[id],
      }).factors.find((f) => f.id === 'core-clearance')!.value!

    // CORE_CLEARANCE_RANGE.good = 10° — every site at or above that ceiling
    // (Munich, Wald, Alpenvorland) reads as equally "plenty of sky", which is
    // the intended saturation, not a bug; only Walchensee sits below it.
    expect(clearanceValue('munich')).toBe(1)
    expect(clearanceValue('bayerischer-wald')).toBe(1)
    expect(clearanceValue('alpenvorland')).toBe(1)
    expect(clearanceValue('walchensee')).toBeLessThan(1)

    // The reversal against darkness: Walchensee is the darkest of the four
    // where the core sits, and yet the worst of the four on clearance.
    expect(findSite('walchensee')!.coreDirectionMpsas).toBeGreaterThan(
      findSite('munich')!.coreDirectionMpsas,
    )
    expect(findSite('walchensee')!.coreDirectionMpsas).toBeGreaterThan(
      findSite('bayerischer-wald')!.coreDirectionMpsas,
    )
    expect(clearanceValue('walchensee')).toBeLessThan(clearanceValue('munich'))
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
