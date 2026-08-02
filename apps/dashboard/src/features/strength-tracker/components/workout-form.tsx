import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Center,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { IconSettings, IconTrophy } from '@tabler/icons-react'
import { VX } from 'basalt-ui/tokens'
import { format } from 'date-fns'
import {
  invalidateWorkoutData,
  useCreateWorkout,
  workoutsQueries,
  type CreateWorkoutResponse,
} from '../../../lib/queries/workouts'
import { sameDraft, useWorkoutDrafts } from '../../../lib/queries/workout-draft'
import { exerciseQueries } from '../../../lib/queries/exercises'
import { loadingFor } from '../../../lib/gym-profile'
import { useGyms } from '../../../lib/queries/gym'
import { EXERCISES, type ExerciseKey } from '../constants'
import { showAchievements } from '../achievements-toast'
import { SetEditor, type SetEntry } from './set-editor'
import { GymSettingsModal } from './gym-settings-modal'
import { startRestTimer } from './rest-timer-bus'

const DEFAULT_SETS: SetEntry[] = [{ set_type: 'work', weight_kg: 60, reps: 5 }]

/**
 * Pinned to en-US: a bare `toLocaleString()` picks up the system locale, and the German one
 * groups 3735 as "3.735" — which reads as 3.7 kg, off by a factor of 1000. `maximumFractionDigits`
 * keeps the half-kg plates (97.5) while dropping a pointless trailing zero (97.0 → 97).
 */
const KG_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

function today(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

/**
 * Client-side preview of the session aggregates the backend will compute on save. Mirrors
 * `estimate1RM` + `computeMetrics` in `apps/api/src/lib/formulas.ts`: score each eligible set with
 * the Epley/Brzycki average, then take the best single set (ties to the heavier). The 10-rep
 * ceiling is where the two formulas agree — see `docs/STRENGTH-ANALYTICS.md` §2.2.
 *
 * This must stay in lockstep with the backend; a divergence makes the preview line and the PR
 * trophy disagree with the achievement toast that fires on save.
 */
const E1RM_MAX_REPS = 10

/**
 * Max-weight eligibility is deliberately wider than {@link E1RM_MAX_REPS} and mirrors
 * `detectAchievements`: reading the heaviest bar off a set needs no 1RM formula, so the formula
 * validity ceiling doesn't apply to it.
 */
const MAX_WEIGHT_MAX_REPS = 12

function previewMetrics(sets: SetEntry[]): {
  workSets: number
  topReps: number | null
  topWeight: number | null
  maxWeight: number
  totalVolume: number
  bestE1rm: number | null
} {
  let workSets = 0
  let totalVolume = 0
  let maxWeight = 0
  let bestE1rm: number | null = null
  let topReps: number | null = null
  let topWeight: number | null = null

  for (const s of sets) {
    totalVolume += s.weight_kg * s.reps
    if (s.set_type !== 'work' && s.set_type !== 'amrap') continue
    workSets++
    if (s.reps < 1) continue
    if (s.reps <= MAX_WEIGHT_MAX_REPS && s.weight_kg > maxWeight) maxWeight = s.weight_kg
    if (s.reps > E1RM_MAX_REPS) continue

    const epley = s.weight_kg * (1 + s.reps / 30)
    const brzycki = (s.weight_kg * 36) / (37 - s.reps)
    const e1rm = (epley + brzycki) / 2
    // Ties break toward the heavier set, matching `computeMetrics`.
    const tieOnWeight = bestE1rm !== null && e1rm === bestE1rm && s.weight_kg > (topWeight ?? 0)
    if (bestE1rm === null || e1rm > bestE1rm || tieOnWeight) {
      bestE1rm = e1rm
      topReps = s.reps
      topWeight = s.weight_kg
    }
  }

  // The backend rounds e1RM to 0.1 before storing it; match that here or a sub-0.1 difference
  // reads as a PR against a stored value that was rounded down.
  return {
    workSets,
    topReps,
    topWeight,
    maxWeight,
    totalVolume,
    bestE1rm: bestE1rm === null ? null : Math.round(bestE1rm * 10) / 10,
  }
}

type HistoryRow = {
  estimated_1rm: number | null
  is_bodyweight?: boolean | null
  sets: Array<{ set_type: string; weight_kg: number; reps: number }>
}

/**
 * Prior all-time bests for one exercise, mirroring `detectAchievements` in
 * `apps/api/src/lib/strength-formulas.ts`. The backend's own asymmetry is reproduced on purpose:
 * the historical max weight counts only `work` sets and applies no rep filter, while the new
 * session's max counts `work` + `amrap` and requires 1–12 reps. Diverging here would make the
 * crown disagree with the toast that fires on save.
 */
function priorBests(history: ReadonlyArray<HistoryRow>): { maxWeight: number; max1rm: number } {
  let maxWeight = 0
  let max1rm = 0
  for (const w of history) {
    for (const s of w.sets) {
      if (s.set_type === 'work' && s.weight_kg > maxWeight) maxWeight = s.weight_kg
    }
    if (w.estimated_1rm !== null && w.estimated_1rm > max1rm) max1rm = w.estimated_1rm
  }
  return { maxWeight, max1rm }
}

type WorkoutRowLite = {
  id: number
  date: string
  exercise_id: string
  sets: Array<{ set_number: number; set_type: string; weight_kg: number; reps: number }>
}

/**
 * Resolve the most-recent session's sets for an exercise from the recent
 * workouts list — used to pre-fill the "Previous" column in the set editor.
 */
function findLastSession(
  workouts: ReadonlyArray<WorkoutRowLite>,
  exerciseId: ExerciseKey,
): SetEntry[] | undefined {
  const latest = workouts
    .filter((w) => w.exercise_id === exerciseId)
    .toSorted((a, b) => b.date.localeCompare(a.date))[0]
  if (!latest || latest.sets.length === 0) return undefined
  return latest.sets
    .toSorted((a, b) => a.set_number - b.set_number)
    .map((s) => ({
      set_type: (s.set_type as SetEntry['set_type']) ?? 'work',
      weight_kg: s.weight_kg,
      reps: s.reps,
    }))
}

export function WorkoutForm() {
  const [exercise, setExercise] = useState<ExerciseKey>('bench_press')
  const [date, setDate] = useState<string>(today())
  const [sets, setSets] = useState<SetEntry[]>(DEFAULT_SETS)
  const [completedCount, setCompletedCount] = useState(0)
  const [gymSettingsOpen, setGymSettingsOpen] = useState(false)

  const exercisesResult = useSuspenseQuery(exerciseQueries.list())
  const recentResult = useSuspenseQuery(workoutsQueries.list({ page: 1, limit: 20 }))

  const exerciseRows = exercisesResult.data?.data ?? []
  const exerciseOptions = exerciseRows.map((e: { id: string; name: string }) => ({
    value: e.id,
    label: e.name,
  }))

  // How the selected exercise is loaded at the active gym, driving the weight
  // popover's plate calculator. Equipment is user config synced through the API
  // (it changes when you travel, and it has to agree across devices) — never part
  // of the workout record, which keeps storing the absolute total including the bar.
  const gyms = useGyms()
  const loading = loadingFor(gyms.active, exercise)

  // What this exercise actually loads against right now, spelled out in the form
  // header. 'single' is a dip belt / loading pin (one side, no bar); 'free' means
  // the keypad only, so there is no equipment claim to make.
  const activeBar = gyms.active.bars.find((bar) => bar.id === loading.barId)
  const loadingSummary =
    loading.mode === 'barbell' && activeBar !== undefined
      ? `${activeBar.name} ${KG_FORMAT.format(activeBar.weight_kg)} kg`
      : loading.mode === 'single'
        ? 'Loaded per side'
        : 'Free entry'
  const gymSummary = `${gyms.active.name} · ${loadingSummary}`

  const recentWorkouts = (recentResult.data?.data ?? []) as ReadonlyArray<WorkoutRowLite>
  const previousSets = findLastSession(recentWorkouts, exercise)

  // All-time history for the selected exercise, bounded to `date` the way the backend bounds it
  // (`date <= body.date`) so backfilling an older session doesn't compare against its own future.
  // Deliberately not a suspense query — the form must not blank out on every exercise switch; the
  // crown simply stays hidden until this resolves.
  const historyResult = useQuery(
    workoutsQueries.list({ page: 1, limit: 200, exercise, dateTo: date }),
  )
  const history = (historyResult.data?.data ?? []) as ReadonlyArray<HistoryRow>

  // ── cross-device draft sync ────────────────────────────────────────────────
  //
  // The session being entered is shared through `/workout-draft` so it can be
  // started on the laptop and finished on the phone. The transport (debounced
  // writes, the 5s poll, the settled-ness gate) is in `lib/queries/workout-draft`;
  // what lives here is the part only the form can decide — when an incoming
  // draft is allowed to replace what is on screen.
  //
  // The rule: never while the local copy is the user's. That means not while a
  // keypad is open, not while anything in the form has focus, not while a write
  // is queued or in flight, and not within a beat of the last edit. A poll tick
  // that arrives in any of those states is dropped rather than deferred — the
  // next one is 5s out, and by then the local copy has been written up and the
  // two agree anyway.
  const drafts = useWorkoutDrafts()
  const remoteDraft = drafts.drafts[exercise]
  const qc = useQueryClient()

  const formRef = useRef<HTMLDivElement>(null)
  // The local copy becomes the user's on their first edit. Before that the form
  // is showing a guess — last session's sets — and a guess must never be written
  // up, or merely opening the page would plant a draft on the other device.
  const touchedRef = useRef(false)
  // A weight/reps keypad is open. Those are buttons over a portalled popover, so
  // focus-within on the form can't see them; SetEditor reports it instead.
  const editingRef = useRef(false)
  const handleEditingChange = useCallback((v: boolean) => {
    editingRef.current = v
  }, [])
  // Whether a server draft for this exercise was ever observed. Its later absence
  // means the other device saved the session — but only if it was there first.
  // Without this, a PUT failing offline would read as "cleared elsewhere" and
  // wipe the session the user is still entering.
  const seenRef = useRef<Record<string, boolean>>({})
  // Null, not `exercise`: the first mount has to take the same path as a switch,
  // so opening the page either adopts the draft left on the other device or
  // pre-fills from the last session — exactly what a switch does.
  const prevExerciseRef = useRef<ExerciseKey | null>(null)

  // Current render's values, for the sync effect to read without taking them as
  // dependencies — it must not re-run on every keystroke. Declared before that
  // effect so it is already fresh when the effect below runs in the same commit.
  const latest = useRef({ date, sets, completedCount, previousSets })
  useEffect(() => {
    latest.current = { date, sets, completedCount, previousSets }
  })

  // The one place a value that did not come from the user lands in the form.
  useEffect(() => {
    const switched = prevExerciseRef.current !== exercise
    prevExerciseRef.current = exercise

    if (switched) {
      // Switching exercise is the user asking for that exercise's state, so it
      // always applies: the shared draft when there is one, the usual pre-fill
      // from the last session otherwise.
      touchedRef.current = false
      if (remoteDraft !== undefined) {
        seenRef.current[exercise] = true
        setDate(remoteDraft.date)
        setSets(remoteDraft.sets)
        setCompletedCount(remoteDraft.completedCount)
        return
      }
      seenRef.current[exercise] = false
      if (latest.current.previousSets !== undefined) setSets(latest.current.previousSets)
      setCompletedCount(0)
      return
    }

    // A poll tick. Everything below is the "may a remote draft replace what is
    // on screen" gate.
    if (editingRef.current) return
    if (formRef.current?.contains(document.activeElement) === true) return
    if (!drafts.isSettled()) return

    if (remoteDraft !== undefined) {
      seenRef.current[exercise] = true
      const local = latest.current
      if (sameDraft(local, remoteDraft)) return
      setDate(remoteDraft.date)
      setSets(remoteDraft.sets)
      setCompletedCount(remoteDraft.completedCount)
      return
    }

    // The draft we were sharing is gone: the other device saved the session, or
    // it aged out server-side. Reset to a fresh form and pull the newly-logged
    // workout in, so finishing on the phone visibly finishes it here too.
    if (seenRef.current[exercise] !== true) return
    seenRef.current[exercise] = false
    touchedRef.current = false
    setDate(today())
    setSets(latest.current.previousSets ?? DEFAULT_SETS)
    setCompletedCount(0)
    invalidateWorkoutData(qc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise, remoteDraft, drafts.dataUpdatedAt])

  // Write-up. Debounced downstream, so this fires per edit and PUTs per pause.
  // Skipped entirely until the user has touched the form, and skipped when the
  // server already holds exactly this — which is what stops an adopted draft
  // from being echoed straight back.
  useEffect(() => {
    if (!touchedRef.current) return
    const local = { date, sets, completedCount }
    if (sameDraft(local, remoteDraft)) return
    drafts.push(exercise, local)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise, date, sets, completedCount])

  function markTouched() {
    touchedRef.current = true
  }

  const createWorkout = useCreateWorkout()

  const allChecked = sets.length > 0 && completedCount >= sets.length

  // Check-off a set: lock it, unlock the next, and rest before a non-drop next set.
  function handleCompletedChange(count: number) {
    const advancing = count > completedCount
    markTouched()
    setCompletedCount(count)
    if (advancing) {
      const next = sets[count]
      if (next !== undefined && next.set_type !== 'drop') startRestTimer()
    }
  }

  function handleSubmit() {
    if (sets.length === 0 || !allChecked) return
    const body = {
      date,
      exercise_id: exercise,
      sets: sets.map((s, i) => ({
        set_number: i + 1,
        set_type: s.set_type,
        weight_kg: s.weight_kg,
        reps: s.reps,
      })),
    }
    createWorkout.mutate(body, {
      onSuccess: (result) => {
        const res = result as unknown as CreateWorkoutResponse
        showAchievements(res.achievements)
        // The session is history now — drop the shared draft so the other device
        // stops offering it as unsaved work, and hand ownership of the reset form
        // back to the pre-fill.
        touchedRef.current = false
        seenRef.current[exercise] = false
        drafts.clear(exercise)
        setSets([{ set_type: 'work', weight_kg: sets[0]?.weight_kg ?? 60, reps: 5 }])
        setCompletedCount(0)
      },
    })
  }

  const preview = previewMetrics(sets)
  const previewParts: string[] = []
  if (preview.workSets > 0) {
    previewParts.push(`${preview.workSets} work ${preview.workSets === 1 ? 'set' : 'sets'}`)
  }
  // The top set is the one with the highest e1RM — not a description of every work set, so it
  // gets its own labelled part rather than being folded into the set count.
  if (preview.topReps !== null && preview.topWeight !== null) {
    previewParts.push(`best ${KG_FORMAT.format(preview.topWeight)} kg × ${preview.topReps}`)
  }
  if (preview.totalVolume > 0) {
    previewParts.push(`${KG_FORMAT.format(Math.round(preview.totalVolume))} kg volume`)
  }
  if (preview.bestE1rm !== null) {
    previewParts.push(`${Math.round(preview.bestE1rm)} kg e1RM`)
  }

  // Bodyweight exercises (pull-ups) score weight as `weight_kg + bodyweight` on the backend, and
  // this form has no bodyweight to add — predicting a PR would be wrong, so stay silent instead.
  const bests = priorBests(history)
  const isBodyweight = history[0]?.is_bodyweight === true
  const beatsWeight = bests.maxWeight > 0 && preview.maxWeight > bests.maxWeight
  const beatsE1rm = bests.max1rm > 0 && preview.bestE1rm !== null && preview.bestE1rm > bests.max1rm
  // One trophy per record that falls — both can land in the same session.
  const pendingPrs: Array<{ key: string; label: string }> = []
  if (!isBodyweight && beatsWeight) {
    pendingPrs.push({
      key: 'max_weight',
      label: `New max weight — beats ${KG_FORMAT.format(bests.maxWeight)} kg`,
    })
  }
  if (!isBodyweight && beatsE1rm) {
    pendingPrs.push({
      key: 'estimated_1rm',
      label: `New best e1RM — beats ${KG_FORMAT.format(bests.max1rm)} kg`,
    })
  }

  return (
    <Paper ref={formRef} py="xs" px="sm">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" align="center">
          <Text fw={600} size="sm">
            Log Workout
          </Text>

          {/* The gear inside the weight popover reaches the same modal, but only
              once a set row is open — this is the standing answer to "what is the
              bar right now", which is the thing that used to be wrong per-device. */}
          <Tooltip label="Gym equipment — bars, plate rack, per-exercise loading" withArrow>
            <UnstyledButton onClick={() => setGymSettingsOpen(true)} aria-label="Gym settings">
              <Group gap={6} wrap="nowrap" align="center">
                <Text size="xs" c="dimmed">
                  {gymSummary}
                </Text>
                <Center component="span">
                  <IconSettings size={14} color={VX.muted} />
                </Center>
              </Group>
            </UnstyledButton>
          </Tooltip>
        </Group>

        <Select
          label="Exercise"
          data={exerciseOptions.length > 0 ? exerciseOptions : EXERCISES}
          value={exercise}
          onChange={(v) => v !== null && setExercise(v as ExerciseKey)}
          size="md"
          allowDeselect={false}
        />

        <TextInput
          type="date"
          label="Date"
          value={date}
          onChange={(e) => {
            markTouched()
            setDate(e.currentTarget.value)
          }}
          size="md"
        />

        <SetEditor
          sets={sets}
          onChange={(next) => {
            markTouched()
            setSets(next)
          }}
          onEditingChange={handleEditingChange}
          previousSets={previousSets}
          checklist
          completedCount={completedCount}
          onCompletedChange={handleCompletedChange}
          loadingMode={loading.mode}
          barId={loading.barId}
          onBarChange={(barId) => gyms.setExerciseLoading(exercise, { barId })}
          onOpenSettings={() => setGymSettingsOpen(true)}
        />

        <GymSettingsModal
          opened={gymSettingsOpen}
          onClose={() => setGymSettingsOpen(false)}
          exercises={exerciseOptions.length > 0 ? exerciseOptions : EXERCISES}
        />

        {previewParts.length > 0 && (
          <Group gap={6} align="center" mt={2} wrap="nowrap">
            <Text size="xs" c="dimmed">
              {previewParts.join(' · ')}
            </Text>
            {pendingPrs.map((pr) => (
              <Tooltip key={pr.key} label={pr.label} withArrow>
                <Center component="span" aria-label={pr.label}>
                  <IconTrophy size={14} color={VX.status.warn} />
                </Center>
              </Tooltip>
            ))}
          </Group>
        )}

        <Button
          onClick={handleSubmit}
          loading={createWorkout.isPending}
          disabled={!allChecked}
          color={allChecked ? 'green' : undefined}
          fullWidth
        >
          Save Workout
        </Button>
      </Stack>
    </Paper>
  )
}
