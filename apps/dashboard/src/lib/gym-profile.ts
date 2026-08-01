import { createPersistedState } from 'basalt-ui/state'
import { z } from 'zod'
import type { LoadingMode, PlateStock } from './plate-math'

// A "gym profile" is the physical equipment at one training location — which
// bars exist, what plates sit in the rack, and how each exercise is assembled
// from them. The owner trains at home but also travels, so this is a switchable
// set of profiles.
//
// It lives on the server (`GET/PUT /gym`). It used to be localStorage-only, which
// made it silently per-device: a 10 kg bar set on the laptop never reached the
// phone at the gym, which just kept rendering the HOME seed below. localStorage
// is still here, demoted to an offline mirror — a gym basement has no signal, and
// the plate calculator has to work there.
//
// This module is the domain half: types, the seed, and pure resolution helpers,
// all importable without a DOM so they stay unit-testable. The `useGyms` hook
// that binds them to the API lives in `./queries/gym`, alongside every other
// resource's data access.
//
// Equipment still never reaches `workout_sets`. That column stores the absolute
// total including the bar, exactly as it always has — this is only a different
// frontend for arriving at that same number, so changing a bar or moving gyms
// can never retroactively corrupt logged history.

export interface Bar {
  id: string
  name: string
  weight_kg: number
}

/** How one exercise is physically loaded at this gym. */
export interface ExerciseLoading {
  mode: LoadingMode
  /** Which bar, when `mode` is 'barbell'. Falls back to the profile default. */
  barId?: string
}

export interface GymProfile {
  id: string
  name: string
  bars: Bar[]
  // count = total plates owned, NOT per side. PlateStock in ./plate-math is
  // itself the array type ({ weight_kg, count }[]) — reused directly so the
  // two never drift apart.
  plates: PlateStock
  defaultBarId: string
  /** Keyed by exercise id. Absent entries fall back to `free` (keypad only). */
  exercises: Record<string, ExerciseLoading>
}

export interface GymState {
  activeId: string
  profiles: GymProfile[]
}

export const HOME = {
  id: 'home',
  name: 'Home Gym',
  bars: [
    { id: 'olympic', name: 'Olympic Barbell', weight_kg: 20 },
    { id: 'ez', name: 'EZ Curl Bar', weight_kg: 7.5 },
  ],
  plates: [
    { weight_kg: 15, count: 4 },
    { weight_kg: 10, count: 6 },
    { weight_kg: 5, count: 4 },
    { weight_kg: 2.5, count: 4 },
    { weight_kg: 1.25, count: 2 },
    { weight_kg: 0.5, count: 4 },
  ],
  defaultBarId: 'olympic',
  exercises: {
    bench_press: { mode: 'barbell', barId: 'olympic' },
    squat: { mode: 'barbell', barId: 'olympic' },
    deadlift: { mode: 'barbell', barId: 'olympic' },
    pull_ups: { mode: 'single' },
  },
} satisfies GymProfile

// ── pure helpers (exported for testing) ─────────────────────────────────────

/**
 * Turn a display name into a readable, URL/localStorage-safe id fragment.
 * Falls back to 'gym' when the name has no alphanumeric characters.
 */
export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base.length > 0 ? base : 'gym'
}

/**
 * Derive a unique profile id from a name, de-duplicating against existing ids
 * with a numeric suffix (`home`, `home-2`, `home-3`, ...).
 */
export function uniqueId(name: string, existingIds: readonly string[]): string {
  const base = slugify(name)
  if (!existingIds.includes(base)) return base

  let suffix = 2
  while (existingIds.includes(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/**
 * Resolve the active profile for a given `activeId` against the current
 * profile list. Always returns a real profile: falls back to the first
 * profile when `activeId` is stale, and to HOME when the list is empty.
 */
export function resolveActiveProfile(
  activeId: string,
  profiles: readonly GymProfile[],
): GymProfile {
  const first = profiles[0]
  if (!first) return HOME
  return profiles.find((profile) => profile.id === activeId) ?? first
}

/** The last remaining profile can never be deleted. */
export function canRemoveProfile(profiles: readonly GymProfile[]): boolean {
  return profiles.length > 1
}

/**
 * How a given exercise is loaded at this gym. Unconfigured exercises fall back
 * to `free` — a bare keypad — rather than guessing at a barbell the gym may not
 * have. `barId` always resolves to a bar that exists, so a deleted bar can't
 * leave an exercise pointing at nothing.
 */
export function loadingFor(
  profile: GymProfile,
  exerciseId: string,
): { mode: LoadingMode; barId: string } {
  const entry = profile.exercises[exerciseId]
  const barId = entry?.barId ?? profile.defaultBarId
  const known = profile.bars.some((bar) => bar.id === barId)
  return {
    mode: entry?.mode ?? 'free',
    barId: known ? barId : (profile.bars[0]?.id ?? profile.defaultBarId),
  }
}

// ── offline mirror ───────────────────────────────────────────────────────────

const BarSchema = z.object({
  id: z.string(),
  name: z.string(),
  weight_kg: z.number(),
})

const PlateEntrySchema = z.object({
  weight_kg: z.number(),
  count: z.number(),
})

const ExerciseLoadingSchema = z.object({
  mode: z.enum(['barbell', 'single', 'free']),
  barId: z.string().optional(),
})

const GymProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  bars: z.array(BarSchema),
  plates: z.array(PlateEntrySchema),
  defaultBarId: z.string(),
  exercises: z.record(z.string(), ExerciseLoadingSchema),
})

const GymStateSchema = z.object({
  activeId: z.string(),
  profiles: z.array(GymProfileSchema),
})

// Not the source of truth any more — a read-through cache of what the server
// last returned, so the plate calculator still works in a basement with no
// signal. The server wins on every successful fetch; an edit made while offline
// is lost if the page reloads before the queued PUT lands. That is the right
// trade for equipment config edited a few times a year.
//
// v2 added per-exercise loading config. A stored v1 value fails the version
// check and falls back to `initial` — the seed below is the same equipment the
// v1 seed described, so a reset costs nothing but hand-edited plate counts.
export const useGymMirror = createPersistedState<GymState>({
  key: 'gym-profiles',
  version: 2,
  initial: { activeId: HOME.id, profiles: [HOME] },
  schema: GymStateSchema,
})
