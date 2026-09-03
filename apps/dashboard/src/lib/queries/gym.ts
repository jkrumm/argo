import { useEffect } from 'react'
import {
  queryOptions,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '../eden'
import { unwrap } from 'basalt-ui'
import {
  canRemoveProfile,
  HOME,
  resolveActiveProfile,
  uniqueId,
  useGymMirror,
  type ExerciseLoading,
  type GymProfile,
  type GymState,
} from '../gym-profile'
import type { LoadingMode } from '../plate-math'

// There is no push channel — this row syncs by polling. 5s is far tighter than
// equipment config needs on its own; it is chosen so that editing the plate rack
// on a phone while the laptop sits open reads as live rather than as a bug. The
// cost is ~12 requests/minute per open tab against a single-row table.
//
// `refetchIntervalInBackground` stays at its default `false`, so a backgrounded
// tab stops polling entirely — this must not drain a phone in a gym bag.
const GYM_POLL_MS = 5_000

export const gymQueries = {
  all: () => ['gym'] as const,
  state: () =>
    queryOptions({
      queryKey: [...gymQueries.all(), 'state'] as const,
      queryFn: async () => unwrap(await api.gym.get()),
      // Matched to the poll so a remount inside one interval doesn't serve data
      // the poll already considers old.
      staleTime: GYM_POLL_MS,
      // The interval is paused while the tab is hidden, so this is what makes
      // picking the phone back up pull immediately instead of up to 5s later.
      refetchOnWindowFocus: true,
    }),
}

// Mutation key, so the poll can tell when a save is in flight — see `useGymSync`.
const GYM_SAVE_KEY = ['gym', 'save'] as const

/**
 * Owns the 5s poll. Mount this **once**, at the page that uses gym config —
 * never inside `useGyms`.
 *
 * TanStack gives every QueryObserver its own interval timer, and dedupes only
 * fetches that overlap. `useGyms` is called by the workout form, the settings
 * modal, and one WeightPopover *per set row*, so putting the interval in the
 * shared query options would mean six staggered timers hitting `/gym` six times
 * per interval instead of once. Mount/focus refetches don't have this problem —
 * those fire on every observer at the same instant, so they collapse into one
 * request.
 *
 * The poll suspends while a save is in flight: 5s is short enough to land
 * between the optimistic update and the PUT that backs it, which would write
 * the pre-edit server value over the value the user is still dragging.
 * `cancelQueries` in `onMutate` only kills a fetch already running, not the
 * next tick.
 */
export function useGymSync(): void {
  const saving = useIsMutating({ mutationKey: GYM_SAVE_KEY }) > 0
  useQuery({
    ...gymQueries.state(),
    refetchInterval: saving ? false : GYM_POLL_MS,
  })
}

// The server row is un-seeded until some client writes to it. Every component
// calling `useGyms` would otherwise race to seed it on first load, so the
// attempt is made once per page load rather than once per subscriber.
let seedAttempted = false

/**
 * The gym equipment config, backed by `GET/PUT /gym` with localStorage as an
 * offline mirror. Interface is deliberately unchanged from when this was a pure
 * localStorage store — callers describe an edit, not a transport.
 */
export function useGyms(): {
  profiles: GymProfile[]
  active: GymProfile
  setActive(id: string): void
  upsertProfile(profile: GymProfile): void
  removeProfile(id: string): void
  addProfile(name: string): GymProfile
  setExerciseLoading(exerciseId: string, patch: Partial<ExerciseLoading>): void
} {
  const qc = useQueryClient()
  const [mirror, setMirror] = useGymMirror()
  const queryKey = gymQueries.state().queryKey

  // No interval here — see `useGymSync`. This observer reads the shared cache
  // and refetches on mount/focus/reconnect like any other query.
  const query = useQuery(gymQueries.state())

  const save = useMutation({
    mutationKey: GYM_SAVE_KEY,
    mutationFn: (next: GymState) => api.gym.put(next).then((r) => unwrap(r)),
    // Optimistic, because every caller is a settings control the user is
    // actively dragging — waiting on a round-trip would make the plate rack
    // feel broken. The mirror moves with it, so a reload mid-flight isn't a
    // visible rollback.
    onMutate: async (next: GymState) => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData(queryKey)
      qc.setQueryData(queryKey, { state: next, updated_at: null })
      setMirror(next)
      return { previous }
    },
    onError: (_error, _next, context) => {
      qc.setQueryData(queryKey, context?.previous)
    },
  })

  // Server wins on every successful fetch. The JSON compare is what keeps this
  // from being a write loop — once the mirror matches, it stops writing.
  const fetched = query.data?.state ?? null
  useEffect(() => {
    if (fetched === null) return
    if (JSON.stringify(fetched) === JSON.stringify(mirror)) return
    setMirror(fetched)
  }, [fetched, mirror, setMirror])

  // Nothing on the server yet — push what this device knows, so the first load
  // after the migration carries an existing localStorage profile up rather than
  // silently discarding it. Whichever device loads first therefore wins.
  useEffect(() => {
    if (seedAttempted || query.isPending || query.isError) return
    if (query.data?.state != null) return
    seedAttempted = true
    save.mutate(mirror)
  }, [query.isPending, query.isError, query.data, mirror, save])

  const state: GymState = fetched ?? mirror
  const setState = save.mutate
  const active = resolveActiveProfile(state.activeId, state.profiles)

  const setActive = (id: string): void => {
    setState({ ...state, activeId: id })
  }

  const upsertProfile = (profile: GymProfile): void => {
    const exists = state.profiles.some((existing) => existing.id === profile.id)
    const profiles = exists
      ? state.profiles.map((existing) => (existing.id === profile.id ? profile : existing))
      : [...state.profiles, profile]
    setState({ ...state, profiles })
  }

  const removeProfile = (id: string): void => {
    if (!canRemoveProfile(state.profiles)) return
    setState({ ...state, profiles: state.profiles.filter((profile) => profile.id !== id) })
  }

  const addProfile = (name: string): GymProfile => {
    const id = uniqueId(
      name,
      state.profiles.map((profile) => profile.id),
    )
    const created: GymProfile = {
      id,
      name,
      bars: [{ id: 'olympic', name: 'Olympic Barbell', weight_kg: 20 }],
      plates: [],
      defaultBarId: 'olympic',
      exercises: {},
    }
    setState({ ...state, profiles: [...state.profiles, created] })
    return created
  }

  const setExerciseLoading = (exerciseId: string, patch: Partial<ExerciseLoading>): void => {
    const current = active.exercises[exerciseId] ?? { mode: 'free' as LoadingMode }
    upsertProfile({
      ...active,
      exercises: { ...active.exercises, [exerciseId]: { ...current, ...patch } },
    })
  }

  return {
    profiles: state.profiles.length > 0 ? state.profiles : [HOME],
    active,
    setActive,
    upsertProfile,
    removeProfile,
    addProfile,
    setExerciseLoading,
  }
}
