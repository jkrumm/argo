// Where the set editor's starting numbers come from.
//
// This used to be one implicit rule — "pre-fill from the last session on
// exercise change" — and it worked only because nothing else competed for the
// slot. Cross-device drafts broke that: a restored draft and a pre-fill both
// want to own the set list, and whichever wins silently is wrong half the time.
// So the choice became explicit, and once it is explicit "last session" is just
// one selector among several.
//
// All sources are the same idea — REPLAY A PAST SESSION, exactly as it was
// performed — differing only in which session they pick. That is deliberate: a
// set list filled with a PR weight is not a workout, but "do what I did on my
// best day" is a real intent, and so is "do what I did last time".

export type FillSetType = 'warmup' | 'work' | 'drop' | 'amrap'

export type FillSet = {
  set_type: FillSetType
  weight_kg: number
  reps: number
}

/** A past session, as `GET /workouts` returns it. */
export type SessionRow = {
  id: number
  date: string
  estimated_1rm?: number | null
  sets: Array<{ set_number: number; set_type: string; weight_kg: number; reps: number }>
}

export type FillSource = {
  key: 'last' | 'best' | 'max'
  /** Button label — deliberately one word; the numbers carry the meaning. */
  label: string
  /** The headline number, shown next to the label. */
  detail: string
  /** Full description, for the tooltip. */
  title: string
  date: string
  sets: FillSet[]
}

const SET_TYPES: readonly string[] = ['warmup', 'work', 'drop', 'amrap']

/**
 * Narrow the API's `string` set_type. Unknown values fall back to `work` rather
 * than being cast blindly — a set that exists but has a type we don't recognise
 * is still a set that was performed.
 */
function toSetType(value: string): FillSetType {
  return SET_TYPES.includes(value) ? (value as FillSetType) : 'work'
}

function sessionSets(row: SessionRow): FillSet[] {
  return row.sets
    .toSorted((a, b) => a.set_number - b.set_number)
    .map((s) => ({ set_type: toSetType(s.set_type), weight_kg: s.weight_kg, reps: s.reps }))
}

/**
 * Heaviest `work` set in a session. Mirrors the asymmetry in `priorBests` and in
 * the backend's `detectAchievements`: the historical max counts only `work`
 * sets and applies no rep filter, so the number shown here agrees with the one
 * the PR trophy compares against.
 */
function maxWorkWeight(row: SessionRow): number {
  let max = 0
  for (const s of row.sets) {
    if (s.set_type === 'work' && s.weight_kg > max) max = s.weight_kg
  }
  return max
}

/** `92.5` not `92.50`, `97.5` kept — same rounding the form uses everywhere. */
const KG = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

function describe(row: SessionRow, date: string): string {
  const sets = sessionSets(row)
  const shown = sets
    .slice(0, 6)
    .map((s) => `${KG.format(s.weight_kg)}×${s.reps}`)
    .join(', ')
  const more = sets.length > 6 ? ` +${sets.length - 6} more` : ''
  return `${date} — ${shown}${more}`
}

/**
 * Up to three sessions worth replaying for one exercise, in offer order.
 *
 * Deduped by session: when your best e1RM and your heaviest set came from the
 * same day — which is common — that day is offered once, under the first label
 * that claimed it. Two buttons that do the same thing are worse than one.
 *
 * Bodyweight exercises get `last` only. Their stored `weight_kg` is ADDED weight
 * and their e1RM is scored against a bodyweight the form doesn't have, so a
 * "best"/"max" claim here would be as misleading as the PR trophies the form
 * already suppresses for them.
 */
export function fillSources(
  history: readonly SessionRow[],
  options: { isBodyweight: boolean },
): FillSource[] {
  const usable = history.filter((row) => row.sets.length > 0)
  if (usable.length === 0) return []

  const sources: FillSource[] = []
  const claimed = new Set<number>()

  const add = (
    row: SessionRow | undefined,
    source: Omit<FillSource, 'date' | 'sets' | 'title'>,
  ) => {
    if (row === undefined || claimed.has(row.id)) return
    claimed.add(row.id)
    sources.push({
      ...source,
      date: row.date,
      sets: sessionSets(row),
      title: `${source.label} — ${describe(row, row.date)}`,
    })
  }

  const last = usable.reduce((best, row) => (row.date > best.date ? row : best))
  add(last, {
    key: 'last',
    label: 'Last',
    detail: `${KG.format(maxWorkWeight(last) || (last.sets[0]?.weight_kg ?? 0))}`,
  })

  if (options.isBodyweight) return sources

  const best = usable
    .filter((row) => (row.estimated_1rm ?? 0) > 0)
    .reduce<SessionRow | undefined>(
      (top, row) =>
        top === undefined || (row.estimated_1rm ?? 0) > (top.estimated_1rm ?? 0) ? row : top,
      undefined,
    )
  if (best !== undefined) {
    add(best, { key: 'best', label: 'Best', detail: `${KG.format(best.estimated_1rm ?? 0)} e1RM` })
  }

  const heaviest = usable
    .filter((row) => maxWorkWeight(row) > 0)
    .reduce<SessionRow | undefined>(
      (top, row) => (top === undefined || maxWorkWeight(row) > maxWorkWeight(top) ? row : top),
      undefined,
    )
  if (heaviest !== undefined) {
    add(heaviest, { key: 'max', label: 'Max', detail: `${KG.format(maxWorkWeight(heaviest))} kg` })
  }

  return sources
}
