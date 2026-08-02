import { z } from 'zod'

// The in-progress workout — what is on screen between opening the log form and
// pressing Save. Kept out of the route so the TTL rule is unit-testable without
// a database; the route owns transport, this owns the shape and the expiry.

export const DraftSetSchema = z.object({
  set_type: z.enum(['warmup', 'work', 'drop', 'amrap']),
  weight_kg: z.number().min(0).max(1000),
  reps: z.number().int().min(0).max(100),
})

export const DraftSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date (YYYY-MM-DD)'),
  sets: z.array(DraftSetSchema).max(50),
  // How far down the checklist the user has ticked off — session position, not a
  // derived value, so it has to travel with the draft or picking the phone up
  // mid-workout restarts the check-off.
  completedCount: z.number().int().min(0).max(50),
  // Server clock, stamped on write. Never sent by the client: two devices' clocks
  // would be the only thing ordering the drafts, and a phone running a minute
  // fast would make its stale draft look newer forever.
  updated_at: z.string(),
})

export const DraftMapSchema = z.record(z.string(), DraftSchema)

export type WorkoutDraftMap = z.infer<typeof DraftMapSchema>

// A draft is session state, not a document — nobody resumes yesterday's
// half-entered bench press. Anything older is dropped on read rather than
// offered back, so a session abandoned in the gym can't surface a week later and
// get saved by accident. No sweeper job is needed: the map holds at most one
// entry per exercise, so a stale key costs a few hundred bytes until that
// exercise is trained again and overwrites it.
export const DRAFT_TTL_MS = 12 * 60 * 60 * 1000

/**
 * Parse the stored jsonb blob and drop expired entries.
 *
 * Tolerant by design: the column is opaque jsonb, and a blob that no longer
 * parses must degrade to "no drafts" rather than 500 the strength page. Losing
 * unsaved scratch state is recoverable; losing the page is not.
 */
export function readDrafts(state: unknown, now: number): WorkoutDraftMap {
  const parsed = z.object({ drafts: DraftMapSchema }).safeParse(state)
  if (!parsed.success) return {}
  return Object.fromEntries(
    Object.entries(parsed.data.drafts).filter(
      ([, draft]) => now - new Date(draft.updated_at).getTime() < DRAFT_TTL_MS,
    ),
  )
}
