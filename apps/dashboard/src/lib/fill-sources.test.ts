import { describe, it, expect } from 'bun:test'
import { fillSources, type SessionRow } from './fill-sources'

function session(
  id: number,
  date: string,
  estimated_1rm: number | null,
  sets: Array<[type: string, weight: number, reps: number]>,
): SessionRow {
  return {
    id,
    date,
    estimated_1rm,
    sets: sets.map(([set_type, weight_kg, reps], i) => ({
      set_number: i + 1,
      set_type,
      weight_kg,
      reps,
    })),
  }
}

const NOT_BW = { isBodyweight: false }

describe('fillSources', () => {
  it('returns nothing without history', () => {
    expect(fillSources([], NOT_BW)).toEqual([])
  })

  it('ignores sessions with no sets', () => {
    expect(fillSources([session(1, '2026-07-01', 80, [])], NOT_BW)).toEqual([])
  })

  it('picks the most recent session as "Last", regardless of array order', () => {
    const history = [
      session(1, '2026-06-01', 70, [['work', 70, 5]]),
      session(2, '2026-07-20', 75, [['work', 75, 5]]),
      session(3, '2026-07-01', 72, [['work', 72, 5]]),
    ]
    const last = fillSources(history, NOT_BW).find((s) => s.key === 'last')
    expect(last?.date).toBe('2026-07-20')
  })

  it('replays the session exactly, ordered by set_number', () => {
    const history = [
      session(1, '2026-07-20', 90, [
        ['work', 80, 5],
        ['warmup', 40, 10],
        ['drop', 60, 8],
      ]),
    ]
    // Sets arrive out of order from the API only if set_number says so; here the
    // fixture numbers them in array order, so the replay must preserve it.
    expect(fillSources(history, NOT_BW)[0]?.sets).toEqual([
      { set_type: 'work', weight_kg: 80, reps: 5 },
      { set_type: 'warmup', weight_kg: 40, reps: 10 },
      { set_type: 'drop', weight_kg: 60, reps: 8 },
    ])
  })

  it('falls back to "work" for an unrecognised set type rather than dropping the set', () => {
    const history = [session(1, '2026-07-20', 90, [['giant', 80, 5]])]
    expect(fillSources(history, NOT_BW)[0]?.sets).toEqual([
      { set_type: 'work', weight_kg: 80, reps: 5 },
    ])
  })

  it('offers last, best and max when they are three different sessions', () => {
    const history = [
      session(1, '2026-07-20', 82, [['work', 80, 5]]), // last
      session(2, '2026-07-10', 95, [['work', 85, 8]]), // best e1RM
      session(3, '2026-07-05', 90, [['work', 100, 1]]), // heaviest
    ]
    const sources = fillSources(history, NOT_BW)
    expect(sources.map((s) => s.key)).toEqual(['last', 'best', 'max'])
    expect(sources.map((s) => s.date)).toEqual(['2026-07-20', '2026-07-10', '2026-07-05'])
  })

  // Two buttons that fill the same thing are worse than one.
  it('dedupes when best and max are the same session', () => {
    const history = [
      session(1, '2026-07-20', 70, [['work', 60, 5]]),
      session(2, '2026-07-10', 95, [['work', 100, 3]]),
    ]
    const sources = fillSources(history, NOT_BW)
    expect(sources.map((s) => s.key)).toEqual(['last', 'best'])
    expect(sources.map((s) => s.date)).toEqual(['2026-07-20', '2026-07-10'])
  })

  it('collapses to a single source when one session is last, best and max', () => {
    const history = [session(1, '2026-07-20', 95, [['work', 100, 3]])]
    expect(fillSources(history, NOT_BW).map((s) => s.key)).toEqual(['last'])
  })

  // Same reason the form suppresses PR trophies for pull-ups: stored weight is
  // ADDED weight, scored against a bodyweight this form does not have.
  it('offers only "Last" for a bodyweight exercise', () => {
    const history = [
      session(1, '2026-07-20', 70, [['work', 0, 12]]),
      session(2, '2026-07-10', 95, [['work', 20, 5]]),
    ]
    expect(fillSources(history, { isBodyweight: true }).map((s) => s.key)).toEqual(['last'])
  })

  it('reads max weight from work sets only, matching the PR rules', () => {
    const history = [
      session(1, '2026-07-20', 70, [['work', 60, 5]]),
      // A 120 kg warmup would be nonsense, but the rule is what is under test:
      // only `work` sets can claim the max.
      session(2, '2026-07-10', 60, [
        ['warmup', 120, 1],
        ['work', 70, 5],
      ]),
    ]
    const max = fillSources(history, NOT_BW).find((s) => s.key === 'max')
    expect(max?.date).toBe('2026-07-10')
    expect(max?.detail).toBe('70 kg')
  })

  it('skips "best" when no session has a recorded e1RM', () => {
    const history = [
      session(1, '2026-07-20', null, [['work', 60, 5]]),
      session(2, '2026-07-10', null, [['work', 80, 3]]),
    ]
    expect(fillSources(history, NOT_BW).map((s) => s.key)).toEqual(['last', 'max'])
  })

  it('formats half-plate weights without trailing zeros', () => {
    const history = [session(1, '2026-07-20', 97.5, [['work', 92.5, 3]])]
    const [last] = fillSources(history, NOT_BW)
    expect(last?.detail).toBe('92.5')
    expect(last?.title).toContain('92.5×3')
  })
})
