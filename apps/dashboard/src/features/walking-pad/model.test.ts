import { describe, expect, it } from 'bun:test'
import {
  busiestCell,
  collapseAchievements,
  distanceFacts,
  firstVisibleHour,
  fmtDuration,
  fmtSignedKm,
  fmtSignedKmh,
  groupByMonth,
  median,
  mondayKey,
  offsetLabel,
  overallKmh,
  paceValues,
  priorLabel,
  shiftCellsToLocal,
  emptyWindowParts,
  summaryParts,
  trimLeadingEmpty,
  weekSummary,
  weekTicks,
  widerPreset,
  windowPhrase,
  windowTitle,
  windowQualifier,
  widenLabel,
  windowStartMs,
  type Achievement,
  type SeriesPoint,
  type SessionRow,
} from './model'

const point = (date: string, over: Partial<SeriesPoint> = {}): SeriesPoint => ({
  date,
  sessions: 0,
  duration_s: 0,
  distance_m: 0,
  steps: 0,
  kcal: 0,
  avg_speed_kmh: null,
  ...over,
})

const row = (started_at: string, distance_m: number): SessionRow => ({
  uuid: started_at,
  started_at,
  ended_at: started_at,
  duration_s: 600,
  distance_m,
  steps: 0,
  avg_speed_kmh: 4,
  max_speed_kmh: 5,
  kcal: 0,
  pause_count: 0,
})

const a = (id: number, title: string, unlocked_at: string): Achievement => ({
  id,
  type: 'streak_3',
  title,
  description: `d${id}`,
  unlocked_at,
})

const day = (date: string, distance_m: number, sessions: number): SeriesPoint => ({
  date,
  sessions,
  duration_s: 0,
  distance_m,
  steps: 0,
  kcal: 0,
  avg_speed_kmh: null,
})

// Saturday 2026-10-17 12:00 UTC; its Monday is 2026-10-12.
const NOW = Date.parse('2026-10-17T12:00:00Z')

describe('weeks', () => {
  it('keys the UTC Monday, including on a Sunday and on the Monday itself', () => {
    expect(mondayKey(NOW)).toBe('2026-10-12')
    expect(mondayKey(Date.parse('2026-10-18T23:59:00Z'))).toBe('2026-10-12')
    expect(mondayKey(Date.parse('2026-10-12T00:00:00Z'))).toBe('2026-10-12')
  })

  it('reads this week so far against last week to the same weekday', () => {
    // NOW is Saturday 2026-10-17: this week is Mon 12 … Sat 17, last week Mon 5 … Sat 10.
    const days = [
      day('2026-10-05', 3000, 1),
      day('2026-10-06', 0, 0),
      day('2026-10-07', 0, 0),
      day('2026-10-08', 0, 0),
      day('2026-10-09', 0, 0),
      day('2026-10-10', 0, 0),
      // Sunday 11 Oct is after the comparison weekday and must not count.
      day('2026-10-11', 9000, 2),
      day('2026-10-12', 4000, 1),
      day('2026-10-13', 0, 0),
      day('2026-10-14', 0, 0),
      day('2026-10-15', 0, 0),
      day('2026-10-16', 0, 0),
      day('2026-10-17', 1000, 1),
    ]
    expect(weekSummary(days, NOW)).toEqual({
      distanceM: 5000,
      sessions: 2,
      priorDistanceM: 3000,
      deltaM: 2000,
      weekday: 'Sat',
    })
  })

  it('compares a Monday with last Monday only', () => {
    const monday = Date.parse('2026-10-12T08:00:00Z')
    const days = [day('2026-10-05', 5000, 1), day('2026-10-12', 1000, 1)]
    expect(weekSummary(days, monday)).toMatchObject({ deltaM: -4000, weekday: 'Mon' })
  })

  it('has no baseline when last week is outside the series, and no summary without this week', () => {
    expect(
      weekSummary([day('2026-10-12', 5000, 1)], Date.parse('2026-10-12T08:00:00Z'))?.deltaM,
    ).toBeNull()
    expect(weekSummary([day('2026-10-05', 0, 0)], NOW)).toBeNull()
  })

  it('rolls the week at the UTC Sunday to Monday boundary, ticks and today included', () => {
    const sunday = Date.parse('2026-10-18T23:59:00Z')
    const monday = Date.parse('2026-10-19T00:00:00Z')
    expect(mondayKey(sunday)).toBe('2026-10-12')
    expect(mondayKey(monday)).toBe('2026-10-19')
    const endOfWeek = weekTicks([], sunday)
    expect(endOfWeek.find((t) => t.today)?.label).toBe('S')
    expect(endOfWeek.find((t) => t.today)?.key).toBe('2026-10-18')
    expect(endOfWeek.every((t) => t.state !== 'upcoming')).toBe(true)
    const newWeek = weekTicks([], monday)
    expect(newWeek[0]?.today).toBe(true)
    expect(newWeek[0]?.key).toBe('2026-10-19')
    expect(newWeek.slice(1).every((t) => t.state === 'upcoming')).toBe(true)
  })

  it('draws Mon–Sun ticks with today outlined and the rest of the week upcoming', () => {
    const ticks = weekTicks(
      [point('2026-10-12', { sessions: 1 }), point('2026-10-15', { sessions: 2 })],
      NOW,
    )
    expect(ticks.map((t) => t.state)).toEqual([
      'walked',
      'rest',
      'rest',
      'walked',
      'rest',
      'rest',
      'upcoming',
    ])
    expect(ticks.filter((t) => t.today).map((t) => t.key)).toEqual(['2026-10-17'])
  })

  it('trims the empty buckets before the first walk', () => {
    const trimmed = trimLeadingEmpty([point('a'), point('b', { sessions: 1 }), point('c')])
    expect(trimmed.map((p) => p.date)).toEqual(['b', 'c'])
    expect(trimLeadingEmpty([point('a')])).toEqual([])
  })

  it('leaves weeks without a pace out of the sparkline values', () => {
    const values = paceValues([
      point('a'),
      point('b', { sessions: 1, avg_speed_kmh: 4.2 }),
      point('c', { sessions: 0 }),
      point('d', { sessions: 1, avg_speed_kmh: 4.8 }),
    ])
    expect(values).toEqual([4.2, 4.8])
  })
})

describe('window naming', () => {
  it('names a preset, a custom range and the open window', () => {
    expect(windowPhrase('30d')).toBe('the last 30 days')
    expect(windowPhrase('6m')).toBe('the last 6 months')
    expect(windowPhrase('custom')).toBe('this range')
    expect(windowPhrase('all')).toBe('any window')
  })

  it('titles a chart by its window', () => {
    expect(windowTitle('30d')).toBe('last 30 days')
    expect(windowTitle('all')).toBe('all time')
    expect(windowTitle('custom')).toBe('selected range')
  })

  it('names the period a caption shows', () => {
    expect(windowQualifier('30d')).toBe('30 d')
    expect(windowQualifier('all')).toBe('all time')
    expect(windowQualifier('custom')).toBe('range')
  })

  it('compares against the prior window by length', () => {
    expect(priorLabel('30d')).toBe('prior 30 d')
    expect(priorLabel('custom')).toBe('prior window')
  })

  it('widens to the next preset and stops at all-time', () => {
    expect(widerPreset('30d')).toBe('90d')
    expect(widerPreset('1y')).toBe('all')
    expect(widerPreset('all')).toBeNull()
    expect(widerPreset('custom')).toBe('90d')
  })

  it('labels the widen action', () => {
    expect(widenLabel('90d')).toBe('Show 90 days')
    expect(widenLabel('1y')).toBe('Show 1 year')
    expect(widenLabel('all')).toBe('Show all time')
  })

  it('starts a window at now minus its days, from the range start, or never for all', () => {
    expect(windowStartMs({ window: '7d' }, NOW)).toBe(NOW - 7 * 86_400_000)
    expect(windowStartMs({}, NOW)).toBe(NOW - 30 * 86_400_000)
    expect(windowStartMs({ from: '2026-01-01' }, NOW)).toBe(Date.parse('2026-01-01'))
    expect(windowStartMs({ window: 'all' }, NOW)).toBeNull()
  })
})

describe('distance facts', () => {
  it('takes the median of an even and an odd count', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('reads only rows inside the window', () => {
    const rows = [row('2026-10-16T10:00:00Z', 3000), row('2026-08-01T10:00:00Z', 9000)]
    const facts = distanceFacts(rows, Date.parse('2026-09-17T00:00:00Z'))
    expect(facts).toEqual({ medianM: 3000, longestM: 3000, partial: false })
  })

  it('flags a full page that does not reach the window start as partial', () => {
    const rows = [row('2026-10-16T10:00:00Z', 3000), row('2026-10-15T10:00:00Z', 5000)]
    expect(distanceFacts(rows, Date.parse('2026-01-01T00:00:00Z'), 2)?.partial).toBe(true)
    expect(distanceFacts(rows, Date.parse('2026-10-16T00:00:00Z'), 2)?.partial).toBe(false)
  })

  it('has no facts for an empty window', () => {
    expect(distanceFacts([row('2026-01-01T10:00:00Z', 1000)], NOW)).toBeNull()
  })
})

describe('local-time hour grid', () => {
  it('shifts east of UTC forward and wraps across the weekday', () => {
    // UTC+2 → getTimezoneOffset() = −120. Sunday 23:00 UTC is Monday 01:00 local.
    const [cell] = shiftCellsToLocal([{ dow: 0, hour: 23, sessions: 1, distance_m: 100 }], -120)
    expect(cell).toEqual({ dow: 1, hour: 1, sessions: 1, distance_m: 100 })
  })

  it('shifts west of UTC back and wraps Sunday to Saturday', () => {
    // UTC−5 → +300. Sunday 02:00 UTC is Saturday 21:00 local.
    const [cell] = shiftCellsToLocal([{ dow: 0, hour: 2, sessions: 1, distance_m: 0 }], 300)
    expect(cell?.dow).toBe(6)
    expect(cell?.hour).toBe(21)
  })

  it('shifts a half-hour zone to the nearest hour and says so', () => {
    // UTC+5:30 → −330: the 5.5 h shift rounds to 6.
    const [cell] = shiftCellsToLocal([{ dow: 2, hour: 10, sessions: 1, distance_m: 0 }], -330)
    expect(cell?.hour).toBe(16)
    expect(offsetLabel(-330)).toBe('UTC+5:30, rounded to the hour')
    expect(offsetLabel(-120)).toBe('UTC+2')
    expect(offsetLabel(300)).toBe('UTC−5')
  })

  it('shifts by the offset it is given, so a DST change moves the same cell an hour', () => {
    const cell = { dow: 3, hour: 12, sessions: 1, distance_m: 0 }
    expect(shiftCellsToLocal([cell], -60)[0]?.hour).toBe(13) // CET, winter
    expect(shiftCellsToLocal([cell], -120)[0]?.hour).toBe(14) // CEST, summer
  })

  it('finds the busiest cell and widens the visible range for early walks', () => {
    const cells = [
      { dow: 2, hour: 14, sessions: 3, distance_m: 0 },
      { dow: 4, hour: 5, sessions: 1, distance_m: 0 },
      { dow: 1, hour: 9, sessions: 0, distance_m: 0 },
    ]
    expect(busiestCell(cells)).toEqual(cells[0])
    expect(busiestCell([cells[2] as (typeof cells)[number]])).toBeNull()
    expect(firstVisibleHour(cells)).toBe(5)
    expect(firstVisibleHour([cells[0] as (typeof cells)[number]])).toBe(6)
  })
})

describe('achievements', () => {
  it('collapses repeats into one row with a count and the newest unlock', () => {
    const rows = collapseAchievements([
      a(1, 'Streak', '2026-08-01T10:00:00Z'),
      a(2, 'Streak', '2026-10-01T10:00:00Z'),
      a(3, 'First', '2026-09-01T10:00:00Z'),
    ])
    expect(rows.map((r) => [r.title, r.count, r.lastAt])).toEqual([
      ['Streak', 2, '2026-10-01T10:00:00Z'],
      ['First', 1, '2026-09-01T10:00:00Z'],
    ])
    expect(rows[0]?.description).toBe('d2')
  })

  it('keeps the unlocked total equal to the sum of the counts', () => {
    const items = [
      a(1, 'X', '2026-01-01T00:00:00Z'),
      a(2, 'X', '2026-02-01T00:00:00Z'),
      a(3, 'Y', '2026-03-01T00:00:00Z'),
    ]
    expect(collapseAchievements(items).reduce((s, r) => s + r.count, 0)).toBe(items.length)
  })

  it('groups newest-first rows under their month', () => {
    const groups = groupByMonth(
      collapseAchievements([
        a(1, 'A', '2026-10-15T12:00:00Z'),
        a(2, 'B', '2026-10-02T12:00:00Z'),
        a(3, 'C', '2026-09-20T12:00:00Z'),
      ]),
    )
    expect(groups.map((g) => [g.month, g.rows.length])).toEqual([
      ['October 2026', 2],
      ['September 2026', 1],
    ])
  })
})

describe('formats and summary', () => {
  it('states the overall pace as distance over time', () => {
    expect(overallKmh(141_700, 43 * 3600 + 19 * 60)).toBeCloseTo(3.27, 2)
    expect(overallKmh(1000, 0)).toBeNull()
  })

  it('formats durations by magnitude', () => {
    expect(fmtDuration(30)).toBe('30\u00a0s')
    expect(fmtDuration(45 * 60)).toBe('45\u00a0min')
    expect(fmtDuration(2 * 3600 + 5 * 60)).toBe('2\u00a0h 05\u00a0min')
  })

  it('signs deltas with a real minus', () => {
    expect(fmtSignedKmh(0.3)).toBe('+0.3\u00a0km/h')
    expect(fmtSignedKmh(-0.25)).toBe('−0.3\u00a0km/h')
    expect(fmtSignedKm(-1500)).toBe('−1.5\u00a0km')
  })

  it('repeats exactly the figures the cells show', () => {
    expect(
      summaryParts({
        weekDistanceM: 12_400,
        weekSessions: 4,
        streakDays: 3,
        paceKmh: 4.5,
        paceDeltaKmh: 0.3,
        prior: 'prior 30 d',
        period: '30 d',
      }),
    ).toEqual({
      sentence: '12.4\u00a0km this week in 4 walks',
      facts: ['streak 3 d', 'pace 4.5\u00a0km/h, +0.3\u00a0km/h vs the prior 30 d'],
    })
  })

  it('writes an unknown pace and a single walk plainly', () => {
    expect(
      summaryParts({
        weekDistanceM: 3000,
        weekSessions: 1,
        streakDays: 0,
        paceKmh: null,
        paceDeltaKmh: null,
        prior: 'prior 30 d',
        period: '30 d',
      }),
    ).toEqual({ sentence: '3.0\u00a0km this week in 1 walk', facts: ['streak 0 d', 'pace —'] })
  })

  it('an unreadable streak is a dash, never 0', () => {
    expect(
      summaryParts({
        weekDistanceM: 1000,
        weekSessions: 1,
        streakDays: null,
        paceKmh: null,
        paceDeltaKmh: null,
        prior: 'prior 30 d',
        period: '30 d',
      }).facts,
    ).toEqual(['streak —', 'pace —'])
  })

  it('an unreported week says so in words', () => {
    expect(
      summaryParts({
        weekDistanceM: null,
        weekSessions: null,
        streakDays: 2,
        paceKmh: 4,
        paceDeltaKmh: -0.2,
        prior: 'prior 30 d',
        period: '30 d',
      }),
    ).toEqual({
      sentence: 'No walks reported this week',
      facts: ['streak 2 d', 'pace 4.0\u00a0km/h, \u22120.2\u00a0km/h vs the prior 30 d'],
    })
  })

  it('says when pace has no prior window to compare', () => {
    expect(
      summaryParts({
        weekDistanceM: 0,
        weekSessions: 0,
        streakDays: 0,
        paceKmh: 3.4,
        paceDeltaKmh: null,
        prior: 'prior window',
        period: 'all time',
      }),
    ).toEqual({
      sentence: '0.0\u00a0km this week in 0 walks',
      facts: ['streak 0 d', 'pace 3.4\u00a0km/h over all time'],
    })
  })
})

describe('emptyWindowParts', () => {
  const now = Date.parse('2026-01-20T10:00:00Z')

  it('names the window, the days since the last walk and its date', () => {
    expect(
      emptyWindowParts({ preset: '7d', lastEndedAt: '2026-01-05T08:00:00Z', nowMs: now }).sentence,
    ).toBe('No walks in the last 7 days; the last was 15 d ago, on Jan 5')
  })

  it('a walk earlier today reads today', () => {
    expect(
      emptyWindowParts({ preset: '7d', lastEndedAt: '2026-01-20T06:00:00Z', nowMs: now }).sentence,
    ).toContain('the last was today, on Jan 20')
  })

  it('the day count follows the printed day keys, never elapsed hours', () => {
    // 23 h elapsed but a different UTC day: "1 d ago, on Jan 19", never "today, on Jan 19".
    const late = Date.parse('2026-01-20T01:00:00Z')
    expect(
      emptyWindowParts({ preset: '7d', lastEndedAt: '2026-01-19T02:00:00Z', nowMs: late }).sentence,
    ).toContain('the last was 1 d ago, on Jan 19')
  })

  it('a failed lookup names the window only, never "no walks recorded"', () => {
    expect(emptyWindowParts({ preset: '7d', lastEndedAt: undefined, nowMs: now }).sentence).toBe(
      'No walks in the last 7 days',
    )
    expect(emptyWindowParts({ preset: '7d', lastEndedAt: 'garbage', nowMs: now }).sentence).toBe(
      'No walks in the last 7 days',
    )
  })

  it('no walk ever recorded says so', () => {
    expect(emptyWindowParts({ preset: '7d', lastEndedAt: null, nowMs: now }).sentence).toBe(
      'No walks recorded yet',
    )
  })
})
