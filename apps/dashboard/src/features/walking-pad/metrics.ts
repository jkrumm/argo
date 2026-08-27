import { SERIES } from '../../lib/series'
import { WALKING_METRIC_KEYS } from '../../lib/window-stores'

/** Re-exported from the leaf store module so the values, the type, the filter's options and the
 * store's accepted set are all ONE declaration. */
export type MetricKey = (typeof WALKING_METRIC_KEYS)[number]

export const fmtKm = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`

export const fmtMin = (s: number) =>
  s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`

export const fmtSteps = (v: number) => v.toLocaleString('en-US')

/**
 * Label / color / per-bucket value formatter for each metric in the filter.
 * Chart-specific bits (the field accessor, window-total format, per-bucket
 * autoMaxFloor) stay local to each chart — they vary with point shape and
 * with bucket size (day vs week).
 *
 * The SELECTION itself is `walkingStore.field.metrics` (a local-lane multi field): a chart reads
 * it with `.use()`, and the page bar binds it to a `MultiSelectFilter`. It used to be a
 * standalone `createPersistedState` plus a hand-rolled chip group.
 */
export const METRIC_DEFS: Record<
  MetricKey,
  { label: string; color: string; format: (v: number) => string }
> = {
  distance: { label: 'Distance', color: SERIES.walkingDistance, format: fmtKm },
  duration: { label: 'Duration', color: SERIES.walkingDuration, format: fmtMin },
  steps: { label: 'Steps', color: SERIES.walkingSteps, format: fmtSteps },
}
