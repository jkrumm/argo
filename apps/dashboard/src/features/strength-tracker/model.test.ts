import { describe, expect, test } from 'bun:test'
import {
  acwrReading,
  deloadLine,
  lastSessionDate,
  readinessHeader,
  recentDeload,
  bandOffset,
  dayLabel,
  groupByDay,
  lastSession,
  liftDelta,
  localIso,
  offText,
  periodLabel,
  perMonth,
  ratioName,
  ratioNote,
  readinessReading,
  shortDate,
  signed,
  statusWord,
  summaryParts,
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
    expect(deloadLine({ verdict: 'stale', activeSignals: [] }, '2026-09-02')).toBe(
      `Deload signal: no recent sessions, last was ${shortDate('2026-09-02')}`,
    )
    expect(deloadLine(active, '2026-10-10')).toBe('Deload signal: monitor — fatigue')
    expect(deloadLine({ verdict: 'progress', activeSignals: [] }, null)).toBe(
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

type PartsInput = Parameters<typeof summaryParts>[0]
/** The headline and its facts, as the one line they used to be. */
const summaryText = (input: PartsInput) => {
  const { sentence, facts } = summaryParts(input)
  return [sentence, ...facts].join(' · ')
}

describe('summaryParts', () => {
  test('the headline is the leader lift, the facts are load and readiness', () => {
    const call = todaysCall(
      readinessReading([{ date: '2026-10-17', readiness: 50, driver: null }]),
      undefined,
      NOW,
    )
    expect(
      summaryParts({
        leader: 'deadlift',
        e1rm: 110,
        delta: { delta: 10, phrase: '+10.0 kg in 28d' },
        acwr: 1.2,
        call,
        score: 50,
      }),
    ).toEqual({
      sentence: 'Deadlift e1RM 110.0 kg, +10.0 kg in 28d',
      facts: ['ACWR 1.20 optimal', 'readiness 50/100 Normal'],
    })
  })
})

describe('readiness reads one value everywhere', () => {
  // One fixture: the card heading, the summary sentence and the section header all read it.
  const reading = readinessReading([{ date: '2026-10-17', readiness: 87.6, driver: 'HRV' }])
  test('the same figure, verdict and date in all three', () => {
    const header = readinessHeader(reading)
    const call = todaysCall(reading, undefined, NOW)
    const sentence = summaryText({
      leader: null,
      e1rm: null,
      delta: liftDelta([], NOW),
      acwr: null,
      call,
      score: reading?.score ?? null,
    })
    expect(header).toEqual({ text: '88/100', verdict: 'Push', date: '17 Oct' })
    expect(sentence).toContain(`Readiness ${header?.text} ${header?.verdict}`)
    expect(call.title).toBe(`Today: ${header?.verdict}`)
  })
  test('a capped call names both the reading and the call', () => {
    const call = todaysCall(reading, { verdict: 'monitor', activeSignals: ['x'] }, NOW)
    const sentence = summaryText({
      leader: null,
      e1rm: null,
      delta: liftDelta([], NOW),
      acwr: null,
      call,
      score: reading?.score ?? null,
    })
    expect(sentence).toContain('Readiness 88/100 (Push), capped to Normal by a monitor signal')
  })
  test('no reading is null', () => {
    expect(readinessHeader(null)).toBeNull()
  })
})

describe('liftDelta', () => {
  const pts = [pt('2026-09-01', 100), pt('2026-09-15', 104), pt('2026-10-10', 110)]
  test('compares to the last session at or before the cutoff', () => {
    expect(liftDelta(pts, NOW)).toEqual({ delta: 6, phrase: '+6.0 kg in 28d' })
  })
  test('says so when the last session is older than the window', () => {
    const r = liftDelta([pt('2026-08-01', 100), pt('2026-09-02', 110)], NOW)
    expect(r).toEqual({ delta: null, phrase: 'no session in 28d' })
  })
  test('a first session inside the window is not "no session"', () => {
    const r = liftDelta([pt('2026-10-10', 100), pt('2026-10-14', 110)], NOW)
    expect(r).toEqual({ delta: null, phrase: 'first session 10 Oct' })
  })
  test('empty is a dash', () => {
    expect(liftDelta([], NOW).phrase).toBe('— kg in 28d')
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

describe('card, summary sentence and chart header agree', () => {
  // One fixture feeds the figures the three surfaces print.
  const lifts = [{ points: [week('2026-10-12', 120, 100)] }]
  const series = [pt('2026-09-01', 100), pt('2026-10-10', 110)]
  test('the same ACWR, delta and readiness appear in every place', () => {
    const { acwr } = acwrReading(lifts, NOW) // card Meter and chart header read this
    const delta = liftDelta(series, NOW) // strip cell and summary read this
    const readiness = readinessReading([{ date: '2026-10-17', readiness: 50, driver: null }])
    const call = todaysCall(readiness, undefined, NOW)
    const sentence = summaryText({
      leader: 'deadlift',
      e1rm: 110,
      delta,
      acwr,
      call,
      score: readiness?.score ?? null,
    })
    expect(acwr).toBe(1.2)
    expect(sentence).toBe(
      'Deadlift e1RM 110.0 kg, +10.0 kg in 28d · ACWR 1.20 optimal · readiness 50/100 Normal',
    )
  })
  test('unknowns are dashes', () => {
    const call = todaysCall(null, undefined, NOW)
    const delta = liftDelta([], NOW)
    expect(summaryText({ leader: null, e1rm: null, delta, acwr: null, call, score: null })).toBe(
      'Readiness — — · ACWR —',
    )
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
    expect(offText(bandOffset(2.004, [1, 2]))).toBe('<0.01 over the band')
    expect(offText(0)).toBe('inside the band')
    expect(offText(-0.1)).toBe('0.10 under the band')
    expect(offText(null)).toBe('—')
  })
  test('status words', () => {
    expect(statusWord('balanced', -0.2)).toBe('near band')
    expect(statusWord('imbalanced', 0)).toBe('balanced')
    expect(statusWord('critical', 0.5)).toBe('critical')
    expect(statusWord(null, 0)).toBe('—')
  })
  test('the tolerance is named from its one constant', () => {
    expect(ratioNote('balanced', -0.2)).toBe(
      'near band · 0.20 under the band, within the 15% tolerance',
    )
    expect(ratioNote('balanced', 0)).toBe('balanced · inside the band')
    expect(ratioNote('critical', 0.4)).toBe('critical · 0.40 over the band')
  })
})

describe('records and periods', () => {
  test('groups consecutive days', () => {
    const g = groupByDay([{ date: 'a' }, { date: 'a' }, { date: 'b' }])
    expect(g.map((d) => d.rows.length)).toEqual([2, 1])
  })
  test('day label is zone-stable', () => {
    expect(dayLabel('2026-10-16')).toBe('Fri 16 Oct')
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
