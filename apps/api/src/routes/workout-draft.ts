import { Elysia } from 'elysia'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workoutDraft } from '../db/schema.js'
import { DraftMapSchema, DraftSchema, readDrafts } from '../lib/workout-draft.js'

// The in-progress workout — what is on screen between opening the form and
// pressing Save. Shape is owned by the dashboard
// (`apps/dashboard/src/lib/queries/workout-draft.ts`); `../lib/workout-draft` is
// the wire contract that keeps the stored blob honest, since the column is jsonb.
//
// ── Conflict policy: last-write-wins per exercise, never a merge ─────────────
//
// The stored value is a map keyed by `exercise_id`, and each entry is replaced
// whole. Two reasons not to merge:
//
//  1. Per-exercise keys already remove the collision that actually happens.
//     A session driven from two devices is normally two different lifts — the
//     laptop on bench while the phone is on squat. Those never touch the same
//     key, and each PUT writes exactly one key (`jsonb_set` on one path), so
//     neither device can clobber the other's draft.
//  2. For the residual case — both devices on the SAME exercise — a set list is
//     a small ordered structure whose entries are positional. A field-level
//     merge of two set arrays produces sets that nobody entered (device A's
//     weight against device B's reps). One session being driven from two places
//     has exactly one truth: the most recent edit. So the whole draft is
//     replaced, and the loser's edit is dropped rather than blended.
//
// The client is what keeps last-write-wins from meaning "the poll overwrites me
// mid-keystroke": it only adopts a remote draft while its own copy is settled
// (nothing focused, nothing pending). See the client module for that half.
const ResponseSchema = z.object({
  drafts: DraftMapSchema,
  updated_at: z.string().nullable(),
})

// Normalize-then-write, so the update works from any prior row state — including
// a `state` that somehow lost its `drafts` key, which plain `jsonb_set` would
// silently no-op on (create_missing only creates the LEAF, not its parent).
const normalized = sql`jsonb_build_object('drafts', coalesce(${workoutDraft.state}->'drafts', '{}'::jsonb))`

export const workoutDraftRoutes = new Elysia({ prefix: '/workout-draft' })
  .get(
    '',
    async () => {
      const [row] = await db.select().from(workoutDraft).where(eq(workoutDraft.id, 1))
      if (!row) return { drafts: {}, updated_at: null }
      return { drafts: readDrafts(row.state, Date.now()), updated_at: row.updated_at }
    },
    {
      response: ResponseSchema,
      detail: {
        tags: ['Strength'],
        summary: 'Get in-progress workout drafts',
        description:
          'Returns the workout currently being entered on any device, as a map keyed by exercise_id — each entry holding the session date, its set list (weight/reps/type) and how many sets have been checked off. This is unsaved scratch state that lets a session started on one device be picked up on another; it is NOT training history. Entries older than 12 hours are treated as abandoned and are not returned. For logged sessions use GET /workouts. Write with PUT /workout-draft/{exerciseId} and clear with DELETE /workout-draft/{exerciseId}.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .put(
    '/:exerciseId',
    async ({ params, body }) => {
      const now = new Date().toISOString()
      const draft = { ...body, updated_at: now }
      // Written as a single-path jsonb_set rather than a whole-state replace:
      // the other keys in the map belong to other devices' in-flight drafts, and
      // a read-modify-write here would drop any that appeared since our last GET.
      const [saved] = await db
        .insert(workoutDraft)
        .values({ id: 1, state: { drafts: { [params.exerciseId]: draft } }, updated_at: now })
        .onConflictDoUpdate({
          target: workoutDraft.id,
          set: {
            state: sql`jsonb_set(${normalized}, array['drafts', ${params.exerciseId}], ${JSON.stringify(draft)}::jsonb, true)`,
            updated_at: now,
          },
        })
        .returning()
      return { drafts: readDrafts(saved?.state, Date.now()), updated_at: saved?.updated_at ?? now }
    },
    {
      params: z.object({ exerciseId: z.string().min(1) }),
      body: DraftSchema.omit({ updated_at: true }),
      response: ResponseSchema,
      detail: {
        tags: ['Strength'],
        summary: 'Save the in-progress draft for one exercise',
        description:
          "Upserts the draft for a single exercise_id — send the whole draft ({ date, sets, completedCount }), not a patch. updated_at is stamped server-side, so callers must not send it. Only this exercise's key is written, so concurrent drafts for other exercises are never disturbed; the same exercise is last-write-wins with no merge. Returns the full draft map after the write. This does NOT log a workout — use POST /workouts for that, then DELETE /workout-draft/{exerciseId} to clear the scratch state.",
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .delete(
    '/:exerciseId',
    async ({ params }) => {
      const now = new Date().toISOString()
      const [saved] = await db
        .update(workoutDraft)
        .set({
          state: sql`${normalized} #- array['drafts', ${params.exerciseId}]`,
          updated_at: now,
        })
        .where(eq(workoutDraft.id, 1))
        .returning()
      // No row at all means nothing was ever drafted — already the desired state.
      if (!saved) return { drafts: {}, updated_at: null }
      return { drafts: readDrafts(saved.state, Date.now()), updated_at: saved.updated_at }
    },
    {
      params: z.object({ exerciseId: z.string().min(1) }),
      response: ResponseSchema,
      detail: {
        tags: ['Strength'],
        summary: 'Clear the in-progress draft for one exercise',
        description:
          'Removes one exercise_id from the draft map — what the dashboard calls after POST /workouts succeeds, so the session that was just logged stops being offered as unsaved work on the other device. Idempotent: deleting a draft that is not there is a no-op. Returns the remaining draft map.',
        security: [{ BearerAuth: [] }],
      },
    },
  )
