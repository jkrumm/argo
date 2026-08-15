import { describe, expect, it } from 'bun:test'
import {
  bandScore,
  circularMean,
  DEFAULT_BANDS,
  GATED_VERDICT,
  linearScore,
  scoreWindow,
  type WindowConfig,
} from './window-score.js'

type Input = {
  altitude: number
  cloud: number | null
  haze: number | null
}

const config: WindowConfig<Input> = {
  gates: [
    {
      id: 'altitude',
      label: 'Altitude',
      evaluate: (input) =>
        input.altitude > 8
          ? { passes: true }
          : { passes: false, reason: `peaks at ${input.altitude}°, below the 8° floor` },
    },
  ],
  factors: [
    {
      id: 'cloud',
      label: 'Cloud',
      weight: 3,
      value: (i) => linearScore(i.cloud, { good: 0, bad: 100 }),
    },
    { id: 'haze', label: 'Haze', weight: 1, value: (i) => bandScore(i.haze, 8) },
  ],
}

describe('scoreWindow', () => {
  it('kills the window and names the reason when a gate fails', () => {
    const result = scoreWindow(config, { altitude: 6.2, cloud: 0, haze: 1 })
    expect(result.gated).toBe(true)
    expect(result.score).toBe(0)
    expect(result.verdict).toBe(GATED_VERDICT)
    expect(result.killers).toEqual([
      { id: 'altitude', label: 'Altitude', reason: 'peaks at 6.2°, below the 8° floor' },
    ])
    expect(result.factors).toEqual([])
  })

  it('reports every failing gate, not just the first', () => {
    const twoGates: WindowConfig<Input> = {
      ...config,
      gates: [
        ...config.gates,
        {
          id: 'cloud-gate',
          label: 'Cloud',
          evaluate: (i) =>
            i.cloud !== null && i.cloud < 90
              ? { passes: true }
              : { passes: false, reason: 'overcast' },
        },
      ],
    }
    const result = scoreWindow(twoGates, { altitude: 2, cloud: 95, haze: 1 })
    expect(result.killers.map((k) => k.id)).toEqual(['altitude', 'cloud-gate'])
  })

  it('falls back to a generic reason when a gate omits one', () => {
    const silent: WindowConfig<Input> = {
      gates: [{ id: 'x', label: 'Moon', evaluate: () => ({ passes: false }) }],
      factors: [],
    }
    expect(scoreWindow(silent, { altitude: 12, cloud: 0, haze: 1 }).killers[0]?.reason).toBe(
      'Moon failed',
    )
  })

  it('weights factors and normalises to 0..100', () => {
    // cloud 20% -> 0.8 (weight 3); haze band 1 -> 1.0 (weight 1)
    // (3*0.8 + 1*1.0) / 4 = 0.85
    const result = scoreWindow(config, { altitude: 12, cloud: 20, haze: 1 })
    expect(result.score).toBe(85)
    expect(result.coverage).toBe(1)
    expect(result.verdict).toBe('excellent')
  })

  it('drops missing factors from both numerator and denominator', () => {
    // haze is null -> only cloud counts. 0.8 / 1 = 80, coverage 3/4.
    const result = scoreWindow(config, { altitude: 12, cloud: 20, haze: null })
    expect(result.score).toBe(80)
    expect(result.coverage).toBe(0.75)
    expect(result.factors.find((f) => f.id === 'haze')?.value).toBeNull()
    expect(result.factors.find((f) => f.id === 'haze')?.weighted).toBeNull()
  })

  it('scores 0 with zero coverage when no factor has data', () => {
    const result = scoreWindow(config, { altitude: 12, cloud: null, haze: null })
    expect(result.score).toBe(0)
    expect(result.coverage).toBe(0)
    expect(result.gated).toBe(false)
  })

  it('clamps out-of-range factor values instead of trusting them', () => {
    const wild: WindowConfig<Input> = {
      gates: [],
      factors: [{ id: 'wild', label: 'Wild', weight: 1, value: () => 4 }],
    }
    expect(scoreWindow(wild, { altitude: 12, cloud: 0, haze: 1 }).score).toBe(100)
  })

  it('bands the score, and never bands a gated window', () => {
    const bands = DEFAULT_BANDS.map((b) => b.verdict)
    expect(bands).toEqual(['excellent', 'good', 'marginal', 'poor'])
    // (3*0.70 + 1*0.857) / 4 = 0.739
    expect(scoreWindow(config, { altitude: 12, cloud: 30, haze: 2 }).verdict).toBe('good')
    // (3*0.55 + 1*0.714) / 4 = 0.591
    expect(scoreWindow(config, { altitude: 12, cloud: 45, haze: 3 }).verdict).toBe('marginal')
    // (3*0.25 + 1*0.286) / 4 = 0.259
    expect(scoreWindow(config, { altitude: 12, cloud: 75, haze: 6 }).verdict).toBe('poor')
    expect(scoreWindow(config, { altitude: 1, cloud: 0, haze: 1 }).verdict).toBe(GATED_VERDICT)
  })
})

describe('linearScore', () => {
  it('maps a less-is-better quantity onto 0..1', () => {
    expect(linearScore(0, { good: 0, bad: 100 })).toBe(1)
    expect(linearScore(20, { good: 0, bad: 100 })).toBeCloseTo(0.8, 10)
    expect(linearScore(100, { good: 0, bad: 100 })).toBe(0)
  })

  it('clamps outside the range', () => {
    expect(linearScore(-10, { good: 0, bad: 100 })).toBe(1)
    expect(linearScore(140, { good: 0, bad: 100 })).toBe(0)
  })

  it('inverts when good > bad, for more-is-better quantities', () => {
    // Swell period: 14 s good, 6 s bad.
    expect(linearScore(14, { good: 14, bad: 6 })).toBe(1)
    expect(linearScore(10, { good: 14, bad: 6 })).toBeCloseTo(0.5, 10)
    expect(linearScore(4, { good: 14, bad: 6 })).toBe(0)
  })

  it('returns null for missing data rather than 0', () => {
    expect(linearScore(null, { good: 0, bad: 100 })).toBeNull()
    expect(linearScore(undefined, { good: 0, bad: 100 })).toBeNull()
    expect(linearScore(Number.NaN, { good: 0, bad: 100 })).toBeNull()
  })

  it('degenerates to a step function when the range has zero span', () => {
    expect(linearScore(5, { good: 5, bad: 5 })).toBe(1)
    expect(linearScore(6, { good: 5, bad: 5 })).toBe(0)
  })
})

describe('bandScore', () => {
  it('maps a 1..n band where 1 is best', () => {
    expect(bandScore(1, 8)).toBe(1)
    expect(bandScore(8, 8)).toBe(0)
    expect(bandScore(4, 8)).toBeCloseTo(1 - 3 / 7, 10)
  })

  it('returns null for missing data', () => {
    expect(bandScore(null, 8)).toBeNull()
    expect(bandScore(undefined, 8)).toBeNull()
  })

  it('treats a single-band scale as always perfect', () => {
    expect(bandScore(1, 1)).toBe(1)
  })
})

describe('circularMean', () => {
  it('averages bearings across north instead of through south', () => {
    // The whole reason this exists: the arithmetic mean of 350 and 10 is 180.
    expect(circularMean([350, 10])).toBeCloseTo(0, 6)
    expect(circularMean([355, 5, 15])).toBeCloseTo(5, 6)
  })

  it('agrees with the arithmetic mean when nothing wraps', () => {
    expect(circularMean([100, 110, 120])).toBeCloseTo(110, 6)
  })

  it('returns a bearing in [0, 360)', () => {
    const value = circularMean([340, 20])!
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(360)
  })

  it('returns null when the bearings box the compass', () => {
    // Four opposed directions cancel — there is no meaningful average.
    expect(circularMean([0, 90, 180, 270])).toBeNull()
    expect(circularMean([0, 180])).toBeNull()
  })

  it('returns null for an empty set', () => {
    expect(circularMean([])).toBeNull()
  })

  it('still answers for a merely spread-out set', () => {
    expect(circularMean([80, 100, 120])).toBeCloseTo(100, 4)
  })
})
