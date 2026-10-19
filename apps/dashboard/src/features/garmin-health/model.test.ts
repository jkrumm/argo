import { lastVisibleDay } from './visibility'
import { describe, expect, test } from 'bun:test'
import { ACWR_ZONE_NAME, acwrMeterZones, acwrZoneLabel } from './formulas'
import { recoveryMeterProps } from './recovery-meter'
import {
  activitiesFact,
  activityScoreFact,
  ACWR_LEGEND,
  acwrFact,
  acwrRelation,
  ACWR_INFO,
  dayKeysBetween,
  fillDays,
  windowSpan,
  bodyBatteryFact,
  contributorItems,
  fitnessRowDelta,
  moveDelta,
  recoveryBasis,
  countWhere,
  dayLabel,
  divergenceFact,
  firstToLast,
  FITNESS_DAYS,
  fitnessGap,
  fitnessRange,
  fmtMinutes,
  fmtNum,
  hoursFromSec,
  lastDaysRange,
  lastScored,
  loadGap,
  chartEmpty,
  RECOVERY_GAP_METRIC,
  allocateForms,
  cadenceGap,
  gapLine,
  plainGap,
  mean,
  missingInputs,
  recoveryFact,
  recoveryGap,
  recoveryQualifier,
  recoveryVerdict,
  stressZone,
  STRESS_ZONE_LEGEND,
  STRESS_ZONE_NAME,
  loadCellBranch,
  loadMeterEmptyText,
  recoveryCellBranch,
  recoverySentence,
  shortDate,
  signed,
  sleepFact,
  stressFact,
  summaryParts,
  vo2Hero,
  windowCopyDays,
  windowDayCount,
} from './model'

const count = (range: { dateFrom?: string; dateTo?: string }, lastVisible: string) => {
  const { from, to } = windowSpan(range, '2026-04-15', '2026-10-01', lastVisible)
  return dayKeysBetween(from, to).length
}

describe('number formatting', () => {
  test('a null reading is an em dash, never 0', () => {
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(undefined, 1)).toBe('—')
    expect(fmtNum(Number.NaN)).toBe('—')
    expect(fmtNum(0)).toBe('0')
    expect(signed(null)).toBe('—')
  })

  test('signed uses a real minus and drops the sign on zero', () => {
    expect(signed(3)).toBe('+3')
    expect(signed(-2.4, 1)).toBe('−2.4')
    expect(signed(0)).toBe('0')
    expect(signed(-0.04, 1)).toBe('0.0')
  })

  test('minutes read as h and m', () => {
    expect(fmtMinutes(45)).toBe('45m')
    expect(fmtMinutes(120)).toBe('2h')
    expect(fmtMinutes(80)).toBe('1h 20m')
  })
})

describe('aggregates', () => {
  test('mean skips nulls and is null when nothing measured', () => {
    expect(mean([2, null, 4])).toBe(3)
    expect(mean([null, null])).toBeNull()
    expect(mean([])).toBeNull()
  })

  test('countWhere counts only measured days', () => {
    expect(countWhere([80, null, 50, 71], (v) => v >= 70)).toEqual({ hits: 2, days: 3 })
  })

  test('firstToLast is last minus first present value', () => {
    expect(firstToLast([null, 50, 52, null, 49])).toBe(-1)
    expect(firstToLast([null, null])).toBeNull()
  })
})

describe('summaryParts', () => {
  test('the sentence carries recovery and the load verdict, nothing else', () => {
    expect(summaryParts({ recovery: 62.4, acwr: 0.62 })).toEqual({
      sentence: 'Recovery 62/100, load under the 0.8 floor',
    })
  })

  test('a present recovery with no ACWR keeps the sentence short', () => {
    expect(summaryParts({ recovery: 80, acwr: null })).toEqual({ sentence: 'Recovery 80/100' })
  })

  test('a missing recovery leads with the load and states its reason', () => {
    expect(summaryParts({ recovery: null, recoveryDate: '2026-01-05', acwr: 0.62 }).sentence).toBe(
      'Load under the 0.8 floor; no recovery score for 5 Jan',
    )
  })

  test('a missing recovery and ACWR is the reason alone', () => {
    expect(summaryParts({ recovery: null, acwr: null })).toEqual({
      sentence: 'No recovery score for the latest day',
    })
  })

  test('acwrRelation follows the API cut-offs', () => {
    expect(acwrRelation(0.79)).toContain('under')
    expect(acwrRelation(0.8)).toContain('optimal')
    expect(acwrRelation(1.3)).toContain('optimal')
    expect(acwrRelation(1.31)).toContain('ceiling')
    expect(acwrRelation(1.51)).toContain('danger')
  })
})

describe('recoveryGap', () => {
  const today = new Date(2026, 0, 6)
  const last = { value: 61.6, date: '2026-01-01' }
  const settled = { status: 'success', settled: true, last, windowDays: 30, today } as const

  test('the headline names the day a missing score is missing for', () => {
    expect(recoveryGap({ date: '2026-01-06', today }).headline).toBe('no recovery score for today')
    expect(recoveryGap({ date: '2026-01-01', today }).headline).toBe('no recovery score for 1 Jan')
    expect(recoveryGap({ date: null, today }).headline).toBe('no recovery score for the latest day')
  })

  test('pending has no copy, error never claims a data gap', () => {
    expect(recoveryGap({ status: 'pending' })).toEqual({ headline: 'recovery loading', line: null })
    expect(recoveryGap({ status: 'error' })).toEqual({
      headline: 'the recovery score failed to load',
      line: { short: 'The recovery score failed to load', full: null },
    })
  })

  test('the cell line names the unscored day and what it could not score from', () => {
    expect(
      recoveryGap({ ...settled, date: '2026-01-06', missing: ['HRV', 'sleep'] }).line?.full,
    ).toBe(
      'Last scored 62/100 on 1\u00a0Jan\u00a0· today: HRV, sleep not scored — Garmin syncs every 6\u00a0h',
    )
    expect(
      recoveryGap({ ...settled, date: '2026-01-02', last: null, missing: ['RHR'] }).line?.full,
    ).toBe(
      'No recovery score in this 30\u00a0d window\u00a0· 2\u00a0Jan: RHR not scored — Garmin syncs every 6\u00a0h',
    )
  })

  test('with no date or nothing missing the line names no subject', () => {
    expect(recoveryGap({ ...settled, missing: ['HRV'] }).line?.full).toBe(
      'Last scored 62/100 on 1\u00a0Jan — Garmin syncs every 6\u00a0h',
    )
    expect(recoveryGap({ ...settled, date: '2026-01-06', missing: [] }).line?.full).toBe(
      'Last scored 62/100 on 1\u00a0Jan — Garmin syncs every 6\u00a0h',
    )
    expect(missingInputs({ hrv: null, sleep: 30, rhr: null })).toEqual(['HRV', 'RHR'])
    expect(missingInputs({ hrv: 1, sleep: 2, rhr: 3 })).toEqual([])
  })

  test('the cell line waits for the reads to settle', () => {
    expect(recoveryGap({ ...settled, settled: false }).line).toBeNull()
  })
  test('the last scored day carries its value and day, unit unspaced', () => {
    expect(recoveryGap(settled).line?.full).toBe(
      'Last scored 62/100 on 1\u00a0Jan — Garmin syncs every 6\u00a0h',
    )
  })
  test('no scored day states the window, or none when its length is unknown', () => {
    expect(recoveryGap({ ...settled, last: null }).line?.full).toBe(
      'No recovery score in this 30\u00a0d window — Garmin syncs every 6\u00a0h',
    )
    expect(recoveryGap({ ...settled, last: null, windowDays: 0 }).line?.full).toBe(
      'No recovery score in this window — Garmin syncs every 6\u00a0h',
    )
  })
})

describe('recovery load states', () => {
  test('a failed recovery query keeps the load and says so in the headline', () => {
    const { sentence } = summaryParts({
      recovery: null,
      recoveryStatus: 'error',
      acwr: 1,
    })
    expect(sentence).toBe(
      'Load inside the 0.8\u2060–\u20601.3 optimal band; the recovery score failed to load',
    )
    expect(sentence).not.toContain('HRV, sleep')
  })
})

describe('recoverySentence', () => {
  test('a pending recovery with no ACWR is never an empty headline', () => {
    expect(recoverySentence({ recovery: null, recoveryStatus: 'pending', load: null })).toBe(
      'Recovery loading',
    )
  })
  test('a score leads, its absence yields to the load', () => {
    expect(recoverySentence({ recovery: 70, load: 'load x' })).toBe('Recovery 70/100, load x')
    expect(recoverySentence({ recovery: null, recoveryStatus: 'error', load: 'load x' })).toBe(
      'Load x; the recovery score failed to load',
    )
  })
})

describe('contributorItems', () => {
  test('rows are points of their weight and an unmeasured component is left out', () => {
    expect(contributorItems({ hrv: 31.2, sleep: null, rhr: 20 })).toEqual([
      { label: 'HRV', value: 31.2, max: 40, key: 'HRV' },
      { label: 'RHR', value: 20, max: 25, key: 'RHR' },
    ])
  })
})

describe('recoveryBasis', () => {
  test('three contributors need no basis', () => {
    expect(recoveryBasis({ hrv: 1, sleep: 2, rhr: 3 })).toBeNull()
  })
  test('no contributor at all has no basis to state', () => {
    expect(recoveryBasis({ hrv: null, sleep: null, rhr: null })).toBeNull()
  })
  test('each missing contributor is named and the score names what it stands on', () => {
    expect(recoveryBasis({ hrv: null, sleep: null, rhr: 20 })).toBe(
      'HRV and sleep not scored — score from RHR only',
    )
    expect(recoveryBasis({ hrv: 30, sleep: null, rhr: 20 })).toBe(
      'Sleep not scored — score from HRV and RHR only',
    )
  })
})

describe('fitness row delta', () => {
  test('a fit prints the API change, coloured unless flat', () => {
    expect(fitnessRowDelta({ change: -6.5, flat: false, delta: -3 })).toEqual({
      kind: 'move',
      value: -6.5,
    })
    expect(fitnessRowDelta({ change: -0.3, flat: true, delta: 2 })).toEqual({
      kind: 'flat',
      value: -0.3,
    })
  })
  test('flat is checked before unchanged; a zero change that is not flat reads unchanged', () => {
    expect(fitnessRowDelta({ change: 0, flat: true, delta: 0 })).toEqual({ kind: 'flat', value: 0 })
    expect(fitnessRowDelta({ change: 0, flat: false, delta: 0 })).toEqual({ kind: 'unchanged' })
  })
  test('without a fit the last-minus-first delta prints plain, never lost', () => {
    expect(fitnessRowDelta({ change: null, flat: null, delta: 1 })).toEqual({
      kind: 'plain',
      value: 1,
    })
    expect(fitnessRowDelta({ change: null, flat: null, delta: 0 })).toEqual({ kind: 'unchanged' })
    expect(fitnessRowDelta({ change: null, flat: null, delta: null })).toEqual({ kind: 'none' })
  })
  test('moveDelta: none, unchanged, move', () => {
    expect(moveDelta(null)).toEqual({ kind: 'none' })
    expect(moveDelta(0)).toEqual({ kind: 'unchanged' })
    expect(moveDelta(0.7)).toEqual({ kind: 'move', value: 0.7 })
  })
})

describe('facts headers', () => {
  test('every header has a value, a unit and a comparison', () => {
    const facts = [
      activitiesFact({ sessions: 12, totalMin: 600, dayCount: 30 }),
      acwrFact({ acwr: 1.1, zoneLabel: 'Optimal', inZone: 20, dayCount: 30 }),
      divergenceFact({ divergence: -4.26, when: 'today' }),
      recoveryFact({ mean: 61.5, high: 9, dayCount: 30 }),
      sleepFact({ when: 'last night', hours: 7.25, score: 81, meanHours: 7.1, dayCount: 30 }),
      bodyBatteryFact({ when: 'today', net: -3, mean: 5, high: 90, low: 12, dayCount: 30 }),
      stressFact({ stress: 28, rest: 4, dayCount: 30 }),
      activityScoreFact({ when: 'today', score: 300, mean: 450, dayCount: 30 }),
    ]
    for (const f of facts) {
      expect(f.value).not.toBe('')
      expect(f.unit).toBeTruthy()
      expect(f.context.length).toBeGreaterThan(0)
    }
  })

  test('activity score states the share of the 600 target', () => {
    expect(
      activityScoreFact({ when: 'today', score: 300, mean: 450, dayCount: 30 }).context[0],
    ).toBe('50 % of the 600 target')
  })

  test('null readings become em dashes in the header', () => {
    const f = activityScoreFact({ when: '—', score: null, mean: null, dayCount: 0 })
    expect(f.value).toBe('—')
    expect(f.context.join(' ')).toContain('—')
    expect(
      sleepFact({ when: '—', hours: null, score: null, meanHours: null, dayCount: 0 }).value,
    ).toBe('—')
  })

  test('acwr names the zone and the days in it', () => {
    expect(acwrFact({ acwr: 1.1, zoneLabel: 'Optimal', inZone: 20, dayCount: 30 })).toEqual({
      value: '1.10',
      unit: 'ACWR',
      context: ['optimal', '20 of 30 d in the optimal zone'],
    })
  })

  test('singular session', () => {
    expect(activitiesFact({ sessions: 1, totalMin: 30, dayCount: 7 }).unit).toBe('session')
  })
})

describe('rounding and non-finite readings', () => {
  test('fmtMinutes rounds once before splitting, never "1h 60m" or "60m"', () => {
    expect(fmtMinutes(59.6)).toBe('1h')
    expect(fmtMinutes(119.5)).toBe('2h')
    expect(fmtMinutes(59.4)).toBe('59m')
    expect(fmtMinutes(0)).toBe('0m')
  })

  test('countWhere and firstToLast skip NaN and Infinity like mean does', () => {
    expect(countWhere([Number.NaN, 80, Number.POSITIVE_INFINITY, 50], (v) => v >= 70)).toEqual({
      hits: 1,
      days: 2,
    })
    expect(firstToLast([Number.NaN, 50, 54, Number.NaN])).toBe(4)
    expect(firstToLast([Number.NaN, Number.NaN])).toBeNull()
  })
})

describe('windows', () => {
  const today = new Date(2026, 9, 17)

  test('lastDaysRange is the last N calendar days ending today, independent of the selector', () => {
    expect(lastDaysRange(14, today)).toEqual({ from: '2026-10-04', to: '2026-10-17' })
    expect(lastDaysRange(1, today)).toEqual({ from: '2026-10-17', to: '2026-10-17' })
    expect(lastDaysRange(180, new Date(2026, 2, 1)).from).toBe('2025-09-03')
  })

  test('windowDayCount counts calendar days in the window, inclusive', () => {
    expect(windowDayCount({ dateFrom: '2026-10-11', dateTo: undefined }, '2026-04-15', today)).toBe(
      7,
    )
    expect(
      windowDayCount({ dateFrom: '2026-10-01', dateTo: '2026-10-10' }, '2026-04-15', today),
    ).toBe(10)
  })

  test('windowDayCount clips at the visible floor and runs an open start from it', () => {
    expect(
      windowDayCount({ dateFrom: '2026-01-01', dateTo: '2026-04-20' }, '2026-04-15', today),
    ).toBe(6)
    expect(windowDayCount({}, '2026-10-10', today)).toBe(8)
  })

  test('windowCopyDays reads the selected preset length, not the inclusive day count', () => {
    expect(windowCopyDays({ window: '7d' }, '2026-04-15', today)).toBe(7)
    expect(windowCopyDays({ window: '30d' }, '2026-04-15', today)).toBe(30)
    expect(windowCopyDays({ from: '2026-10-01', to: '2026-10-10' }, '2026-04-15', today)).toBe(10)
    expect(windowCopyDays({ window: '90d' }, '2026-10-05', today)).toBe(13)
  })

  test('windowDayCount is 0, not negative, for an empty window', () => {
    expect(
      windowDayCount({ dateFrom: '2026-11-01', dateTo: '2026-10-10' }, '2026-04-15', today),
    ).toBe(0)
  })
})

describe('null today', () => {
  test('a null final-day score renders a dash and no percentage', () => {
    const f = activityScoreFact({ when: '14 Oct', score: null, mean: 410, dayCount: 20 })
    expect(f.value).toBe('—')
    expect(f.context[0]).toBe('— % of the 600 target')
  })

  test('body battery uses one minus glyph and dashes for a missing day', () => {
    const f = bodyBatteryFact({
      when: '14 Oct',
      net: -12,
      mean: -3,
      high: null,
      low: null,
      dayCount: 9,
    })
    expect(f.value).toBe('−12')
    expect(f.context.join(' ')).toContain('−3 pts mean over 9 d')
    expect(f.context.join(' ')).toContain('high —/100, low —/100')
    expect(f.value.includes('-')).toBe(false)
  })

  test('activities states no rate and no "last 0 d" without a window length', () => {
    expect(activitiesFact({ sessions: 4, totalMin: 120, dayCount: 0 }).context).toEqual(['2h'])
    expect(activitiesFact({ sessions: 4, totalMin: 120, dayCount: 14 }).context).toEqual([
      '2h',
      '2.0 sessions per week',
      'last 14 d',
    ])
  })
})

describe('headers name the point they show', () => {
  const today = new Date(2026, 9, 17)

  test("dayLabel is derived from the point's own date", () => {
    expect(dayLabel('2026-10-17', 'day', today)).toBe('today')
    expect(dayLabel('2026-10-17', 'night', today)).toBe('last night')
    expect(dayLabel('2026-10-16', 'day', today)).toBe('16 Oct')
    expect(dayLabel('2026-10-16', 'night', today)).toBe('16 Oct')
    expect(dayLabel('2026-03-02', 'day', today)).toBe('2 Mar')
    expect(dayLabel(null, 'day', today)).toBe('—')
    expect(dayLabel(undefined, 'night', today)).toBe('—')
  })

  test('shortDate prints a real day in the page locale order', () => {
    expect(shortDate('2026-10-14')).toBe('14 Oct')
    expect(shortDate('2024-02-29')).toBe('29 Feb')
  })

  test('shortDate returns the raw key for anything that is not a calendar day', () => {
    for (const key of [
      '2026-13-01',
      '2026-10-xx',
      '2026-02-31',
      '2026-10-00',
      '2026-10',
      '2026-02-29',
      '',
    ]) {
      expect(shortDate(key)).toBe(key)
    }
  })

  test('a header for a historical point never says today or last night', () => {
    const when = dayLabel('2026-10-14', 'night', today)
    expect(sleepFact({ when, hours: 7, score: 80, meanHours: 7, dayCount: 9 }).unit).toBe(
      'h 14 Oct',
    )
    const day = dayLabel('2026-10-14', 'day', today)
    expect(activityScoreFact({ when: day, score: 100, mean: 200, dayCount: 9 }).unit).toBe(
      'MET-min 14 Oct',
    )
    expect(
      bodyBatteryFact({ when: day, net: 4, mean: 1, high: 90, low: 20, dayCount: 9 }).unit,
    ).toBe('pts net 14 Oct')
    expect(divergenceFact({ divergence: 1, when: day }).context).toContain('14 Oct')
  })
})

describe('shared fitness window and hero', () => {
  test('fitnessRange is the fixed 14 day window the loader and the components both read', () => {
    const today = new Date(2026, 9, 17)
    expect(fitnessRange(today)).toEqual(lastDaysRange(FITNESS_DAYS, today))
    expect(fitnessRange(today)).toEqual({ from: '2026-10-04', to: '2026-10-17' })
  })

  test("the VO2max hero takes the trace's last value, else the regression figure, else null", () => {
    expect(vo2Hero([52, 53.2], 50)).toBe(53.2)
    expect(vo2Hero([], 50)).toBe(50)
    expect(vo2Hero([], null)).toBeNull()
    expect(vo2Hero([], undefined)).toBeNull()
  })

  test('non-finite input is a dash or null, never NaN text', () => {
    expect(fmtMinutes(Number.NaN)).toBe('—')
    expect(fmtMinutes(Number.POSITIVE_INFINITY)).toBe('—')
    expect(hoursFromSec(Number.NaN)).toBeNull()
    expect(hoursFromSec(7200)).toBe(2)
    expect(hoursFromSec(null)).toBeNull()
  })
})

describe('lastScored', () => {
  test('is the newest scored day, skipping unscored ones', () => {
    expect(
      lastScored([
        { date: '2026-01-01', recovery: 50 },
        { date: '2026-01-02', recovery: 64 },
        { date: '2026-01-03', recovery: null },
      ]),
    ).toEqual({ value: 64, date: '2026-01-02' })
  })
  test('an unscored window is null', () => {
    expect(lastScored([{ date: '2026-01-01', recovery: null }])).toBeNull()
    expect(lastScored([])).toBeNull()
  })
})

describe('lastScored edge cases', () => {
  test('skips a non-finite score and reads the newest finite one', () => {
    expect(
      lastScored([
        { date: '2026-01-01', recovery: 50 },
        { date: '2026-01-02', recovery: Number.NaN },
      ]),
    ).toEqual({ value: 50, date: '2026-01-01' })
  })
  test('empty, all-null and all-NaN windows have no last score', () => {
    expect(lastScored([])).toBeNull()
    expect(lastScored([{ date: '2026-01-01', recovery: null }])).toBeNull()
    expect(lastScored([{ date: '2026-01-01', recovery: Number.NaN }])).toBeNull()
  })
})

describe('fitnessGap', () => {
  const settled = { status: 'success', placeholder: false, hasReading: false } as const
  test('a settled read with no reading names both spans and the next step', () => {
    expect(fitnessGap(settled)?.full).toBe(
      'No RHR or HRV in this 14\u00a0d window and no VO2max in 180\u00a0d — Garmin syncs every 6\u00a0h',
    )
  })
  test('a reading, a pending or a placeholder read has no copy; a failure says so', () => {
    expect(fitnessGap({ ...settled, hasReading: true })).toBeUndefined()
    expect(fitnessGap({ ...settled, status: 'pending' })).toBeUndefined()
    expect(fitnessGap({ ...settled, placeholder: true })).toBeUndefined()
    expect(fitnessGap({ ...settled, status: 'error' })).toEqual({
      short: 'The fitness readings failed to load',
      full: null,
    })
    // A partial failure keeps the readings that loaded.
    expect(fitnessGap({ ...settled, status: 'error', hasReading: true })).toBeUndefined()
  })
})

describe('loadGap', () => {
  const settled = { status: 'success', placeholder: false, windowDays: 30 } as const
  test('a ratio needs no copy: the meter names the bands', () => {
    expect(loadGap({ acwr: 1, ...settled })).toBeUndefined()
  })
  test('only a settled read without a ratio states the gap, with the chart cards’ wording', () => {
    expect(loadGap({ acwr: null, ...settled })?.full).toBe(
      'No training load in this 30\u00a0d window — Garmin syncs every 6\u00a0h',
    )
    expect(loadGap({ acwr: null, ...settled, placeholder: true })).toBeUndefined()
  })
  test('loading has no copy and a failure says so', () => {
    expect(loadGap({ acwr: null, ...settled, status: 'pending' })).toBeUndefined()
    expect(loadGap({ acwr: null, ...settled, status: 'error' })).toEqual({
      short: 'The training load failed to load',
      full: null,
    })
  })
})

describe('chartEmpty', () => {
  test('names the metric, the window and the sync cadence', () => {
    expect(chartEmpty('sleep', 14).full).toBe(
      'No sleep in this 14\u00a0d window — Garmin syncs every 6\u00a0h',
    )
    expect(chartEmpty('sleep', 0).full).toBe(
      'No sleep in this window — Garmin syncs every 6\u00a0h',
    )
  })

  test('the short form is the full sentence’s leading clause, verbatim', () => {
    const { short, full } = chartEmpty('sleep', 14)
    expect(short).toBe('No sleep in this 14\u00a0d window')
    expect(full?.startsWith(short)).toBe(true)
  })

  test('every Garmin gap shares the pair: short is the full form’s prefix', () => {
    const settled = { status: 'success' as const, placeholder: false }
    const fitness = fitnessGap({ ...settled, hasReading: false })!
    expect(fitness.full?.startsWith(fitness.short)).toBe(true)
    expect(fitness.short).not.toContain('Garmin syncs')
    const load = loadGap({ acwr: null, ...settled, windowDays: 30 })!
    expect(load.short).toBe('No training load in this 30\u00a0d window')
    const rec = { settled: true, windowDays: 30, date: '2026-01-02', missing: ['RHR' as const] }
    const noScore = recoveryGap(rec).line!
    expect(noScore.short).toBe('No recovery score in this 30\u00a0d window')
    expect(noScore.full?.startsWith(noScore.short)).toBe(true)
    // The recovery chart's short form is the strip cell's clause, built from one noun.
    expect(chartEmpty(RECOVERY_GAP_METRIC, 30).short).toBe(noScore.short)
    expect(recoveryGap({ ...rec, last: { value: 62, date: '2026-01-01' } }).line?.short).toBe(
      'Last scored 62/100 on 1\u00a0Jan',
    )
  })
})

describe('allocateForms', () => {
  const data = chartEmpty('sleep', 14)
  const failure = plainGap('The training load failed to load')

  test('a strip gap leads: it prints the cadence, every later gap the short form', () => {
    expect(allocateForms([data, data, null, data])).toEqual(['full', 'short', 'short', 'short'])
  })

  test('chart-only gaps: with no strip gap the first empty chart card carries the cadence', () => {
    expect(allocateForms([null, undefined, null, data, data])).toEqual([
      'short',
      'short',
      'short',
      'full',
      'short',
    ])
  })

  test('an error line never takes the slot: the next data gap still prints the cadence', () => {
    expect(allocateForms([failure, data, data])).toEqual(['short', 'full', 'short'])
    expect(allocateForms([failure, null, data])).toEqual(['short', 'short', 'full'])
  })

  test('the cadence-only gap leads like any data gap', () => {
    expect(allocateForms([cadenceGap, data])).toEqual(['full', 'short'])
  })

  test('no gap, or only failures, allocates no full form', () => {
    expect(allocateForms([])).toEqual([])
    expect(allocateForms([failure, null])).toEqual(['short', 'short'])
  })

  test('gapLine prints the allocated form; a plain gap has one wording', () => {
    expect(gapLine(data, 'full')).toBe(data.full!)
    expect(gapLine(data, 'short')).toBe(data.short)
    expect(gapLine(failure, 'full')).toBe(failure.short)
  })
})

describe('ACWR_LEGEND', () => {
  test('names all four zones with the meter vocabulary and their bounds', () => {
    expect(ACWR_LEGEND).toEqual({
      undertrained: 'Low (< 0.8)',
      optimal: 'Optimal (0.8–1.3)',
      caution: 'Caution (1.3–1.5)',
      danger: 'Danger (> 1.5)',
    })
  })
})

describe('ACWR_ZONE_NAME', () => {
  test('every surface label derives from the one vocabulary', () => {
    const zones = ['undertrained', 'optimal', 'caution', 'danger'] as const
    for (const zone of zones) {
      expect(acwrZoneLabel(zone)).toBe(ACWR_ZONE_NAME[zone])
      expect(ACWR_LEGEND[zone].startsWith(ACWR_ZONE_NAME[zone])).toBe(true)
    }
    expect(ACWR_ZONE_NAME.undertrained).toBe('Low')
    expect(acwrZoneLabel(null)).toBe('')
  })
})

describe('ACWR zone vocabulary', () => {
  test('one builder: full names as labels, `short` only where the name is abbreviated', () => {
    const zones = acwrMeterZones({ floor: 0.8, optimalTo: 1.3, cautionTo: 1.5, max: 2 })
    expect(zones.map((z) => z.label)).toEqual(['Low', 'Optimal', 'Caution', 'Danger'])
    expect(zones.map((z) => z.short)).toEqual([undefined, undefined, 'Caut.', undefined])
    expect(zones.map((z) => [z.from, z.to])).toEqual([
      [0, 0.8],
      [0.8, 1.3],
      [1.3, 1.5],
      [1.5, 2],
    ])
  })
})

describe('recovery verdict', () => {
  test('classifies the displayed (rounded) score', () => {
    const cases: [number, string][] = [
      [0, 'rest'],
      [39.4, 'rest'],
      [39.5, 'normal'],
      [39.9, 'normal'],
      [40, 'normal'],
      [69.4, 'normal'],
      [69.9, 'push'],
      [70, 'push'],
      [100, 'push'],
    ]
    for (const [score, verdict] of cases) {
      expect(recoveryVerdict(score)).toBe(verdict as ReturnType<typeof recoveryVerdict>)
      expect(recoveryVerdict(score)).toBe(recoveryVerdict(Number(fmtNum(score))))
    }
  })

  test('the meter names the verdict and the cut-offs', () => {
    expect(recoveryMeterProps(72).label).toBe('Recovery score, Push zone')
    expect(recoveryMeterProps(null).label).toBe('Recovery score')
    expect(recoveryMeterProps(50).startCaption).toBe('rest < 40 · push ≥ 70')
    expect(recoveryMeterProps(50).zones.map((z) => z.label)).toEqual(['Rest', 'Normal', 'Push'])
  })
})

describe('recoveryQualifier', () => {
  test('is the score day, and absent when the read has no date', () => {
    expect(recoveryQualifier('2020-01-02')).toBe('2 Jan')
    expect(recoveryQualifier(undefined)).toBeUndefined()
    expect(recoveryQualifier(null)).toBeUndefined()
  })
})

describe('stress zones', () => {
  test('boundaries 24/25/49/50/74/75 land in one band each', () => {
    const names = [24, 25, 49, 50, 74, 75].map((v) => STRESS_ZONE_NAME[stressZone(v)])
    expect(names).toEqual(['Rest', 'Low', 'Low', 'Moderate', 'Moderate', 'High'])
  })

  test('legend ranges never share a bound', () => {
    expect(Object.values(STRESS_ZONE_LEGEND)).toEqual([
      'Rest (< 25)',
      'Low (25–49)',
      'Moderate (50–74)',
      'High (≥ 75)',
    ])
  })
})

describe('strip cell branches', () => {
  test('load: a gap with acute/chronic rows keeps the meter and its gap line', () => {
    expect(loadCellBranch({ gap: {}, loadRows: 2 })).toBe('meter')
    expect(loadMeterEmptyText({ n: 1 }, () => 'gap line')).toBe('gap line')
  })

  test('load: a gap with nothing to show is the worded reason', () => {
    expect(loadCellBranch({ gap: {}, loadRows: 0 })).toBe('empty')
  })

  test('load: no gap yet (pending or placeholder) is the meter reading the loading text', () => {
    expect(loadCellBranch({ gap: undefined, loadRows: 0 })).toBe('meter')
    expect(loadMeterEmptyText(undefined, () => 'gap line')).toBe('Loading training load')
  })

  test('recovery: a reason only when the gap is shown and has a line', () => {
    expect(recoveryCellBranch({ showsGap: true, gap: {} })).toBe('empty')
    expect(recoveryCellBranch({ showsGap: true, gap: null })).toBe('meter')
    expect(recoveryCellBranch({ showsGap: false, gap: {} })).toBe('meter')
  })
})

describe('dayKeysBetween', () => {
  test('lists every calendar day inclusive, across a month and a DST change', () => {
    expect(dayKeysBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
    expect(dayKeysBetween('2026-10-24', '2026-10-26')).toHaveLength(3)
  })

  test('a single day is one key, a reversed span is empty', () => {
    expect(dayKeysBetween('2026-10-05', '2026-10-05')).toEqual(['2026-10-05'])
    expect(dayKeysBetween('2026-10-06', '2026-10-05')).toEqual([])
  })
})

const empty = (date: string) => ({ date, v: 0 })

describe('fillDays', () => {
  test('rest days become empty points, so a week is seven columns', () => {
    const out = fillDays(
      [
        { date: '2026-10-05', v: 3 },
        { date: '2026-10-08', v: 5 },
      ],
      '2026-10-05',
      '2026-10-11',
      empty,
    )
    expect(out.map((p) => p.date)).toHaveLength(7)
    expect(out.filter((p) => p.v > 0).map((p) => p.date)).toEqual(['2026-10-05', '2026-10-08'])
  })

  test('a point outside the span is kept, in order', () => {
    const out = fillDays([{ date: '2026-10-01', v: 1 }], '2026-10-05', '2026-10-06', empty)
    expect(out.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-05', '2026-10-06'])
  })
})

describe('windowSpan', () => {
  const last = '2026-10-17'

  test('an open start runs from the first point, a closed one clips at the floor', () => {
    expect(windowSpan({}, '2026-04-15', '2026-09-02', last)).toEqual({
      from: '2026-09-02',
      to: last,
    })
    expect(
      windowSpan(
        { dateFrom: '2026-01-01', dateTo: '2026-04-20' },
        '2026-04-15',
        '2026-04-16',
        last,
      ),
    ).toEqual({ from: '2026-04-15', to: '2026-04-20' })
  })

  test('the open-start branch clips at the floor too', () => {
    expect(windowSpan({}, '2026-04-15', '2026-04-01', last).from).toBe('2026-04-15')
  })

  test('from never passes to: a custom start after the last visible day collapses onto it', () => {
    expect(windowSpan({ dateFrom: '2026-10-18' }, '2026-04-15', '2026-09-02', last)).toEqual({
      from: last,
      to: last,
    })
  })

  test('the day count follows the clamped span, before the cutoff and with a future dateTo', () => {
    // Before 22:00 on the 18th the axis ends on the 17th: Oct 11–17 is 7 days, not 8.
    expect(count({ dateFrom: '2026-10-11' }, lastVisibleDay(new Date(2026, 9, 18, 9)))).toBe(7)
    expect(count({ dateFrom: '2026-10-11', dateTo: '2099-01-01' }, last)).toBe(7)
  })

  test('the end never passes the last visible day, even for a far-future dateTo', () => {
    expect(windowSpan({ dateTo: '9999-12-31' }, '2026-04-15', '2026-09-02', last).to).toBe(last)
  })
})

describe('lastVisibleDay', () => {
  test('ends yesterday before the cutoff hour, today after it', () => {
    expect(lastVisibleDay(new Date(2026, 9, 18, 9))).toBe('2026-10-17')
    expect(lastVisibleDay(new Date(2026, 9, 18, 23))).toBe('2026-10-18')
    expect(lastVisibleDay(new Date(2026, 10, 1, 9))).toBe('2026-10-31')
  })
})

describe('ACWR_INFO', () => {
  test('names the zones as the legend does', () => {
    for (const label of Object.values(ACWR_LEGEND)) expect(ACWR_INFO).toContain(label)
  })
})
