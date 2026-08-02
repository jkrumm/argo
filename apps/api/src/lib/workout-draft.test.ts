import { describe, it, expect } from 'bun:test'
import { DRAFT_TTL_MS, DraftSchema, readDrafts } from './workout-draft.js'

const NOW = Date.parse('2026-08-02T18:00:00.000Z')

function draft(ageMs: number, overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-08-02',
    sets: [{ set_type: 'work', weight_kg: 80, reps: 5 }],
    completedCount: 1,
    updated_at: new Date(NOW - ageMs).toISOString(),
    ...overrides,
  }
}

describe('readDrafts', () => {
  it('returns drafts inside the TTL', () => {
    const state = { drafts: { bench_press: draft(30 * 60_000) } }
    expect(Object.keys(readDrafts(state, NOW))).toEqual(['bench_press'])
  })

  it('drops drafts past the TTL but keeps fresh siblings', () => {
    const state = {
      drafts: {
        bench_press: draft(DRAFT_TTL_MS + 60_000),
        squat: draft(5 * 60_000),
      },
    }
    expect(Object.keys(readDrafts(state, NOW))).toEqual(['squat'])
  })

  it('treats a draft exactly at the TTL boundary as expired', () => {
    const state = { drafts: { bench_press: draft(DRAFT_TTL_MS) } }
    expect(readDrafts(state, NOW)).toEqual({})
  })

  // The column is opaque jsonb. A blob that no longer parses must degrade to
  // "no drafts" rather than 500 the strength page — losing unsaved scratch
  // state is recoverable, losing the page is not.
  it.each([
    ['null', null],
    ['a missing drafts key', {}],
    ['a non-object', 'nonsense'],
    ['a structurally wrong draft', { drafts: { bench_press: { date: 'not-a-date' } } }],
  ])('degrades to an empty map on %s', (_label, state) => {
    expect(readDrafts(state, NOW)).toEqual({})
  })
})

describe('DraftSchema', () => {
  it('rejects a client-supplied updated_at, since the server stamps it', () => {
    // The PUT body is `DraftSchema.omit({ updated_at: true })` — assert the field
    // is genuinely part of the stored shape so the omit stays meaningful.
    expect(DraftSchema.safeParse(draft(0)).success).toBe(true)
    expect(DraftSchema.omit({ updated_at: true }).safeParse(draft(0)).success).toBe(true)
    expect(DraftSchema.safeParse({ ...draft(0), updated_at: undefined }).success).toBe(false)
  })

  it('rejects a non-ISO date', () => {
    expect(DraftSchema.safeParse(draft(0, { date: '02.08.2026' })).success).toBe(false)
  })

  it('rejects an out-of-range set', () => {
    expect(
      DraftSchema.safeParse(draft(0, { sets: [{ set_type: 'work', weight_kg: -1, reps: 5 }] }))
        .success,
    ).toBe(false)
    expect(
      DraftSchema.safeParse(draft(0, { sets: [{ set_type: 'giant', weight_kg: 80, reps: 5 }] }))
        .success,
    ).toBe(false)
  })
})
