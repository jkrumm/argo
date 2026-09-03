import { integer } from 'basalt-ui/format'
import { SERIES } from '../../lib/series'
import { WALKING_METRIC_KEYS } from '../../lib/window-stores'
import { formatDuration, formatMeters } from './formatters'

/** Re-exported from the leaf store module so the values, the type, the filter's options and the
 * store's accepted set are all ONE declaration. */
export type MetricKey = (typeof WALKING_METRIC_KEYS)[number]

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
  distance: { label: 'Distance', color: SERIES.walkingDistance, format: formatMeters },
  duration: { label: 'Duration', color: SERIES.walkingDuration, format: formatDuration },
  steps: {
    label: 'Steps',
    color: SERIES.walkingSteps,
    format: (v) => integer(v, { locale: 'en-US' }),
  },
}
