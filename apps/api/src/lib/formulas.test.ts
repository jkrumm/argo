import { describe, it, expect } from 'bun:test'
import { makeBodyweightResolver, computeMetrics, deriveTrend, computeStats } from './formulas.js'

describe('makeBodyweightResolver', () => {
  it('returns profile fallback when entries array is empty', () => {
    const resolve = makeBodyweightResolver([], 75)
    expect(resolve('2024-01-01')).toBe(75)
  })

  it('returns earliest weight for dates before first entry', () => {
    const entries = [{ date: '2024-02-01', weight_kg: 80 }]
    const resolve = makeBodyweightResolver(entries, 75)
    expect(resolve('2024-01-01')).toBe(80)
  })

  it('forward-fills from most recent entry at or before date', () => {
    const entries = [
      { date: '2024-01-01', weight_kg: 78 },
      { date: '2024-03-01', weight_kg: 80 },
    ]
    const resolve = makeBodyweightResolver(entries, 75)
    expect(resolve('2024-02-01')).toBe(78)
    expect(resolve('2024-04-01')).toBe(80)
  })

  it('returns exact entry weight when date matches', () => {
    const entries = [{ date: '2024-06-01', weight_kg: 82 }]
    const resolve = makeBodyweightResolver(entries, 75)
    expect(resolve('2024-06-01')).toBe(82)
  })
})

describe('computeMetrics', () => {
  it('computes Epley, Brzycki and average e1rm for a work set', () => {
    // Epley: 100 × (1 + 5/30) = 116.666… → 116.7
    // Brzycki: (100 × 36) / (37 - 5) = 3600 / 32 = 112.5
    // avg: (116.7 + 112.5) / 2 = 114.6
    const sets = [{ set_type: 'work', weight_kg: 100, reps: 5 }]
    const result = computeMetrics(sets, 'bench_press', 80)
    expect(result.estimated_1rm_epley).toBe(116.7)
    expect(result.estimated_1rm_brzycki).toBe(112.5)
    expect(result.estimated_1rm).toBe(114.6)
    expect(result.total_volume).toBe(500)
  })

  it('adds bodyweight for pull-ups in volume and e1rm', () => {
    // ew = 0 + 80 = 80; volume = 80 × 5 = 400
    // Epley: 80 × (1 + 5/30) = 93.333… → 93.3
    // Brzycki: (80 × 36) / (37 - 5) = 2880 / 32 = 90.0
    // avg: (93.3 + 90.0) / 2 = 91.65 → 91.7 (Math.round rounds .5 up)
    const sets = [{ set_type: 'work', weight_kg: 0, reps: 5 }]
    const result = computeMetrics(sets, 'pull_ups', 80)
    expect(result.total_volume).toBe(400)
    expect(result.estimated_1rm_epley).toBe(93.3)
    expect(result.estimated_1rm_brzycki).toBe(90)
    expect(result.estimated_1rm).toBe(91.7)
  })

  it('returns null e1rm for warmup sets', () => {
    const sets = [{ set_type: 'warmup', weight_kg: 60, reps: 5 }]
    const result = computeMetrics(sets, 'bench_press', 80)
    expect(result.estimated_1rm).toBeNull()
    expect(result.estimated_1rm_epley).toBeNull()
    expect(result.estimated_1rm_brzycki).toBeNull()
    expect(result.total_volume).toBe(300)
  })

  it('ignores reps > 12 for e1rm but still counts volume', () => {
    const sets = [{ set_type: 'work', weight_kg: 100, reps: 15 }]
    const result = computeMetrics(sets, 'bench_press', 80)
    expect(result.estimated_1rm).toBeNull()
    expect(result.total_volume).toBe(1500)
  })

  it('returns only Epley (no Brzycki) when reps > 10', () => {
    // Epley: 100 × (1 + 11/30) = 136.666… → 136.7; Brzycki requires reps ≤ 10
    const sets = [{ set_type: 'work', weight_kg: 100, reps: 11 }]
    const result = computeMetrics(sets, 'bench_press', 80)
    expect(result.estimated_1rm_epley).toBe(136.7)
    expect(result.estimated_1rm_brzycki).toBeNull()
    expect(result.estimated_1rm).toBe(136.7)
  })

  it('picks best e1rm across multiple sets', () => {
    const sets = [
      { set_type: 'work', weight_kg: 80, reps: 5 },
      { set_type: 'work', weight_kg: 100, reps: 5 },
    ]
    const result = computeMetrics(sets, 'bench_press', 80)
    // best e1rm should come from 100 kg × 5
    expect(result.estimated_1rm).toBe(114.6)
    expect(result.total_volume).toBe(80 * 5 + 100 * 5)
  })
})

describe('deriveTrend', () => {
  it('returns "up" when ma7 exceeds ma30 by more than 0.5%', () => {
    expect(deriveTrend(101, 100)).toBe('up')
  })

  it('returns "down" when ma7 is below ma30 by more than 0.5%', () => {
    expect(deriveTrend(99, 100)).toBe('down')
  })

  it('returns "flat" when within 0.5% threshold', () => {
    expect(deriveTrend(100.2, 100)).toBe('flat')
  })

  it('returns "flat" when ma7 is null', () => {
    expect(deriveTrend(null, 100)).toBe('flat')
  })

  it('returns "flat" when ma30 is null', () => {
    expect(deriveTrend(100, null)).toBe('flat')
  })

  it('returns "flat" when ma30 is zero (avoids division by zero)', () => {
    expect(deriveTrend(1, 0)).toBe('flat')
  })
})

describe('computeStats', () => {
  it('returns all nulls and flat trend for empty input', () => {
    const result = computeStats([])
    expect(result.current).toBeNull()
    expect(result.ma7).toBeNull()
    expect(result.ma30).toBeNull()
    expect(result.trend).toBe('flat')
  })

  it('uses most-recent-first ordering — first element is current', () => {
    const result = computeStats([50, 60, 70])
    expect(result.current).toBe(50)
  })

  it('computes ma7 and ma30 with correct slice boundaries', () => {
    // values[0..6] → ma7; values[0..29] → ma30
    // [70, 71, 72, 73, 74, 75, 76, 77, 78, 79] (10 elements, most-recent first)
    // ma7 = avg(70..76) = 511/7 = 73.0; ma30 = avg(70..79) = 745/10 = 74.5
    const values = [70, 71, 72, 73, 74, 75, 76, 77, 78, 79]
    const result = computeStats(values)
    expect(result.current).toBe(70)
    expect(result.ma7).toBe(73)
    expect(result.ma30).toBe(74.5)
    expect(result.trend).toBe('down')
  })

  it('filters out null values before computing averages', () => {
    const result = computeStats([null, 80, null, 70])
    expect(result.current).toBe(80)
    expect(result.ma7).toBe(75)
    expect(result.ma30).toBe(75)
  })
})
