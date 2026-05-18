import { describe, it, expect } from 'bun:test'
import {
  bucketSessions,
  computeWalkingPadHeroes,
  detectWalkingPadAchievements,
  hourOfDayMatrix,
  isoWeekKey,
  sessionDistributionHistogram,
  type WalkingPadSessionRow,
} from './walking-pad-formulas.js'

const row = (
  uuid: string,
  startedAt: string,
  overrides: Partial<WalkingPadSessionRow> = {},
): WalkingPadSessionRow => ({
  uuid,
  started_at: startedAt,
  ended_at: startedAt,
  duration_s: 600,
  distance_m: 800,
  steps: 1000,
  avg_speed_kmh: 4.8,
  max_speed_kmh: 5.5,
  kcal: 35,
  pause_count: 0,
  ...overrides,
})

describe('detectWalkingPadAchievements', () => {
  it('fires first_walk on the very first real session', () => {
    const incoming = row('a', '2026-05-17T10:00:00Z')
    const out = detectWalkingPadAchievements('a', [incoming], [])
    const types = out.map((a) => a.type)
    expect(types).toContain('first_walk')
    expect(types).toContain('longest_distance')
    expect(types).toContain('longest_duration')
    expect(types).toContain('most_steps')
  })

  it('does not fire first_walk a second time even without an explicit prior unlock', () => {
    const prior = row('a', '2026-05-10T10:00:00Z')
    const incoming = row('b', '2026-05-17T10:00:00Z')
    const out = detectWalkingPadAchievements(
      'b',
      [prior, incoming],
      [{ type: 'first_walk', value: 800, unlocked_at: '2026-05-10T10:01:00Z' }],
    )
    expect(out.map((a) => a.type)).not.toContain('first_walk')
  })

  it('emits a distance PR only when the value strictly beats prior unlock', () => {
    const prior = row('a', '2026-05-10T10:00:00Z', { distance_m: 1500 })
    const sameAsRecord = row('b', '2026-05-17T10:00:00Z', { distance_m: 1500 })
    const beats = row('c', '2026-05-17T11:00:00Z', { distance_m: 1501 })
    const sameOut = detectWalkingPadAchievements(
      'b',
      [prior, sameAsRecord],
      [
        { type: 'first_walk', value: 1500, unlocked_at: '2026-05-10T10:01:00Z' },
        { type: 'longest_distance', value: 1500, unlocked_at: '2026-05-10T10:01:00Z' },
      ],
    )
    expect(sameOut.map((a) => a.type)).not.toContain('longest_distance')

    const beatsOut = detectWalkingPadAchievements(
      'c',
      [prior, sameAsRecord, beats],
      [{ type: 'longest_distance', value: 1500, unlocked_at: '2026-05-10T10:01:00Z' }],
    )
    expect(beatsOut.map((a) => a.type)).toContain('longest_distance')
  })

  it('fires streak_3 on the third consecutive UTC day', () => {
    const sessions = [
      row('a', '2026-05-15T10:00:00Z'),
      row('b', '2026-05-16T10:00:00Z'),
      row('c', '2026-05-17T10:00:00Z'),
    ]
    const out = detectWalkingPadAchievements('c', sessions, [])
    expect(out.map((a) => a.type)).toContain('streak_3')
  })

  it('does not refire streak_3 on a second walk the same day', () => {
    const sessions = [
      row('a', '2026-05-15T10:00:00Z'),
      row('b', '2026-05-16T10:00:00Z'),
      row('c', '2026-05-17T08:00:00Z'),
      row('d', '2026-05-17T14:00:00Z'),
    ]
    const out = detectWalkingPadAchievements('d', sessions, [
      { type: 'streak_3', value: 3, unlocked_at: '2026-05-17T08:01:00Z' },
    ])
    expect(out.map((a) => a.type)).not.toContain('streak_3')
  })

  it('fires distance_milestone_10_km when crossing the threshold', () => {
    const prior = row('a', '2026-05-10T10:00:00Z', { distance_m: 9500 })
    const incoming = row('b', '2026-05-17T10:00:00Z', { distance_m: 700 })
    const out = detectWalkingPadAchievements('b', [prior, incoming], [])
    expect(out.map((a) => a.type)).toContain('distance_milestone_10_km')
  })

  it('emits multi_walk_day exactly on the third real session of the same UTC day', () => {
    const sessions = [
      row('a', '2026-05-17T07:00:00Z'),
      row('b', '2026-05-17T12:00:00Z'),
      row('c', '2026-05-17T18:00:00Z'),
      row('d', '2026-05-17T20:00:00Z'),
    ]
    const onThird = detectWalkingPadAchievements('c', sessions, [])
    const onFourth = detectWalkingPadAchievements('d', sessions, [
      { type: 'multi_walk_day', value: 3, unlocked_at: '2026-05-17T18:01:00Z' },
    ])
    expect(onThird.map((a) => a.type)).toContain('multi_walk_day')
    expect(onFourth.map((a) => a.type)).not.toContain('multi_walk_day')
  })

  it('does not award weekly_distance_pr on day 2 (fragment weeks, no complete baseline)', () => {
    // User walks once Sunday (week W) and once Monday (week W+1). Without the
    // completeness guard, day-2 trivially "beats" day-1's week. With it, the
    // PR is suppressed because the incoming week is still in progress and
    // there are fewer than 2 complete prior weeks.
    const sunday = row('a', '2026-05-17T18:00:00Z', { distance_m: 500 })
    const monday = row('b', '2026-05-18T07:00:00Z', { distance_m: 1500 })
    const out = detectWalkingPadAchievements(
      'b',
      [sunday, monday],
      [],
      new Date('2026-05-18T08:00:00Z'),
    )
    expect(out.map((a) => a.type)).not.toContain('weekly_distance_pr')
  })

  it('awards weekly_distance_pr when the incoming week is complete and the baseline has >=2 complete prior weeks', () => {
    // Three complete weeks before incoming (W18, W19, W20). Then a session in
    // W21 — which is also complete by the time `now` is reached — that totals
    // more than any prior week.
    const w18 = row('a', '2026-04-27T10:00:00Z', { distance_m: 5000 })
    const w19 = row('b', '2026-05-04T10:00:00Z', { distance_m: 6000 })
    const w20 = row('c', '2026-05-11T10:00:00Z', { distance_m: 7000 })
    const w21a = row('d', '2026-05-18T10:00:00Z', { distance_m: 8000 })
    const w21b = row('e', '2026-05-22T10:00:00Z', { distance_m: 2000 })
    const out = detectWalkingPadAchievements(
      'e',
      [w18, w19, w20, w21a, w21b],
      [],
      new Date('2026-05-25T08:00:00Z'),
    )
    const pr = out.find((a) => a.type === 'weekly_distance_pr')
    expect(pr).toBeDefined()
    expect(pr?.value).toBe(10_000)
  })

  it('does not award weekly_distance_pr while the incoming week is still in progress', () => {
    // Plenty of complete prior weeks, but the incoming session is in the
    // current (mid-)week. Hold the PR until the week actually closes.
    const w18 = row('a', '2026-04-27T10:00:00Z', { distance_m: 5000 })
    const w19 = row('b', '2026-05-04T10:00:00Z', { distance_m: 6000 })
    const w20 = row('c', '2026-05-11T10:00:00Z', { distance_m: 7000 })
    const inProgress = row('d', '2026-05-19T10:00:00Z', { distance_m: 20_000 })
    const out = detectWalkingPadAchievements(
      'd',
      [w18, w19, w20, inProgress],
      [],
      new Date('2026-05-19T18:00:00Z'),
    )
    expect(out.map((a) => a.type)).not.toContain('weekly_distance_pr')
  })

  it('skips tiny non-real sessions for PR detection', () => {
    const incoming = row('a', '2026-05-17T10:00:00Z', {
      duration_s: 20,
      distance_m: 30,
      steps: 40,
    })
    const out = detectWalkingPadAchievements('a', [incoming], [])
    expect(out).toEqual([])
  })
})

describe('computeWalkingPadHeroes', () => {
  it('reports volume direction increasing when current beats prior by >5%', () => {
    const now = new Date('2026-05-17T12:00:00Z')
    const current = [row('a', '2026-05-15T10:00:00Z', { distance_m: 2000 })]
    const prior = [row('b', '2026-04-15T10:00:00Z', { distance_m: 1500 })]
    const heroes = computeWalkingPadHeroes(current, prior, [...current, ...prior], now)
    expect(heroes.volume.direction).toBe('increasing')
    expect(heroes.volume.deltaPct).toBeGreaterThan(0.3)
  })

  it('reports streak ending today when walked today', () => {
    const now = new Date('2026-05-17T20:00:00Z')
    const sessions = [
      row('a', '2026-05-15T10:00:00Z'),
      row('b', '2026-05-16T10:00:00Z'),
      row('c', '2026-05-17T10:00:00Z'),
    ]
    const heroes = computeWalkingPadHeroes(sessions, [], sessions, now)
    expect(heroes.streak.currentDays).toBe(3)
    expect(heroes.streak.walkedToday).toBe(true)
  })

  it('keeps the streak alive until end-of-day even when today has no walk yet', () => {
    const now = new Date('2026-05-17T08:00:00Z')
    const sessions = [row('a', '2026-05-15T10:00:00Z'), row('b', '2026-05-16T10:00:00Z')]
    const heroes = computeWalkingPadHeroes([], [], sessions, now)
    expect(heroes.streak.currentDays).toBe(2)
    expect(heroes.streak.walkedToday).toBe(false)
  })
})

describe('bucketSessions', () => {
  it('returns one empty bucket per day across the window', () => {
    const from = new Date('2026-05-15T00:00:00Z')
    const to = new Date('2026-05-17T23:59:59Z')
    const points = bucketSessions([], 'day', from, to)
    expect(points.map((p) => p.date)).toEqual(['2026-05-15', '2026-05-16', '2026-05-17'])
    expect(points.every((p) => p.sessions === 0)).toBe(true)
  })

  it('aggregates by ISO week with distance-weighted avg speed', () => {
    const from = new Date('2026-05-11T00:00:00Z')
    const to = new Date('2026-05-17T23:59:59Z')
    const sessions = [
      row('a', '2026-05-12T10:00:00Z', { distance_m: 1000, avg_speed_kmh: 4 }),
      row('b', '2026-05-14T10:00:00Z', { distance_m: 3000, avg_speed_kmh: 6 }),
    ]
    const points = bucketSessions(sessions, 'week', from, to)
    expect(points.length).toBe(1)
    expect(points[0]?.sessions).toBe(2)
    expect(points[0]?.distance_m).toBe(4000)
    // weighted: (1000*4 + 3000*6) / 4000 = 5.5
    expect(points[0]?.avg_speed_kmh).toBe(5.5)
  })
})

describe('hourOfDayMatrix', () => {
  it('produces a 7x24 grid filled with zeros plus one populated cell', () => {
    const cells = hourOfDayMatrix([row('a', '2026-05-17T10:00:00Z')])
    expect(cells.length).toBe(7 * 24)
    const populated = cells.filter((c) => c.sessions > 0)
    expect(populated.length).toBe(1)
    expect(populated[0]?.hour).toBe(10)
  })
})

describe('sessionDistributionHistogram', () => {
  it('clamps long sessions at the top duration bucket', () => {
    const sessions = [
      row('a', '2026-05-17T10:00:00Z', { duration_s: 60 * 7 }), // 7 min → bucket 5
      row('b', '2026-05-17T10:00:00Z', { duration_s: 60 * 130 }), // 130 min → bucket 90 (clamp)
    ]
    const hist = sessionDistributionHistogram(sessions, 'duration')
    const b5 = hist.find((b) => b.bucketStart === 5)
    const b90 = hist.find((b) => b.bucketStart === 90)
    expect(b5?.sessions).toBe(1)
    expect(b90?.sessions).toBe(1)
  })

  it('buckets by steps in 1000-step bins, clamping at 20000', () => {
    const sessions = [
      row('a', '2026-05-17T10:00:00Z', { steps: 800 }), // bucket 0
      row('b', '2026-05-17T10:00:00Z', { steps: 7500 }), // bucket 7000
      row('c', '2026-05-17T10:00:00Z', { steps: 7900 }), // bucket 7000
      row('d', '2026-05-17T10:00:00Z', { steps: 50_000 }), // bucket 20000 (clamp)
    ]
    const hist = sessionDistributionHistogram(sessions, 'steps')
    expect(hist.find((b) => b.bucketStart === 0)?.sessions).toBe(1)
    expect(hist.find((b) => b.bucketStart === 7000)?.sessions).toBe(2)
    expect(hist.find((b) => b.bucketStart === 20_000)?.sessions).toBe(1)
    expect(hist[0]?.bucketWidth).toBe(1000)
  })

  it('buckets by distance in 500-m bins, clamping at 10000', () => {
    const sessions = [
      row('a', '2026-05-17T10:00:00Z', { distance_m: 250 }), // bucket 0
      row('b', '2026-05-17T10:00:00Z', { distance_m: 800 }), // bucket 500
      row('c', '2026-05-17T10:00:00Z', { distance_m: 15_000 }), // bucket 10000 (clamp)
    ]
    const hist = sessionDistributionHistogram(sessions, 'distance')
    expect(hist.find((b) => b.bucketStart === 0)?.sessions).toBe(1)
    expect(hist.find((b) => b.bucketStart === 500)?.sessions).toBe(1)
    expect(hist.find((b) => b.bucketStart === 10_000)?.sessions).toBe(1)
    expect(hist[0]?.bucketWidth).toBe(500)
  })
})

describe('isoWeekKey', () => {
  it('matches ISO-8601 week numbering', () => {
    expect(isoWeekKey('2026-01-05T10:00:00Z')).toBe('2026-W02')
    expect(isoWeekKey('2025-12-29T10:00:00Z')).toBe('2026-W01')
  })
})
