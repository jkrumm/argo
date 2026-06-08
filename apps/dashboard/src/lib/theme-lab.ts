/**
 * Theme lab — DEV-only live tuning of the chart palette.
 *
 * Charts read their colors from `--vx-*` CSS custom properties (see packages/charts/theme-vars.ts).
 * This module writes overrides for those vars as inline styles on <html>, which beats the
 * stylesheet's per-scheme rules, so charts restyle instantly with NO React re-render. Overrides
 * persist to localStorage and re-apply on load, so a tuning session survives a refresh.
 *
 * It is a tuning sandbox, not a prod theme editor: inline overrides apply to whatever scheme is
 * on screen (they win over both light and dark rules). Use "Copy JSON" to hand off values for
 * baking into palette.ts permanently.
 */

export type ColorTunable = { var: string; label: string }
export type ColorGroup = { title: string; items: ColorTunable[] }

/** Curated anchor colors worth tuning by eye. Solid-hex `--vx-*` vars only (ColorInput-safe). */
export const COLOR_GROUPS: ColorGroup[] = [
  {
    title: 'Health',
    items: [
      { var: '--vx-hrv', label: 'HRV' },
      { var: '--vx-restingHr', label: 'Resting HR' },
      { var: '--vx-sleepDuration', label: 'Sleep' },
      { var: '--vx-steps', label: 'Steps' },
      { var: '--vx-vo2max', label: 'VO₂max' },
      { var: '--vx-calories', label: 'Calories' },
    ],
  },
  {
    title: 'Strength',
    items: [
      { var: '--vx-benchPress', label: 'Bench' },
      { var: '--vx-squat', label: 'Squat' },
      { var: '--vx-deadlift', label: 'Deadlift' },
      { var: '--vx-pullUps', label: 'Pull-ups' },
    ],
  },
  {
    title: 'Walking',
    items: [
      { var: '--vx-walkingDistance', label: 'Distance' },
      { var: '--vx-walkingPace', label: 'Pace' },
    ],
  },
  {
    title: 'Status',
    items: [
      { var: '--vx-status-excellent', label: 'Excellent' },
      { var: '--vx-status-good', label: 'Good' },
      { var: '--vx-status-warn', label: 'Warn' },
      { var: '--vx-status-bad', label: 'Bad' },
    ],
  },
]

/** Gradient strength knobs (percent values, theme-independent). */
export const AREA_TOP_VAR = '--vx-area-top'
export const AREA_BOTTOM_VAR = '--vx-area-bottom'

const COLOR_VARS = COLOR_GROUPS.flatMap((g) => g.items.map((i) => i.var))
const MANAGED_VARS = [...COLOR_VARS, AREA_TOP_VAR, AREA_BOTTOM_VAR]

const KEY = 'argo-theme-lab'

export type Overrides = Record<string, string>

export function loadOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Overrides) : {}
  } catch {
    return {}
  }
}

export function saveOverrides(o: Overrides): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o))
  } catch {
    // private mode / quota — tuning just won't persist
  }
}

/** Clears every managed var, then re-applies the given overrides. The single mutation point. */
export function applyOverrides(o: Overrides): void {
  const el = document.documentElement
  for (const v of MANAGED_VARS) el.style.removeProperty(v)
  for (const [k, val] of Object.entries(o)) {
    if (val) el.style.setProperty(k, val)
  }
}

/** Current resolved value of a var (reflects any active override or the stylesheet default). */
export function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
