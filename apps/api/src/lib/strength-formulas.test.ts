import { describe, it, expect } from 'bun:test'
import {
  sessionInol,
  velocityPctPerDay,
  velocityAtDate,
  strengthDirection,
  computeAcwrSeries,
  volumeLandmarks,
  dotsAdjusted,
  computeStrengthRatios,
  findPRPoints,
  buildOneRmSeries,
  buildCompositeSeries,
  detectAchievements,
  classifyAcwrZone,
  trailingRateKgPerWeek,
  classifyWeightPhase,
  type WorkoutWithSets,
} from './strength-formulas.js'

function mkWorkout(
  id: number,
  exercise_id: string,
  date: string,
  sets: Array<{ set_type: string; weight_kg: number; reps: number }>,
  estimated_1rm: number | null,
  total_volume: number,
): WorkoutWithSets {
  return {
    id,
    date,
    exercise_id,
    exercise_name: exercise_id,
    sets,
    estimated_1rm,
    total_volume,
  }
}

describe('sessionInol', () => {
  it('returns null when estimated_1rm is missing', () => {
    const w = mkWorkout(
      1,
      'bench_press',
      '2025-01-01',
      [{ set_type: 'work', weight_kg: 80, reps: 5 }],
      null,
      400,
    )
    expect(sessionInol(w, 80)).toBeNull()
  })

  it('computes INOL for one heavy set', () => {
    // best1rm=100, set 80×5 → pct=80, INOL = 5/(100-80) = 0.25
    const w = mkWorkout(
      1,
      'bench_press',
      '2025-01-01',
      [{ set_type: 'work', weight_kg: 80, reps: 5 }],
      100,
      400,
    )
    const inol = sessionInol(w, 80)
    expect(inol).toBeCloseTo(0.25, 4)
  })

  it('clamps pct to 40..99 range', () => {
    // best1rm=100, very light set 30×3 → pct clamped to 40, INOL = 3/60 = 0.05
    const w = mkWorkout(
      1,
      'bench_press',
      '2025-01-01',
      [{ set_type: 'work', weight_kg: 30, reps: 3 }],
      100,
      90,
    )
    expect(sessionInol(w, 80)).toBeCloseTo(0.05, 4)
  })

  it('adds bodyweight for pull-ups', () => {
    // pull-up: weight=20, bw=80, effective=100. best1rm=100, pct=99 (clamped). INOL=5/(100-99)=5.
    const w = mkWorkout(
      1,
      'pull_ups',
      '2025-01-01',
      [{ set_type: 'work', weight_kg: 20, reps: 5 }],
      100,
      500,
    )
    expect(sessionInol(w, 80)).toBeCloseTo(5, 4)
  })

  it('skips warmup and oor-reps sets', () => {
    const w = mkWorkout(
      1,
      'bench_press',
      '2025-01-01',
      [
        { set_type: 'warmup', weight_kg: 60, reps: 5 },
        { set_type: 'work', weight_kg: 80, reps: 15 }, // oor reps
        { set_type: 'work', weight_kg: 80, reps: 5 },
      ],
      100,
      0,
    )
    expect(sessionInol(w, 80)).toBeCloseTo(0.25, 4)
  })
})

describe('velocityPctPerDay', () => {
  it('returns null with fewer than 2 valid e1RM points', () => {
    const w = [mkWorkout(1, 'bench_press', '2025-01-01', [], 100, 0)]
    expect(velocityPctPerDay(w)).toBeNull()
  })

  it('computes a positive slope as %/day', () => {
    // Three sessions, e1rm 100 → 110 → 120, equal spacing 7 days each.
    // windowStart = latest.date - 28 = 2024-12-25; days from start: 7, 14, 21.
    // OLS slope = (10/7) ≈ 1.4286; / latest e1rm (120) * 100 ≈ 1.19 %/day.
    const w = [
      mkWorkout(1, 'bench_press', '2025-01-01', [], 100, 0),
      mkWorkout(2, 'bench_press', '2025-01-08', [], 110, 0),
      mkWorkout(3, 'bench_press', '2025-01-15', [], 120, 0),
    ]
    const v = velocityPctPerDay(w)
    expect(v).not.toBeNull()
    expect(v!).toBeGreaterThan(1.0)
    expect(v!).toBeLessThan(1.4)
  })
})

describe('strengthDirection', () => {
  it('null → stable', () => {
    expect(strengthDirection(null)).toBe('stable')
  })
  it('> 0.1 → improving', () => {
    expect(strengthDirection(0.2)).toBe('improving')
  })
  it('< -0.05 → declining', () => {
    expect(strengthDirection(-0.1)).toBe('declining')
  })
  it('between thresholds → stable', () => {
    expect(strengthDirection(0.05)).toBe('stable')
    expect(strengthDirection(-0.02)).toBe('stable')
  })
})

describe('computeAcwrSeries', () => {
  it('returns empty when fewer than 2 weeks of data', () => {
    const w = [mkWorkout(1, 'bench_press', '2025-01-01', [], 100, 1000)]
    expect(computeAcwrSeries(w)).toHaveLength(0)
  })

  it('builds EWMA-based acute and chronic series, seeded equal at first week', () => {
    // Four weeks of constant tonnage 1000; ACWR ratio stays 1.0.
    const w = [
      mkWorkout(1, 'bench_press', '2025-01-05', [], 100, 1000), // week-end Sun
      mkWorkout(2, 'bench_press', '2025-01-12', [], 100, 1000),
      mkWorkout(3, 'bench_press', '2025-01-19', [], 100, 1000),
      mkWorkout(4, 'bench_press', '2025-01-26', [], 100, 1000),
    ]
    const series = computeAcwrSeries(w)
    expect(series.length).toBeGreaterThanOrEqual(4)
    // First point: acute === chronic (both seeded at 1000).
    expect(series[0]!.acwr).toBeCloseTo(1.0, 5)
    expect(series[0]!.zone).toBe('optimal')
  })

  it('classifies zone correctly when acute exceeds chronic', () => {
    // Spike workout from 1000 to 10000 → acute > chronic (after seed).
    const w = [
      mkWorkout(1, 'bench_press', '2025-01-05', [], 100, 1000),
      mkWorkout(2, 'bench_press', '2025-01-12', [], 100, 1000),
      mkWorkout(3, 'bench_press', '2025-01-19', [], 100, 1000),
      mkWorkout(4, 'bench_press', '2025-01-26', [], 100, 1000),
      mkWorkout(5, 'bench_press', '2025-02-02', [], 100, 5000),
      mkWorkout(6, 'bench_press', '2025-02-09', [], 100, 5000),
    ]
    const series = computeAcwrSeries(w)
    // After spike, acute should rise faster than chronic → ratio > 1.
    const last = series[series.length - 1]!
    expect(last.acwr).not.toBeNull()
    expect(last.acwr!).toBeGreaterThan(1.0)
  })
})

describe('classifyAcwrZone', () => {
  it('maps thresholds correctly', () => {
    expect(classifyAcwrZone(null)).toBeNull()
    expect(classifyAcwrZone(0.5)).toBe('undertrained')
    expect(classifyAcwrZone(1.0)).toBe('optimal')
    expect(classifyAcwrZone(1.4)).toBe('caution')
    expect(classifyAcwrZone(1.6)).toBe('danger')
  })
})

describe('volumeLandmarks', () => {
  it('computes p25/p50/p90 via linear interpolation', () => {
    // 4 weeks with tonnage 100,200,300,400 → sorted [100,200,300,400].
    // p25 = idx 0.75 → 100 + 0.75×(200-100) = 175
    // p50 = idx 1.5  → 200 + 0.5×(300-200) = 250
    // p90 = idx 2.7  → 300 + 0.7×(400-300) = 370
    const w = [
      mkWorkout(1, 'bench_press', '2025-01-05', [], 100, 100),
      mkWorkout(2, 'bench_press', '2025-01-12', [], 100, 200),
      mkWorkout(3, 'bench_press', '2025-01-19', [], 100, 300),
      mkWorkout(4, 'bench_press', '2025-01-26', [], 100, 400),
    ]
    const lm = volumeLandmarks(w)
    expect(lm.mev).toBeCloseTo(175, 1)
    expect(lm.mav).toBeCloseTo(250, 1)
    expect(lm.mrv).toBeCloseTo(370, 1)
  })
})

describe('dotsAdjusted', () => {
  it('produces a known reference value for 100kg male at 80kg BW', () => {
    // Hand-compute denominator for sanity:
    // A=-307.75076 + B*80 + C*80^2 + D*80^3 + E*80^4
    // ≈ -307.75 + 1927.21 + -1228.01 + 378.43 + -44.77 ≈ 725.10
    // coefficient ≈ 500 / 725.10 ≈ 0.6896 → DOTS for 100kg ≈ 68.96
    const dots = dotsAdjusted(100, 80, 'male')
    expect(dots).toBeGreaterThan(65)
    expect(dots).toBeLessThan(72)
  })

  it('female coefficient is different from male', () => {
    expect(dotsAdjusted(100, 80, 'female')).not.toBeCloseTo(dotsAdjusted(100, 80, 'male'), 1)
  })
})

describe('computeStrengthRatios', () => {
  it('emits 4 pairs with hasData false when nothing logged', () => {
    const m = new Map()
    const r = computeStrengthRatios(m, 80, 'male')
    expect(r.pairs).toHaveLength(4)
    expect(r.hasData).toBe(false)
  })

  it('computes DL/Squat ratio in balanced range', () => {
    const m = new Map<string, WorkoutWithSets[]>()
    m.set('deadlift', [mkWorkout(1, 'deadlift', '2025-01-01', [], 200, 0)])
    m.set('squat', [mkWorkout(2, 'squat', '2025-01-01', [], 180, 0)])
    const r = computeStrengthRatios(m, 80, 'male')
    const dlSquat = r.pairs.find((p) => p.label === 'DL / Squat')!
    // Both DOTS-adjusted use same bw/gender so ratio simplifies to 200/180 ≈ 1.11.
    expect(dlSquat.ratio).toBeCloseTo(1.11, 1)
    expect(dlSquat.status).toBe('balanced')
  })

  it('pull-up uses raw added weight, null when no added weight', () => {
    const m = new Map<string, WorkoutWithSets[]>()
    m.set('pull_ups', [
      mkWorkout(
        1,
        'pull_ups',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 0, reps: 5 }],
        null,
        0,
      ),
    ])
    const r = computeStrengthRatios(m, 80, 'male')
    const pu = r.pairs.find((p) => p.label === 'Pull-up / BW')!
    expect(pu.ratio).toBeNull()
  })
})

describe('findPRPoints', () => {
  it('emits a PR when current value exceeds running max (and skips first session)', () => {
    const ws: WorkoutWithSets[] = [
      mkWorkout(
        1,
        'bench_press',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 80, reps: 5 }],
        90,
        0,
      ),
      mkWorkout(
        2,
        'bench_press',
        '2025-01-08',
        [{ set_type: 'work', weight_kg: 85, reps: 5 }],
        95,
        0,
      ),
      mkWorkout(
        3,
        'bench_press',
        '2025-01-15',
        [{ set_type: 'work', weight_kg: 90, reps: 5 }],
        100,
        0,
      ),
    ]
    const bw = () => 80
    const prs = findPRPoints(ws, 'max_weight', bw)
    expect(prs).toHaveLength(2)
    expect(prs[0]!.date).toBe('2025-01-08')
    expect(prs[1]!.date).toBe('2025-01-15')
  })

  it('does not emit PR when value plateaus', () => {
    const ws: WorkoutWithSets[] = [
      mkWorkout(
        1,
        'bench_press',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 80, reps: 5 }],
        90,
        0,
      ),
      mkWorkout(
        2,
        'bench_press',
        '2025-01-08',
        [{ set_type: 'work', weight_kg: 80, reps: 5 }],
        90,
        0,
      ),
    ]
    const bw = () => 80
    const prs = findPRPoints(ws, 'max_weight', bw)
    expect(prs).toHaveLength(0)
  })
})

// Regression: the `workouts` table has no unique index on (date, exercise_id) and
// POST /workouts does no existence check, so two sessions of the same lift on one
// calendar day are storable and do occur. Both date-keyed series must fold same-date
// workouts into a single point — otherwise a categorical date x-axis silently drops
// one of the two (last-wins, no error). Best-e1RM-per-date is the established answer.
describe('buildOneRmSeries — same-date fold', () => {
  it('folds two same-date workouts into one point, keeping the higher-e1RM session', () => {
    const ws: WorkoutWithSets[] = [
      mkWorkout(
        1,
        'bench_press',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 80, reps: 5 }],
        90,
        400,
      ),
      mkWorkout(
        2,
        'bench_press',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 100, reps: 3 }],
        110,
        300,
      ),
    ]
    const bwAt = () => 80
    const points = buildOneRmSeries(ws, bwAt)
    expect(points).toHaveLength(1)
    expect(points[0]!.date).toBe('2025-01-01')
    expect(points[0]!.e1rm).toBe(110)
    expect(points[0]!.volume).toBe(300)
  })

  it('keeps distinct dates separate — the fold only collapses genuine duplicates', () => {
    const ws: WorkoutWithSets[] = [
      mkWorkout(
        1,
        'bench_press',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 80, reps: 5 }],
        90,
        400,
      ),
      mkWorkout(
        2,
        'bench_press',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 100, reps: 3 }],
        110,
        300,
      ),
      mkWorkout(
        3,
        'bench_press',
        '2025-01-08',
        [{ set_type: 'work', weight_kg: 105, reps: 3 }],
        115,
        315,
      ),
    ]
    const bwAt = () => 80
    const points = buildOneRmSeries(ws, bwAt)
    expect(points).toHaveLength(2)
    expect(points.map((p) => p.date)).toEqual(['2025-01-01', '2025-01-08'])
  })
})

const bench = (id: number, date: string, e1rm: number) =>
  mkWorkout(id, 'bench_press', date, [], e1rm, 1000)
const flatBw = () => 80

describe('velocityAtDate — same-date fold', () => {
  it('regresses one point per DATE, so a duplicated day cannot double-weight the slope', () => {
    // The slope is an OLS fit over (day, e1RM) pairs. Two sessions on one date sit at the SAME x,
    // so before the fold they were two pairs and tilted the fit toward that date. (Tonnage
    // legitimately sums both sessions — a sum is not a fit, which is why only this one folds.)
    const base = [
      bench(1, '2026-01-01', 100),
      bench(2, '2026-01-15', 110),
      bench(3, '2026-01-20', 105),
    ]
    const withDuplicate = [...base, bench(4, '2026-01-15', 108)]
    expect(velocityAtDate(withDuplicate, '2026-01-20')).toBe(velocityAtDate(base, '2026-01-20'))
  })

  it('is unaffected by the order two same-date rows arrive in', () => {
    const a = bench(7, '2026-02-10', 120)
    const b = bench(9, '2026-02-10', 118)
    const earlier = bench(1, '2026-02-01', 100)
    expect(velocityAtDate([earlier, a, b], '2026-02-10')).toBe(
      velocityAtDate([earlier, b, a], '2026-02-10'),
    )
  })
})

describe('bestWorkoutPerDate — tie-break determinism', () => {
  it('resolves an identical-e1RM same-date tie by id, not by row order', () => {
    // `loadWorkoutsRange` orders by date alone, so Postgres may return these two in either order.
    const a = mkWorkout(7, 'bench_press', '2026-02-01', [], 100, 1000)
    const b = mkWorkout(9, 'bench_press', '2026-02-01', [], 100, 2000)
    const forward = buildOneRmSeries([a, b], flatBw)
    const reversed = buildOneRmSeries([b, a], flatBw)
    expect(forward).toHaveLength(1)
    expect(reversed).toHaveLength(1)
    expect(forward[0]).toEqual(reversed[0]!)
  })
})

describe('buildCompositeSeries — same-date fold', () => {
  it('folds two same-date workouts into one point, reflecting the higher-e1RM session', () => {
    const ws: WorkoutWithSets[] = [
      mkWorkout(
        1,
        'bench_press',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 80, reps: 5 }],
        90,
        400,
      ),
      mkWorkout(
        2,
        'bench_press',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 100, reps: 3 }],
        110,
        300,
      ),
    ]
    const bwAt = () => 80
    const points = buildCompositeSeries(ws, bwAt)
    expect(points).toHaveLength(1)
    expect(points[0]!.date).toBe('2025-01-01')
    // inolRaw must come from the higher-e1RM (110) session, not the 90 one.
    const inolFromHigherE1rm = sessionInol(ws[1]!, 80)
    expect(points[0]!.inolRaw).toBeCloseTo(inolFromHigherE1rm!, 6)
  })
})

describe('detectAchievements', () => {
  it('returns first_workout when history is empty', () => {
    const ach = detectAchievements(
      'bench_press',
      [{ set_type: 'work', weight_kg: 80, reps: 5 }],
      [],
      80,
    )
    expect(ach).toHaveLength(1)
    expect(ach[0]!.type).toBe('first_workout')
    expect(ach[0]!.confetti).toBe(true)
  })

  it('detects max_weight_pr when topping previous best', () => {
    const history = [
      mkWorkout(
        1,
        'bench_press',
        '2025-01-01',
        [{ set_type: 'work', weight_kg: 80, reps: 5 }],
        90,
        400,
      ),
    ]
    const ach = detectAchievements(
      'bench_press',
      [{ set_type: 'work', weight_kg: 90, reps: 5 }],
      history,
      80,
    )
    const types = ach.map((a) => a.type)
    expect(types).toContain('max_weight_pr')
    expect(types).toContain('estimated_1rm_pr')
  })

  it('returns empty when maxWeight is zero', () => {
    // All warmup sets → maxWeight=0 in eligible filter.
    const ach = detectAchievements(
      'bench_press',
      [{ set_type: 'warmup', weight_kg: 60, reps: 5 }],
      [],
      80,
    )
    expect(ach).toHaveLength(0)
  })
})

describe('trailingRateKgPerWeek + classifyWeightPhase', () => {
  it('detects a steady loss across 28 days as kg/week negative', () => {
    const entries = [
      { date: '2025-01-01', weight_kg: 82 },
      { date: '2025-01-15', weight_kg: 81 },
      { date: '2025-01-29', weight_kg: 80 },
    ]
    const rate = trailingRateKgPerWeek(entries)
    expect(rate).not.toBeNull()
    expect(rate!).toBeLessThan(0)
    const { phase, intensity } = classifyWeightPhase(rate)
    expect(phase).toBe('losing')
    expect(intensity).toMatch(/cut/i)
  })

  it('classifies < 0.1 kg/wk as maintaining', () => {
    expect(classifyWeightPhase(0.05).phase).toBe('maintaining')
    expect(classifyWeightPhase(-0.05).phase).toBe('maintaining')
  })

  it('returns null rate for single entry', () => {
    expect(trailingRateKgPerWeek([{ date: '2025-01-01', weight_kg: 80 }])).toBeNull()
  })
})
