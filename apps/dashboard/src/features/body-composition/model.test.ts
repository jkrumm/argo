// Every fixture is synthetic (round numbers, fixed dates); none is a real reading.
import { describe, expect, test } from 'bun:test'
import {
  ageLabel,
  dayKey,
  daysBetween,
  deltaFromMean,
  entryAgeDays,
  goalProgress,
  intensityBand,
  isStale,
  meanOverDays,
  signed,
  siteRows,
  slopeOverDays,
  summarySentence,
  weightDeltaPolarity,
  weightWindowStats,
  windowDays,
  windowLabel,
} from './model'

/** `count` daily entries ending 2026-06-30, weight moving `perDay` kg a day from `start`. */
function daily(count: number, start: number, perDay: number) {
  return Array.from({ length: count }, (_, i) => ({
    date: dayKey(new Date(2026, 5, 30 - (count - 1 - i)).getTime()),
    weightKg: start + perDay * i,
  }))
}

describe('dates', () => {
  test('dayKey is the local calendar day', () => {
    expect(dayKey(new Date(2026, 5, 17, 23, 59).getTime())).toBe('2026-06-17')
  })
  test('dayKey and daysBetween hold across both DST changes', () => {
    expect(dayKey(new Date(2026, 2, 29, 0, 30).getTime())).toBe('2026-03-29')
    expect(dayKey(new Date(2026, 9, 25, 23, 30).getTime())).toBe('2026-10-25')
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })
  test('daysBetween counts calendar days across a month end', () => {
    expect(daysBetween('2026-05-28', '2026-06-17')).toBe(20)
  })
  test('entryAgeDays uses the newest entry and is never negative', () => {
    const pts = [{ date: '2026-06-01' }, { date: '2026-06-10' }]
    expect(entryAgeDays(pts, '2026-06-17')).toBe(7)
    expect(entryAgeDays(pts, '2026-06-05')).toBe(0)
    expect(entryAgeDays([], '2026-06-17')).toBeNull()
  })
  test('stale from exactly 14 days', () => {
    expect(isStale(13)).toBe(false)
    expect(isStale(14)).toBe(true)
    expect(isStale(null)).toBe(false)
  })
  test('ageLabel', () => {
    expect(ageLabel(0)).toBe('today')
    expect(ageLabel(1)).toBe('1 day ago')
    expect(ageLabel(9)).toBe('9 days ago')
  })
})

describe('signed', () => {
  test('uses a real minus and a plus', () => {
    expect(signed(-0.5, 2)).toBe('−0.50')
    expect(signed(0.5, 1)).toBe('+0.5')
  })
  test('a value that rounds to zero carries no sign; null is a dash', () => {
    expect(signed(-0.004, 2)).toBe('0.00')
    expect(signed(null)).toBe('—')
  })
})

describe('goalProgress', () => {
  test('losing toward a lower goal', () => {
    const p = goalProgress({ start: 90, current: 85, goal: 80 })
    expect(p).toEqual({ toGo: 5, span: 10, moved: 5 })
  })
  test('goal above the start: gaining is progress', () => {
    expect(goalProgress({ start: 70, current: 72, goal: 80 })).toEqual({
      toGo: 8,
      span: 10,
      moved: 2,
    })
  })
  test('goal above the start: losing weight clamps at zero progress', () => {
    expect(goalProgress({ start: 70, current: 68, goal: 80 })?.moved).toBe(0)
  })
  test('moving away clamps at zero; overshoot clamps at the goal', () => {
    expect(goalProgress({ start: 90, current: 92, goal: 80 })?.moved).toBe(0)
    const over = goalProgress({ start: 90, current: 70, goal: 80 })
    expect(over?.moved).toBe(10)
    expect(over?.toGo).toBe(10)
  })
  test('no span or unknown input is null', () => {
    expect(goalProgress({ start: 80, current: 80, goal: 80 })).toBeNull()
    expect(goalProgress({ start: 90, current: null, goal: 80 })).toBeNull()
    expect(goalProgress({ start: 90, current: 85, goal: null })).toBeNull()
  })
})

describe('weightDeltaPolarity', () => {
  test('a rise is good when the goal is above, bad when below', () => {
    expect(weightDeltaPolarity(70, 75)).toBe('up-good')
    expect(weightDeltaPolarity(90, 80)).toBe('up-bad')
    expect(weightDeltaPolarity(80, 80)).toBe('neutral')
    expect(weightDeltaPolarity(80, null)).toBe('neutral')
  })
})

test('deltaFromMean', () => {
  expect(deltaFromMean(80, 81)).toBe(-1)
  expect(deltaFromMean(null, 81)).toBeNull()
})

describe('summarySentence', () => {
  test('full sentence repeats the cell figures', () => {
    expect(summarySentence({ current: 80, kgPerWeek: -0.5, goal: 75, ageDays: 3 })).toBe(
      '80.0 kg, −0.50 kg/wk over 28 d, 5.0 kg to the 75.0 kg goal; last weigh-in 3 days ago.',
    )
  })
  test('no goal drops the distance clause', () => {
    expect(summarySentence({ current: 80, kgPerWeek: 0.5, goal: null, ageDays: 0 })).toBe(
      '80.0 kg, +0.50 kg/wk over 28 d; last weigh-in today.',
    )
  })
  test('unknown rate is a dash, never 0', () => {
    expect(summarySentence({ current: 80, kgPerWeek: null, goal: null, ageDays: null })).toBe(
      '80.0 kg, — kg/wk over 28 d.',
    )
  })
  test('empty window', () => {
    expect(summarySentence({ current: null, kgPerWeek: null, goal: 75, ageDays: null })).toBe(
      'No weigh-ins in this window.',
    )
  })
})

describe('windowLabel', () => {
  test('presets, all and custom', () => {
    expect(windowLabel({ window: '90d' })).toBe('90 days')
    expect(windowLabel({ window: 'all' })).toBe('all time')
    expect(windowLabel({ from: '2026-01-01', to: '2026-02-01' })).toBe('2026-01-01 to 2026-02-01')
  })
  test('windowDays', () => {
    expect(windowDays({ window: '90d' })).toBe(90)
    expect(windowDays({ window: 'all' })).toBeNull()
    expect(windowDays({ from: '2026-06-01', to: '2026-06-10' })).toBe(10)
  })
})

describe('day-based window stats', () => {
  test('a falling daily log: mean and slope are anchored on the newest entry', () => {
    const pts = daily(40, 100, -0.5)
    // Last 7 days: 100 - 0.5 * (33..39).
    expect(meanOverDays(pts, 7, null)).toBeCloseTo(100 - 0.5 * 36)
    expect(slopeOverDays(pts, 7, null)).toBeCloseTo(-3.5)
    expect(slopeOverDays(pts, 30, null)).toBeCloseTo(-3.5)
  })
  test('sparse log: two entries one day apart state no period', () => {
    const pts = [
      { date: '2026-06-29', weightKg: 80 },
      { date: '2026-06-30', weightKg: 79 },
    ]
    expect(meanOverDays(pts, 7, null)).toBeNull()
    expect(meanOverDays(pts, 30, null)).toBeNull()
    expect(slopeOverDays(pts, 7, null)).toBeNull()
    expect(slopeOverDays(pts, 30, null)).toBeNull()
  })
  test('one entry states no period', () => {
    expect(meanOverDays([{ date: '2026-06-30', weightKg: 80 }], 7, null)).toBeNull()
    expect(meanOverDays([], 7, null)).toBeNull()
  })
  test('coverage: 70 % of the period is the floor', () => {
    // 30 d needs entries spanning >= 21 days.
    expect(meanOverDays(daily(21, 80, 0), 30, null)).toBeNull()
    expect(meanOverDays(daily(22, 80, 0), 30, null)).toBe(80)
  })
  test('a window shorter than the period cannot state it', () => {
    const pts = daily(40, 80, 0)
    expect(meanOverDays(pts, 30, 7)).toBeNull()
    expect(slopeOverDays(pts, 30, 7)).toBeNull()
    expect(weightWindowStats(pts, 7).mean30).toBeNull()
    expect(weightWindowStats(pts, 7).mean7).toBe(80)
  })
  test('the footer slopes and the weights they come from agree in sign', () => {
    for (const perDay of [-0.5, 0.5]) {
      const pts = daily(40, 100, perDay)
      const stats = weightWindowStats(pts, null)
      const first = pts.at(0)!.weightKg
      const last = pts.at(-1)!.weightKg
      expect(Math.sign(stats.slope7!)).toBe(Math.sign(last - first))
      expect(Math.sign(stats.slope30!)).toBe(Math.sign(last - first))
    }
  })
  test('slope matches the exact line through synthetic points', () => {
    expect(slopeOverDays(daily(10, 80, 1), 10, null)).toBeCloseTo(7)
    expect(slopeOverDays(daily(10, 80, 0), 10, null)).toBe(0)
  })
})

describe('intensityBand', () => {
  test('cut and bulk tiers follow the API thresholds', () => {
    expect(intensityBand(0.05)).toBe('< 0.1 kg/wk')
    expect(intensityBand(0.2)).toBe('0.1–0.3 kg/wk')
    expect(intensityBand(0.5)).toBe('0.3–0.6 kg/wk')
    expect(intensityBand(0.7)).toBe('≥ 0.6 kg/wk')
    expect(intensityBand(-0.3)).toBe('0.1–0.4 kg/wk')
    expect(intensityBand(-0.9)).toBe('≥ 0.8 kg/wk')
    expect(intensityBand(null)).toBeNull()
  })
})

describe('siteRows', () => {
  const points = [
    {
      date: '2026-06-10',
      average: 15,
      readings: [
        { site: 'abdominal' as const, valueMm: 20 },
        { site: 'suprailiac' as const, valueMm: 10 },
      ],
    },
    {
      date: '2026-05-10',
      average: 17,
      readings: [{ site: 'abdominal' as const, valueMm: 24 }],
    },
  ]
  test('chronological values and delta since the previous session', () => {
    const rows = siteRows(points, [
      { site: 'abdominal', current: 20 },
      { site: 'suprailiac', current: 10 },
    ])
    expect(rows[0]).toMatchObject({
      site: 'abdominal',
      values: [24, 20],
      delta: -4,
      current: 20,
      priorDate: '2026-05-10',
    })
    expect(rows[1]).toMatchObject({ site: 'suprailiac', values: [10], delta: null, current: 10 })
  })
  test('a site with no reading is unknown', () => {
    const rows = siteRows([], [])
    expect(rows.every((r) => r.current === null && r.delta === null)).toBe(true)
  })
})
