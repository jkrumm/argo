import { describe, expect, test } from 'bun:test'
import {
  bandOffset,
  dayLabel,
  deltaPhrase,
  ratioNote,
  shortDate,
  e1rmDelta,
  groupByDay,
  lastSession,
  acwrAsOf,
  currentAcwr,
  meanAcwr,
  readinessReading,
  offText,
  periodLabel,
  perMonth,
  ratioName,
  signed,
  summarySentence,
  todaysCall,
} from './model'

const NOW = Date.parse('2026-10-17T12:00:00Z')
const pt = (date: string, e1rm: number | null, inol: number | null = null) => ({ date, e1rm, inol })

describe('todaysCall', () => {
  const push = { score: 82, verdict: 'Push' as const, driver: 'HRV' }
  test('readiness verdict stands when progressing', () => {
    expect(todaysCall(push, { verdict: 'progress', activeSignals: [] }).title).toBe('Today: Push')
  })
  test('deload overrides readiness', () => {
    const c = todaysCall(push, { verdict: 'deload', activeSignals: ['stall', 'fatigue'] })
    expect(c).toMatchObject({ title: 'Today: Deload', overridden: true })
  })
  test('monitor keeps the verdict and names the signal', () => {
    const c = todaysCall(push, { verdict: 'monitor', activeSignals: ['stall'] })
    expect(c).toMatchObject({ verdict: 'Push', monitor: 'stall', overridden: false })
  })
  test('no readiness is a dash, not a verdict', () => {
    expect(todaysCall(null, undefined).title).toBe('Today: —')
    expect(todaysCall({ score: null, verdict: 'Normal', driver: null }, undefined).verdict).toBe(
      '—',
    )
  })
})

describe('e1rmDelta', () => {
  const pts = [pt('2026-09-01', 100), pt('2026-09-15', 104), pt('2026-10-10', 110)]
  test('compares to the last session at or before the cutoff', () => {
    expect(e1rmDelta(pts, NOW)).toBe(6)
  })
  test('null when the last session is older than the window', () => {
    expect(e1rmDelta([pt('2026-08-01', 100), pt('2026-09-02', 110)], NOW)).toBeNull()
  })
  test('null without history before the cutoff', () => {
    expect(e1rmDelta([pt('2026-10-10', 110)], NOW)).toBeNull()
    expect(e1rmDelta([], NOW)).toBeNull()
  })
})

describe('meanAcwr', () => {
  test('averages each lift latest non-null value', () => {
    const lifts = [
      { points: [{ acwr: 1.0 }, { acwr: 1.2 }, { acwr: null }] },
      { points: [{ acwr: 0.9 }] },
    ]
    expect(meanAcwr(lifts)).toBe(1.05)
  })
  test('null when nothing is measured', () => {
    expect(meanAcwr([{ points: [{ acwr: null }] }])).toBeNull()
  })
})

describe('units', () => {
  test('velocity is %/mo', () => {
    expect(perMonth(0.14)).toBe(4.2)
    expect(perMonth(null)).toBeNull()
  })
  test('signed', () => {
    expect(signed(4.2)).toBe('+4.2')
    expect(signed(-1.25)).toBe('−1.3')
    expect(signed(null)).toBe('—')
  })
})

describe('lastSession', () => {
  test('picks the newest INOL across lifts', () => {
    const r = lastSession([
      { exercise_id: 'squat', points: [pt('2026-10-01', 100, 0.7)] },
      {
        exercise_id: 'bench_press',
        points: [pt('2026-10-12', 90, 0.9), pt('2026-10-14', 91, null)],
      },
    ])
    expect(r).toEqual({ exercise_id: 'bench_press', date: '2026-10-12', inol: 0.9 })
  })
})

describe('summarySentence', () => {
  test('repeats the call verdict and the same figures', () => {
    const call = todaysCall({ score: 72, verdict: 'Push', driver: null }, undefined)
    expect(
      summarySentence({ leader: 'deadlift', e1rm: 170, delta: 3.5, acwr: 1.05, call, score: 72 }),
    ).toBe('Deadlift e1RM 170.0 kg, +3.5 kg in 28d · ACWR 1.05 optimal · readiness 72/100 Push')
  })
  test('unknowns are dashes', () => {
    const call = todaysCall(null, undefined)
    expect(
      summarySentence({ leader: null, e1rm: null, delta: null, acwr: null, call, score: null }),
    ).toBe('e1RM · ACWR — · readiness — —')
  })
})

describe('deltaPhrase', () => {
  test('states why there is no figure', () => {
    expect(deltaPhrase(3.5, 170)).toBe('+3.5 kg in 28d')
    expect(deltaPhrase(null, 170)).toBe('no session in 28d')
    expect(deltaPhrase(null, null)).toBe('— kg in 28d')
  })
})

describe('balance', () => {
  test('balanced outside the band names the tolerance', () => {
    expect(ratioNote('balanced', -0.16)).toBe(
      'near band · 0.16 under the band, within the 15% tolerance',
    )
    expect(ratioNote('balanced', 0)).toBe('balanced · inside the band')
    expect(ratioNote('critical', 0.4)).toBe('critical · 0.40 over the band')
  })
  test('names the lifts', () => {
    expect(ratioName('DL / Squat')).toBe('Deadlift / Squat')
    expect(ratioName('Pull-up / BW')).toBe('Pull-up / body weight')
  })
  test('band offset', () => {
    expect(bandOffset(0.9, [1, 1.25])).toBe(-0.1)
    expect(bandOffset(1.1, [1, 1.25])).toBe(0)
    expect(bandOffset(1.4, [1, 1.25])).toBe(0.15)
    expect(bandOffset(null, [1, 1.25])).toBeNull()
  })
  test('offset text', () => {
    expect(offText(-0.1)).toBe('0.10 under the band')
    expect(offText(0)).toBe('inside the band')
    expect(offText(null)).toBe('—')
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
  test('period label', () => {
    expect(periodLabel('all')).toBe('all time')
    expect(periodLabel('90d')).toBe('90 days')
    expect(periodLabel('1y')).toBe('1 year')
    expect(periodLabel('custom', '2026-01-01', '2026-02-01')).toBe('2026-01-01 – 2026-02-01')
  })
})

describe('readinessReading', () => {
  test('latest non-null point with a verdict at the thresholds', () => {
    const pts = [
      { readiness: 30, driver: 'a' },
      { readiness: 70, driver: 'b' },
      { readiness: null, driver: null },
    ]
    expect(readinessReading(pts)).toEqual({ score: 70, verdict: 'Push', driver: 'b' })
    expect(readinessReading([{ readiness: 39.9, driver: null }])?.verdict).toBe('Rest')
    expect(readinessReading([{ readiness: 40, driver: null }])?.verdict).toBe('Normal')
    expect(readinessReading([])).toBeNull()
  })
})

describe('acwrAsOf', () => {
  test('newest measured week across lifts', () => {
    const lifts = [
      {
        points: [
          { date: '2026-08-10', acwr: 1 },
          { date: '2026-08-17', acwr: null },
        ],
      },
      { points: [{ date: '2026-08-24', acwr: 1.1 }] },
    ]
    expect(acwrAsOf(lifts)).toBe('2026-08-24')
    expect(acwrAsOf([])).toBeNull()
  })
})

describe('currentAcwr', () => {
  const lifts = [{ points: [{ date: '2026-08-31', acwr: 1.0 }] }]
  test('unknown once the newest week is older than the window', () => {
    expect(currentAcwr(lifts, NOW)).toBeNull()
    expect(currentAcwr(lifts, Date.parse('2026-09-10T00:00:00Z'))).toBe(1)
  })
})
