import { describe, it, expect } from 'bun:test'
import {
  activityScore,
  classifyAcwrZone,
  fitnessDirection,
  linearRegressionSlope,
  movingAverage,
  percentile,
  recoveryScore,
  recoveryScoreSeries,
  stdDev,
  trainingLoad,
  zScore,
  RECOVERY_WEIGHT_HRV,
  RECOVERY_WEIGHT_SLEEP,
  RECOVERY_WEIGHT_RHR,
} from './garmin-formulas.js'

describe('activityScore', () => {
  it('returns null when all inputs zero/null', () => {
    expect(activityScore({ vigorousMin: null, moderateMin: null, steps: null })).toBeNull()
    expect(activityScore({ vigorousMin: 0, moderateMin: 0, steps: 0 })).toBeNull()
  })

  it('combines vigorous + moderate + walking MET-min de-double-counting steps', () => {
    // vig=10, mod=20, steps=5000
    // vigorousScore = 10 * 8 = 80
    // moderateScore = 20 * 4 = 80
    // walkingSteps = max(0, 5000 - (10+20)*100) = max(0, 5000 - 3000) = 2000
    // walkingScore = 2000 * 0.03 = 60
    // Total = 80 + 80 + 60 = 220
    expect(activityScore({ vigorousMin: 10, moderateMin: 20, steps: 5000 })).toBe(220)
  })

  it('clamps walking steps to zero when intensity dwarfs total steps', () => {
    // vig=20, mod=20 → 4000 step credit, steps=1000 → walkingSteps=0
    // Total = 20*8 + 20*4 + 0 = 240
    expect(activityScore({ vigorousMin: 20, moderateMin: 20, steps: 1000 })).toBe(240)
  })
})

describe('recoveryScore', () => {
  it('returns null when all components null', () => {
    const r = recoveryScore({
      hrv: null,
      avgHrv: null,
      sleepScore: null,
      restingHr: null,
      minRhr: null,
      maxRhr: null,
    })
    expect(r.recovery).toBeNull()
  })

  it('hand-calculated weighted average with all three components, no penalty', () => {
    // HRV at parity (50/50 = 100% → 100 * 0.4 = 40)
    // Sleep 80 → 80 * 0.35 = 28
    // RHR 50, min 40, max 60 → pct = (1 - 10/20)*100 = 50 → 50 * 0.25 = 12.5
    // weightedSum = 40 + 28 + 12.5 = 80.5
    // totalWeight = 1.0
    // raw = 80.5 → round = 81
    const r = recoveryScore({
      hrv: 50,
      avgHrv: 50,
      sleepScore: 80,
      restingHr: 50,
      minRhr: 40,
      maxRhr: 60,
    })
    expect(RECOVERY_WEIGHT_HRV + RECOVERY_WEIGHT_SLEEP + RECOVERY_WEIGHT_RHR).toBe(1)
    expect(r.recovery).toBe(81)
    expect(r.components.hrv).toBe(40)
    expect(r.components.sleep).toBe(28)
    expect(r.components.rhr).toBe(12.5)
  })

  it('redistributes weight when HRV component is null', () => {
    // Sleep 80 → 80 * 0.35 = 28
    // RHR 50, min 40, max 60 → 50 → 50 * 0.25 = 12.5
    // weightedSum = 40.5, totalWeight = 0.6
    // raw = 40.5 / 0.6 = 67.5 → round = 68
    const r = recoveryScore({
      hrv: null,
      avgHrv: null,
      sleepScore: 80,
      restingHr: 50,
      minRhr: 40,
      maxRhr: 60,
    })
    expect(r.recovery).toBe(68)
    expect(r.components.hrv).toBeNull()
  })

  it('applies strain-debt penalty proportional to yesterday/ceiling', () => {
    // raw = 100, yesterday = 500, ceiling = 1000 → strainDebt = 0.5
    // penalty = 0.5 * 0.3 = 0.15
    // final = round(100 * (1 - 0.15)) = 85
    const r = recoveryScore({
      hrv: 50,
      avgHrv: 50,
      sleepScore: 100,
      restingHr: 40,
      minRhr: 40,
      maxRhr: 60,
      yesterdayActivityScore: 500,
      ceiling: 1000,
    })
    // raw: HRV 40 + Sleep 35 + RHR 25 = 100
    expect(r.strainDebt).toBe(0.5)
    expect(r.penalty).toBe(0.15)
    expect(r.recovery).toBe(85)
  })

  it('caps strain-debt at 1.0 even when yesterday > ceiling', () => {
    const r = recoveryScore({
      hrv: 50,
      avgHrv: 50,
      sleepScore: 100,
      restingHr: 40,
      minRhr: 40,
      maxRhr: 60,
      yesterdayActivityScore: 2000,
      ceiling: 1000,
    })
    expect(r.strainDebt).toBe(1)
    expect(r.penalty).toBe(0.3)
    expect(r.recovery).toBe(70)
  })
})

describe('recoveryScoreSeries', () => {
  it('produces one point per input row in ascending date order', () => {
    const out = recoveryScoreSeries([
      {
        date: '2025-01-02',
        hrv: 55,
        sleepScore: 80,
        restingHr: 50,
        activityScore: 600,
        bbHighest: 90,
      },
      {
        date: '2025-01-01',
        hrv: 50,
        sleepScore: 75,
        restingHr: 55,
        activityScore: 400,
        bbHighest: 85,
      },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]?.date).toBe('2025-01-01')
    expect(out[1]?.date).toBe('2025-01-02')
    expect(out[0]?.bbHigh).toBe(85)
  })
})

describe('classifyAcwrZone', () => {
  it('classifies all four zones from Gabbett 2016 (BJSM)', () => {
    expect(classifyAcwrZone(0.5)).toBe('undertrained')
    expect(classifyAcwrZone(0.79)).toBe('undertrained')
    expect(classifyAcwrZone(0.8)).toBe('optimal')
    expect(classifyAcwrZone(1.0)).toBe('optimal')
    expect(classifyAcwrZone(1.3)).toBe('optimal')
    expect(classifyAcwrZone(1.31)).toBe('caution')
    expect(classifyAcwrZone(1.5)).toBe('caution')
    expect(classifyAcwrZone(1.51)).toBe('danger')
    expect(classifyAcwrZone(2.0)).toBe('danger')
  })

  it('returns null for null acwr', () => {
    expect(classifyAcwrZone(null)).toBeNull()
  })
})

describe('trainingLoad', () => {
  it('seeds EWMA from first day so initial ACWR = 1.0 (optimal)', () => {
    const out = trainingLoad([
      { date: '2025-01-01', dailyLoad: 500 },
      { date: '2025-01-02', dailyLoad: 500 },
    ])
    expect(out[0]?.acute).toBe(500)
    expect(out[0]?.chronic).toBe(500)
    expect(out[0]?.acwr).toBe(1)
    expect(out[0]?.zone).toBe('optimal')
    expect(out[0]?.divergence).toBe(0)
  })

  it('acute responds faster than chronic to a load spike', () => {
    const out = trainingLoad([
      { date: '2025-01-01', dailyLoad: 100 },
      { date: '2025-01-02', dailyLoad: 100 },
      { date: '2025-01-03', dailyLoad: 1000 },
    ])
    const spike = out[2]!
    expect(spike.acute).toBeGreaterThan(spike.chronic ?? 0)
    expect(spike.divergence).toBeGreaterThan(0)
    expect(spike.divPos).toBeGreaterThan(0)
    expect(spike.divNeg).toBe(0)
  })

  it('returns empty array for empty input', () => {
    expect(trainingLoad([])).toEqual([])
  })
})

describe('fitnessDirection', () => {
  it('returns Stable signal with insufficient data', () => {
    const r = fitnessDirection([
      { date: '2025-01-01', restingHr: 55, hrv: 50, vo2Max: 45 },
      { date: '2025-01-02', restingHr: 55, hrv: 50, vo2Max: 45 },
    ])
    expect(r.signal).toBe('stable')
  })

  it('detects improving when RHR trending down and HRV trending up', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      // RHR decreasing by 1/day
      restingHr: 60 - i,
      // HRV increasing by 2/day
      hrv: 30 + i * 2,
      vo2Max: 45,
    }))
    const r = fitnessDirection(rows)
    expect(r.signal).toBe('improving')
    expect(r.label).toBe('Improving')
    expect(r.symbol).toBe('▲')
    expect(r.vo2max).toBe(45)
  })

  it('detects declining when both trends reverse', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      restingHr: 50 + i,
      hrv: 60 - i * 2,
      vo2Max: 45,
    }))
    const r = fitnessDirection(rows)
    expect(r.signal).toBe('declining')
  })
})

describe('helpers', () => {
  it('percentile (nearest-rank)', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
    expect(percentile([], 0.5)).toBeNull()
  })

  it('stdDev (sample, n-1 denominator)', () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] → sd ≈ 2.138
    const sd = stdDev([2, 4, 4, 4, 5, 5, 7, 9])
    expect(sd).not.toBeNull()
    expect(Math.round((sd as number) * 100) / 100).toBe(2.14)
  })

  it('linearRegressionSlope basic monotonic series', () => {
    const slope = linearRegressionSlope([1, 2, 3, 4, 5])
    expect(slope).toBe(1)
  })

  it('linearRegressionSlope returns null below 3 valid points', () => {
    expect(linearRegressionSlope([1, 2])).toBeNull()
    expect(linearRegressionSlope([null, 1, 2])).toBeNull()
  })

  it('movingAverage requires min(3, window) non-null', () => {
    const ma = movingAverage([1, 2, 3, 4, 5], 3)
    expect(ma[0]).toBeNull() // only 1 value
    expect(ma[1]).toBeNull() // 2 values
    expect(ma[2]).toBe(2) // (1+2+3)/3
    expect(ma[3]).toBe(3) // (2+3+4)/3
  })

  it('zScore flips sign for RHR-style metrics', () => {
    const values = [50, 55, 60]
    const z = zScore(50, values)
    const zFlipped = zScore(50, values, { flipped: true })
    expect(z).not.toBeNull()
    expect(zFlipped).toBe(-(z as number))
  })
})
