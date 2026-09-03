import { useCallback, useEffect, useRef } from 'react'
import {
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'

// The workout being ENTERED, synced across devices — start a session on the Mac,
// finish it on the phone in the gym, come back. Backed by `/workout-draft`,
// which stores one draft per exercise.
//
// This is the same poll-and-adopt shape as `./gym`, but the two have opposite
// edit rates and that changes everything about the rules. Gym equipment is
// edited a few times a year, so a 5s poll can simply win: the odds of it landing
// mid-edit are negligible, and suspending it during a save covers the rest. A
// workout draft is edited CONTINUOUSLY — a weight per set, a rep count, a tick,
// every few seconds for forty minutes. A poll that wins unconditionally there
// would reach in and rewrite the row the user is standing in.
//
// So the transport here is deliberately asymmetric:
//
//   WRITE  debounced (`WRITE_DEBOUNCE_MS`) — one PUT per pause, not one per
//          keystroke — and flushed on tab-hide/unmount, because a phone going
//          into a pocket mid-set must not lose the set.
//   READ   polled like gym, but the result is NOT applied by this module. It is
//          only cached. Whether a remote draft may replace what is on screen is
//          a question about focus and local edits, which only the form can
//          answer — `isSettled()` is this module's half of it (see the form).
//
// Conflict resolution is last-write-wins on a whole per-exercise draft, never a
// merge; the reasoning is in `apps/api/src/routes/workout-draft.ts`.

export type DraftSet = {
  set_type: 'warmup' | 'work' | 'drop' | 'amrap'
  weight_kg: number
  reps: number
}

/** What the form owns and this module ships. `updated_at` is stamped server-side. */
export type DraftInput = {
  date: string
  sets: DraftSet[]
  completedCount: number
}

export type WorkoutDraft = DraftInput & { updated_at: string }

export type WorkoutDraftMap = Record<string, WorkoutDraft>

/** What every `/workout-draft` endpoint returns — the whole map, post-write. */
type DraftResponse = { drafts: WorkoutDraftMap; updated_at: string | null }

// Matched to `./gym`: tight enough that walking to the other device and looking
// at it reads as live rather than as a bug. `refetchIntervalInBackground` stays
// at its default `false` — a phone in a gym bag stops polling entirely.
const DRAFT_POLL_MS = 5_000

// One PUT per pause in the entry, not one per tap. Long enough to swallow a
// three-tap weight adjustment, short enough that setting the phone down and
// picking up the laptop lands the draft before you get there.
const WRITE_DEBOUNCE_MS = 900

// How long the local copy stays "the user's" after the last edit. The debounce
// and the in-flight guard already cover the mechanical window; this is the human
// one — a pause between two taps of the same stepper is not an invitation to
// overwrite the row being tapped.
const SETTLE_MS = 2_000

const DRAFT_SAVE_KEY = ['workout-draft', 'save'] as const

export const workoutDraftQueries = {
  all: () => ['workout-draft'] as const,
  state: () =>
    queryOptions({
      queryKey: [...workoutDraftQueries.all(), 'state'] as const,
      queryFn: async () => unwrap(await api['workout-draft'].get()),
      // Matched to the poll so a remount inside one interval doesn't serve data
      // the poll already considers old.
      staleTime: DRAFT_POLL_MS,
      // The interval is paused while the tab is hidden, so this is what makes
      // picking the phone back up pull immediately instead of up to 5s later.
      refetchOnWindowFocus: true,
    }),
}

/**
 * Owns the 5s poll. Mount this **once**, on the page that logs workouts — never
 * inside `useWorkoutDrafts`.
 *
 * Same reason as `useGymSync`: every QueryObserver gets its own interval timer
 * and only overlapping fetches dedupe, so putting the interval in the shared
 * query options would multiply the request rate by the number of subscribers.
 *
 * The poll suspends while a save is in flight — a tick landing between the
 * optimistic write and the PUT that backs it would serve the pre-edit draft back
 * to the very form that just changed it.
 */
export function useWorkoutDraftSync(): void {
  const saving = useIsMutating({ mutationKey: DRAFT_SAVE_KEY }) > 0
  useQuery({
    ...workoutDraftQueries.state(),
    refetchInterval: saving ? false : DRAFT_POLL_MS,
  })
}

/**
 * The cross-device draft store: the current draft map, a debounced writer, and
 * the `isSettled()` gate that says whether the local copy may be replaced.
 *
 * Reads the shared cache — no interval here, see `useWorkoutDraftSync`.
 */
export function useWorkoutDrafts(): {
  drafts: WorkoutDraftMap
  /** Bumped by every successful fetch — a dependency to re-check adoption on. */
  dataUpdatedAt: number
  /** Queue a debounced write of one exercise's draft. */
  push(exerciseId: string, draft: DraftInput): void
  /** Drop one exercise's draft now, cancelling any queued write for it. */
  clear(exerciseId: string): void
  /**
   * True when nothing local is in flight or recently touched, i.e. when a remote
   * draft may be adopted without stepping on the user. The caller must still
   * check whatever it knows about focus — this only sees the transport.
   */
  isSettled(): boolean
} {
  const qc = useQueryClient()
  const queryKey = workoutDraftQueries.state().queryKey
  const query = useQuery(workoutDraftQueries.state())

  const save = useMutation({
    mutationKey: DRAFT_SAVE_KEY,
    mutationFn: ({ exerciseId, draft }: { exerciseId: string; draft: DraftInput }) =>
      api['workout-draft']({ exerciseId }).put(draft).then(unwrap),
    // The server echoes the whole map, so there is nothing to invalidate — and
    // deliberately no optimistic update: the local copy IS the source of truth
    // until it lands, and writing it into the cache too would make the equality
    // check in the form think the round-trip had already happened.
    onSuccess: (data) => qc.setQueryData(queryKey, data),
  })

  const remove = useMutation({
    mutationKey: DRAFT_SAVE_KEY,
    mutationFn: (exerciseId: string) => api['workout-draft']({ exerciseId }).delete().then(unwrap),
    onSuccess: (data) => qc.setQueryData(queryKey, data),
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ exerciseId: string; draft: DraftInput } | null>(null)
  const lastEditAtRef = useRef(0)

  // `save.mutate` is stable, but reading it through a ref keeps the callbacks
  // below out of the effect dependency lists, so the flush listeners register
  // once rather than on every mutation state change.
  const saveRef = useRef(save.mutate)
  saveRef.current = save.mutate
  const savingRef = useRef(false)
  savingRef.current = save.isPending || remove.isPending

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending !== null) saveRef.current(pending)
  }, [])

  const push = useCallback(
    (exerciseId: string, draft: DraftInput) => {
      lastEditAtRef.current = Date.now()
      pendingRef.current = { exerciseId, draft }
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, WRITE_DEBOUNCE_MS)
    },
    [flush],
  )

  const clear = useCallback(
    (exerciseId: string) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      pendingRef.current = null
      lastEditAtRef.current = Date.now()
      // Dropped from the cache immediately, and deliberately never rolled back on
      // failure. `clear` is only called once the session has been LOGGED, so the
      // draft is already redundant; leaving it in the cache would let the next
      // poll re-adopt the workout that was just saved and put it back on screen
      // as unsaved work. If the DELETE genuinely fails, the server-side TTL is
      // what cleans up — a stale draft is cheaper than a resurrected one.
      qc.setQueryData(queryKey, (old: DraftResponse | undefined) => {
        if (old === undefined) return old
        const { [exerciseId]: _dropped, ...rest } = old.drafts
        return { ...old, drafts: rest }
      })
      remove.mutate(exerciseId)
    },
    [qc, queryKey, remove],
  )

  // A phone locking mid-session fires `visibilitychange`, not `beforeunload`, and
  // may never run an unmount — so the queued write has to be flushed there or the
  // last set entered before the screen went dark is lost.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const isSettled = useCallback(
    () =>
      timerRef.current === null &&
      pendingRef.current === null &&
      !savingRef.current &&
      Date.now() - lastEditAtRef.current > SETTLE_MS,
    [],
  )

  return {
    drafts: (query.data?.drafts ?? {}) as WorkoutDraftMap,
    dataUpdatedAt: query.dataUpdatedAt,
    push,
    clear,
    isSettled,
  }
}

/** Value equality between what is on screen and what the server holds. */
export function sameDraft(local: DraftInput, remote: WorkoutDraft | undefined): boolean {
  if (remote === undefined) return false
  return (
    local.date === remote.date &&
    local.completedCount === remote.completedCount &&
    JSON.stringify(local.sets) === JSON.stringify(remote.sets)
  )
}
