import { describe, expect, test } from 'bun:test'
import {
  acwrReading,
  deloadLine,
  lastSessionDate,
  fmtMonthly,
  readinessHeader,
  recentDeload,
  bandOffset,
  dayLabel,
  groupByDay,
  lastSession,
  liftFooter,
  callFacts,
  liftDelta,
  localIso,
  offText,
  periodLabel,
  perMonth,
  ratioName,
  isBorderline,
  fmtBound,
  readinessReading,
  shortDate,
  signed,
  staleNote,
  statusWord,
  summaryParts,
  diagnosticsTitle,
  borderlineNote,
  todaysCall,
} from './model'

// Obviously synthetic: every value is round and invented.
const NOW = Date.parse('2026-10-17T12:00:00')
const pt = (date: string, e1rm: number | null, inol: number | null = null) => ({ date, e1rm, inol })
const week = (date: string, acute: number, chronic: number) => ({
  date,
  acute,
  chronic,
  acwr: chronic > 0 ? acute / chronic : null,
})

describe('todaysCall', () => {
  const push = { score: 50, verdict: 'Push' as const, driver: 'HRV', date: '2026-10-17' }
  test('readiness verdict stands when progressing', () => {
    const c = todaysCall(push, { verdict: 'progress', activeSignals: [] }, NOW)
    expect(c).toMatchObject({ title: 'Today: Push', asOf: null })
  })
  test('deload overrides readiness', () => {
    const c = todaysCall(push, { verdict: 'deload', activeSignals: ['stall', 'fatigue'] }, NOW)
    expect(c).toMatchObject({ title: 'Today: Deload', overridden: true })
  })
  test('an active monitor signal caps Push at Normal and names the signal', () => {
    const c = todaysCall(push, { verdict: 'monitor', activeSignals: ['stall'] }, NOW)
    expect(c).toMatchObject({
      verdict: 'Normal',
      readinessVerdict: 'Push',
      monitor: 'stall',
      overridden: false,
    })
    const high = { ...push, score: 80, verdict: 'Push' as const }
    const capped = todaysCall(high, { verdict: 'monitor', activeSignals: ['stall'] }, NOW)
    expect(capped).toMatchObject({ verdict: 'Normal', readinessVerdict: 'Push' })
  })
  test('a stale signal changes nothing', () => {
    const high = { ...push, score: 80, verdict: 'Push' as const }
    expect(todaysCall(high, { verdict: 'stale', activeSignals: [] }, NOW).verdict).toBe('Push')
  })
  test('a reading from another day is dated, not called today', () => {
    const old = { ...push, date: '2026-10-10' }
    const c = todaysCall(old, undefined, NOW)
    expect(c).toMatchObject({ title: 'Latest: Push · 10 Oct', asOf: '10 Oct' })
  })
  test('no readiness is a dash, not a verdict', () => {
    expect(todaysCall(null, undefined, NOW).title).toBe('Today: —')
    const empty = { score: null, verdict: 'Normal' as const, driver: null, date: null }
    expect(todaysCall(empty, undefined, NOW).verdict).toBe('—')
  })
})

describe('deload recency', () => {
  const active = { verdict: 'monitor' as const, activeSignals: ['fatigue'] }
  test('signals are stale when no session is inside the window', () => {
    expect(recentDeload(active, '2026-09-02', NOW)).toEqual({ verdict: 'stale', activeSignals: [] })
    expect(recentDeload(active, '2026-10-10', NOW)).toBe(active)
    expect(recentDeload(active, null, NOW)?.verdict).toBe('stale')
    expect(recentDeload(undefined, '2026-10-10', NOW)).toBeUndefined()
  })
  test('exactly 28 d ago is stale, a day later is recent', () => {
    const midnight = Date.parse('2026-10-17')
    expect(recentDeload(active, '2026-09-19', midnight)?.verdict).toBe('stale')
    expect(recentDeload(active, '2026-09-20', midnight)?.verdict).toBe('monitor')
  })
  test('the line says what the signal is, never "active" for a stale one', () => {
    // A stale signal is told once, by the facts line's last session, not by a second deload line.
    const shown = { lastSessionShown: true, lastDate: '2026-09-02' }
    expect(deloadLine({ verdict: 'stale', activeSignals: [] }, shown)).toBeNull()
    // With no last session on the facts line (no leader / e1RM), the stale line explains itself.
    expect(
      deloadLine({ verdict: 'stale', activeSignals: [] }, { ...shown, lastSessionShown: false }),
    ).toBe(`Deload signal: no recent sessions, last was ${shortDate('2026-09-02')}`)
    expect(
      deloadLine(
        { verdict: 'stale', activeSignals: [] },
        { lastSessionShown: false, lastDate: null },
      ),
    ).toBe('Deload signal: no recent sessions')
    expect(deloadLine(active, shown)).toBe('Deload signal: monitor — fatigue')
    expect(deloadLine({ verdict: 'progress', activeSignals: [] }, shown)).toBe(
      'Deload signal: none active',
    )
  })
  test('last session date is the newest across lifts', () => {
    expect(
      lastSessionDate([
        { exercise_id: 'a', points: [pt('2026-10-01', 100)] },
        { exercise_id: 'b', points: [pt('2026-10-12', 90), pt('2026-10-14', null)] },
      ]),
    ).toBe('2026-10-12')
  })
})

const move = (delta: number | null) => ({
  delta: { delta, phrase: null, stale: delta === null, days: 28 },
})

describe('summaryParts', () => {
  test('counts the selected lifts that moved up, unscored ones stay in the denominator', () => {
    expect(summaryParts([move(10), move(-2.5), move(0), move(null)])?.sentence).toBe(
      '1 of 4 lifts up in 28\u00a0d',
    )
  })
  test('a single lift is singular', () => {
    expect(summaryParts([move(2.5)])?.sentence).toBe('1 of 1 lift up in 28\u00a0d')
  })
  test('nothing up still states a fact: flat or down, or nothing scored', () => {
    expect(summaryParts([move(0), move(null)])?.sentence).toBe('No lift moved up in 28\u00a0d')
    expect(summaryParts([move(-1.5), move(-0.1)])?.sentence).toBe('No lift moved up in 28\u00a0d')
    expect(summaryParts([move(null)])?.sentence).toBe('No scored e1RM in 28\u00a0d')
    expect(summaryParts([])).toBeNull()
  })
})

describe('diagnosticsTitle', () => {
  test('names the period only when the window is a real one', () => {
    expect(diagnosticsTitle('all', 'all time')).toBe('Strength against your 90-day norm')
    expect(diagnosticsTitle('30d', '30 days')).toBe('Strength against your 90-day norm, 30 days')
  })
})

describe('borderlineNote', () => {
  test('states the tolerance once, with its unit kept whole', () => {
    expect(borderlineNote()).toBe('Borderline: balanced only through the 15\u00a0% tolerance')
  })
})

describe('readiness reads one value', () => {
  const reading = readinessReading([{ date: '2026-10-17', readiness: 87.6, driver: 'HRV' }])
  test('the card header and the call title share figure and verdict', () => {
    const header = readinessHeader(reading)
    const call = todaysCall(reading, undefined, NOW)
    expect(header).toEqual({ text: '88/100', verdict: 'Push', date: '17 Oct' })
    expect(call.title).toBe(`Today: ${header?.verdict}`)
  })
  test('a capped call names both the reading and the call', () => {
    const call = todaysCall(reading, { verdict: 'monitor', activeSignals: ['x'] }, NOW)
    expect(call.readinessVerdict).toBe('Push')
    expect(call.verdict).toBe('Normal')
    expect(call.monitor).not.toBeNull()
  })
  test('no reading is null', () => {
    expect(readinessHeader(null)).toBeNull()
  })
})

describe('fmtMonthly', () => {
  test('rounds before the sign, so a rate that displays as zero is unsigned', () => {
    expect(fmtMonthly(-0.04)).toBe('0.0')
    expect(fmtMonthly(0.04)).toBe('0.0')
    expect(fmtMonthly(-1.5)).toBe('−1.5')
    expect(fmtMonthly(2.449)).toBe('+2.4')
  })
})

describe('liftDelta', () => {
  const pts = [pt('2026-09-01', 100), pt('2026-09-15', 104), pt('2026-10-10', 110)]
  test('compares to the last session at or before the cutoff', () => {
    expect(liftDelta(pts, NOW)).toEqual({
      delta: 6,
      phrase: '+6.0\u00a0kg in 28\u00a0d',
      stale: false,
      days: 28,
    })
  })
  test('says so when the last session is older than the window', () => {
    const r = liftDelta([pt('2026-08-01', 100), pt('2026-09-02', 110)], NOW)
    expect(r).toEqual({ delta: null, phrase: null, stale: true, days: 28 })
  })
  test('a first session inside the window is not "no session"', () => {
    const r = liftDelta([pt('2026-10-10', 100), pt('2026-10-14', 110)], NOW)
    expect(r).toEqual({ delta: null, phrase: 'first session 10 Oct', stale: false, days: 28 })
  })
  test('empty is a dash', () => {
    expect(liftDelta([], NOW).phrase).toBe('no sessions yet')
  })
})

describe('acwrReading', () => {
  const heavy = { points: [week('2026-10-05', 200, 100), week('2026-10-12', 300, 200)] }
  const light = { points: [week('2026-10-05', 10, 10), week('2026-10-12', 50, 100)] }
  test('sums acute over summed chronic for the newest week', () => {
    expect(acwrReading([heavy, light], NOW)).toEqual({ acwr: 1.17, week: '2026-10-12' })
  })
  test('a lift not trained in the newest week decays toward the common week instead of dropping out', () => {
    // One missed week: acute x0.6, chronic x(15/17).
    const rested = { points: [week('2026-10-05', 100, 100)] }
    const r = acwrReading([heavy, rested], NOW)
    const acute = 300 + 100 * 0.6
    const chronic = 200 + 100 * (15 / 17)
    expect(r.acwr).toBe(Math.round((acute / chronic) * 100) / 100)
    expect(r.acwr).toBeLessThan(1.5) // dropping it out would read 1.5
  })
  test('unknown, with its week, once the newest week is older than the window', () => {
    const old = { points: [week('2026-08-31', 100, 100)] }
    expect(acwrReading([old], NOW)).toEqual({ acwr: null, week: '2026-08-31' })
  })
  test('nothing measured', () => {
    expect(acwrReading([], NOW)).toEqual({ acwr: null, week: null })
  })
})

describe('card and strip read one figure each', () => {
  const lifts = [{ points: [week('2026-10-12', 120, 100)] }]
  const series = [pt('2026-09-01', 100), pt('2026-10-10', 110)]
  test('the ACWR for the card and the move for the headline come from one function each', () => {
    expect(acwrReading(lifts, NOW).acwr).toBe(1.2)
    const delta = liftDelta(series, NOW)
    expect(delta.delta).toBe(10)
    expect(summaryParts([{ delta }])?.sentence).toBe('1 of 1 lift up in 28\u00a0d')
  })
})

describe('readinessReading', () => {
  test('latest non-null point with a verdict at the thresholds', () => {
    const pts = [
      { readiness: 30, driver: 'a' },
      { readiness: 70, driver: 'b', date: '2026-10-16' },
      { readiness: null, driver: null },
    ]
    expect(readinessReading(pts)).toEqual({
      score: 70,
      verdict: 'Push',
      driver: 'b',
      date: '2026-10-16',
    })
    expect(readinessReading([{ readiness: 39.9, driver: null }])?.verdict).toBe('Rest')
    expect(readinessReading([{ readiness: 40, driver: null }])?.verdict).toBe('Normal')
    expect(readinessReading([])).toBeNull()
  })
})

describe('units', () => {
  test('velocity is %/mo', () => {
    expect(perMonth(0.1)).toBe(3)
    expect(perMonth(null)).toBeNull()
  })
  test('signed', () => {
    expect(signed(5)).toBe('+5.0')
    expect(signed(-1.25)).toBe('−1.3')
    expect(signed(null)).toBe('—')
  })
})

describe('lastSession', () => {
  test('picks the newest INOL across lifts', () => {
    const r = lastSession([
      { exercise_id: 'squat', points: [pt('2026-10-01', 100, 0.5)] },
      { exercise_id: 'bench_press', points: [pt('2026-10-12', 90, 1), pt('2026-10-14', 91, null)] },
    ])
    expect(r).toEqual({ exercise_id: 'bench_press', date: '2026-10-12', inol: 1 })
  })
})

describe('balance', () => {
  test('names the lifts', () => {
    expect(ratioName('DL / Squat')).toBe('Deadlift / Squat')
    expect(ratioName('Pull-up / BW')).toBe('Pull-up / body weight')
  })
  test('band offset is unrounded', () => {
    expect(bandOffset(0.9, [1, 2])).toBeCloseTo(-0.1, 10)
    expect(bandOffset(1.5, [1, 2])).toBe(0)
    expect(bandOffset(2.004, [1, 2])).toBeCloseTo(0.004, 10)
    expect(bandOffset(null, [1, 2])).toBeNull()
  })
  test('a hair outside the band never prints inside it', () => {
    expect(offText(bandOffset(2.004, [1, 2]), [1, 2])).toBe('<0.01 outside the 1.0–2.0 band')
    expect(offText(0, [1, 2])).toBe('1.0–2.0 band')
    expect(offText(-0.1, [1, 2])).toBe('0.10 outside the 1.0–2.0 band')
    expect(offText(null, [1, 2])).toBe('—')
  })
  test('status words', () => {
    expect(statusWord('balanced', -0.2)).toBe('borderline')
    expect(statusWord('imbalanced', 0)).toBe('balanced')
    expect(statusWord('critical', 0.5)).toBe('critical')
    expect(statusWord(null, 0)).toBe('—')
  })
  test('bounds keep one decimal at least, and more when they have more', () => {
    expect(fmtBound(1)).toBe('1.0')
    expect(fmtBound(1.25)).toBe('1.25')
    expect(offText(0, [1, 1.25])).toBe('1.0–1.25 band')
  })
  test('borderline is a status of the API against the band, not a display word', () => {
    expect(isBorderline('balanced', -0.2)).toBe(true)
    expect(isBorderline('balanced', 0)).toBe(false)
    expect(isBorderline('imbalanced', -0.2)).toBe(false)
    expect(isBorderline('balanced', null)).toBe(false)
  })
  test('inside the band the row names the band alone, outside it the distance', () => {
    expect(offText(0, [1, 2])).toBe('1.0–2.0 band')
    expect(offText(-0.2, [1, 2])).toBe('0.20 outside the 1.0–2.0 band')
    expect(offText(0.4, [1, 2])).toBe('0.40 outside the 1.0–2.0 band')
    expect(offText(null, [1, 2])).toBe('—')
  })
})

describe('records and periods', () => {
  test('groups consecutive days', () => {
    const g = groupByDay([{ date: 'a' }, { date: 'a' }, { date: 'b' }])
    expect(g.map((d) => d.rows.length)).toEqual([2, 1])
  })
  test('day label is zone-stable', () => {
    expect(dayLabel('2026-10-16')).toBe('Fri 16 Oct')
    expect(dayLabel('2026-09-02')).toBe('Wed 2 Sep')
    expect(shortDate('2026-10-16')).toBe('16 Oct')
  })
  test('local iso', () => {
    expect(localIso(NOW)).toBe('2026-10-17')
  })
  test('period label', () => {
    expect(periodLabel('all')).toBe('all time')
    expect(periodLabel('90d')).toBe('90 days')
    expect(periodLabel('1y')).toBe('1 year')
    expect(periodLabel('custom', '2026-01-01', '2026-02-01')).toBe('2026-01-01 – 2026-02-01')
  })
})

describe('liftFooter', () => {
  test('a lift with a 28 d move shows only its PR', () => {
    const delta = { delta: 2.5, phrase: '+2.5\u00a0kg in 28\u00a0d', stale: false, days: 28 }
    expect(liftFooter({ delta, prKg: 100, prDate: '2026-08-13' })).toBe('PR 100.0 kg · 13 Aug')
  })
  test('without a move the reason leads, then the PR', () => {
    const delta = { delta: null, phrase: 'first session 13 Aug', stale: false, days: 28 }
    expect(liftFooter({ delta, prKg: 100, prDate: null })).toBe(
      'first session 13 Aug · PR 100.0 kg',
    )
  })
  test('a stale lift carries its record alone; the strip says why once', () => {
    const delta = { delta: null, phrase: null, stale: true, days: 28 }
    expect(liftFooter({ delta, prKg: 100, prDate: null })).toBe('PR 100.0 kg')
  })
  test('an empty phrase and no PR is a dash, not an empty string', () => {
    expect(
      liftFooter({
        delta: { delta: null, phrase: null, stale: false, days: 28 },
        prKg: null,
        prDate: null,
      }),
    ).toBe('—')
  })
  test('nothing known is a dash, never a zero', () => {
    expect(
      liftFooter({
        delta: { delta: 1, phrase: null, stale: false, days: 28 },
        prKg: null,
        prDate: null,
      }),
    ).toBe('—')
  })
})

describe('callFacts', () => {
  const session = { exercise_id: 'squat', date: '2026-10-16', inol: 0.756 }
  test('joins the as-of date, driver and last session; INOL is returned apart', () => {
    expect(callFacts({ asOf: '2026-10-17', driver: 'sleep', session })).toEqual({
      text: 'readiness from 2026-10-17 · driver sleep · last session Squat, Fri 16 Oct',
      inol: 'INOL 0.76',
    })
  })
  test('nothing known is an empty line and no INOL', () => {
    expect(callFacts({ asOf: null, driver: null, session: null })).toEqual({ text: '', inol: null })
  })
})

describe('staleNote', () => {
  const fresh = { delta: 1, phrase: null, stale: false, days: 28 }
  const stale = { delta: null, phrase: null, stale: true, days: 28 }
  test('none stale is no note', () => {
    expect(staleNote([{ id: 'squat', delta: fresh }])).toBeNull()
  })
  test('names the stale lifts once', () => {
    expect(
      staleNote([
        { id: 'squat', delta: stale },
        { id: 'deadlift', delta: fresh },
        { id: 'bench_press', delta: stale },
      ]),
    ).toBe('No scored e1RM in 28 d: Squat, Bench Press')
  })
  test('every lift stale is the headline, not a second note', () => {
    expect(staleNote([{ id: 'squat', delta: stale }])).toBeNull()
  })
})
