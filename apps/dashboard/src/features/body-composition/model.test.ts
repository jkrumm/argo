import { describe, expect, test } from 'bun:test'
import {
  ageLabel,
  dayKey,
  daysBetween,
  deltaFromMean,
  entryAgeDays,
  goalProgress,
  isStale,
  changeOverDays,
  intensityBand,
  meanOverDays,
  windowDays,
  siteRows,
  signed,
  summarySentence,
  weightDeltaPolarity,
  windowLabel,
} from './model'

describe('dates', () => {
  test('dayKey is the local calendar day', () => {
    expect(dayKey(new Date(2026, 9, 17, 23, 59).getTime())).toBe('2026-10-17')
  })
  test('daysBetween counts calendar days across a month end', () => {
    expect(daysBetween('2026-09-28', '2026-10-17')).toBe(19)
  })
  test('entryAgeDays uses the newest entry and is never negative', () => {
    const pts = [{ date: '2026-10-01' }, { date: '2026-10-10' }]
    expect(entryAgeDays(pts, '2026-10-17')).toBe(7)
    expect(entryAgeDays(pts, '2026-10-05')).toBe(0)
    expect(entryAgeDays([], '2026-10-17')).toBeNull()
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
    expect(signed(-0.34, 2)).toBe('−0.34')
    expect(signed(0.4, 1)).toBe('+0.4')
  })
  test('a value that rounds to zero carries no sign; null is a dash', () => {
    expect(signed(-0.004, 2)).toBe('0.00')
    expect(signed(null)).toBe('—')
  })
})

describe('goalProgress', () => {
  test('losing toward a lower goal', () => {
    const p = goalProgress({ start: 90, current: 85, goal: 80 })
    expect(p?.toGo).toBe(5)
    expect(p?.span).toBe(10)
    expect(p?.moved).toBe(5)
  })
  test('gaining toward a higher goal', () => {
    expect(goalProgress({ start: 70, current: 72, goal: 75 })?.moved).toBe(2)
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
    expect(summarySentence({ current: 84.26, kgPerWeek: -0.34, goal: 80, ageDays: 3 })).toBe(
      '84.3 kg, −0.34 kg/wk, 4.3 kg to the 80.0 kg goal; last weigh-in 3 days ago.',
    )
  })
  test('no goal drops the distance clause', () => {
    expect(summarySentence({ current: 84, kgPerWeek: 0.2, goal: null, ageDays: 0 })).toBe(
      '84.0 kg, +0.20 kg/wk; last weigh-in today.',
    )
  })
  test('unknown rate is a dash, never 0', () => {
    expect(summarySentence({ current: 84, kgPerWeek: null, goal: null, ageDays: null })).toBe(
      '84.0 kg, — kg/wk.',
    )
  })
  test('empty window', () => {
    expect(summarySentence({ current: null, kgPerWeek: null, goal: 80, ageDays: null })).toBe(
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
})

describe('siteRows', () => {
  const points = [
    {
      date: '2026-10-10',
      average: 15,
      readings: [
        { site: 'abdominal' as const, valueMm: 20 },
        { site: 'suprailiac' as const, valueMm: 10 },
      ],
    },
    {
      date: '2026-09-10',
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
      priorDate: '2026-09-10',
    })
    expect(rows[1]).toMatchObject({ site: 'suprailiac', values: [10], delta: null, current: 10 })
  })
  test('a site with no reading is unknown', () => {
    const rows = siteRows([], [])
    expect(rows.every((r) => r.current === null && r.delta === null)).toBe(true)
  })
})

describe('day-based window stats', () => {
  const pts = [
    { date: '2026-09-02', weightKg: 80 },
    { date: '2026-09-20', weightKg: 79 },
    { date: '2026-09-28', weightKg: 78 },
    { date: '2026-10-01', weightKg: 77 },
  ]
  test('mean and change are anchored on the newest entry', () => {
    expect(meanOverDays(pts, 7, null)).toBeCloseTo(77.5)
    expect(changeOverDays(pts, 7, null)).toBe(-1)
    expect(meanOverDays(pts, 30, null)).toBeCloseTo(78.5)
    expect(changeOverDays(pts, 30, null)).toBe(-3)
  })
  test('a window shorter than the period cannot state it', () => {
    expect(meanOverDays(pts, 30, 7)).toBeNull()
    expect(changeOverDays(pts, 30, 7)).toBeNull()
  })
  test('one entry has no change', () => {
    expect(changeOverDays([pts[0]!], 7, null)).toBeNull()
    expect(meanOverDays([], 7, null)).toBeNull()
  })
  test('windowDays', () => {
    expect(windowDays({ window: '90d' })).toBe(90)
    expect(windowDays({ window: 'all' })).toBeNull()
    expect(windowDays({ from: '2026-10-01', to: '2026-10-10' })).toBe(10)
  })
})

describe('intensityBand', () => {
  test('cut and bulk tiers follow the API thresholds', () => {
    expect(intensityBand(0.05)).toBe('< 0.1 kg/wk')
    expect(intensityBand(0.16)).toBe('0.1\u20130.3 kg/wk')
    expect(intensityBand(0.45)).toBe('0.3\u20130.6 kg/wk')
    expect(intensityBand(0.7)).toBe('\u2265 0.6 kg/wk')
    expect(intensityBand(-0.3)).toBe('0.1\u20130.4 kg/wk')
    expect(intensityBand(-0.9)).toBe('\u2265 0.8 kg/wk')
    expect(intensityBand(null)).toBeNull()
  })
})
