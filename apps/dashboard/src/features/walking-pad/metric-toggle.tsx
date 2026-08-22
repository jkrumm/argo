import { Chip, Group, Text } from '@mantine/core'
import { createPersistedState } from 'basalt-ui/state'
import { z } from 'zod'
import { SERIES } from '../../lib/series'

export type MetricKey = 'distance' | 'duration' | 'steps'

const ALL_METRICS: ReadonlyArray<MetricKey> = ['distance', 'duration', 'steps']

export const fmtKm = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`

export const fmtMin = (s: number) =>
  s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`

export const fmtSteps = (v: number) => v.toLocaleString('en-US')

/**
 * Label / color / per-bucket value formatter for each metric in the toggle.
 * Chart-specific bits (the field accessor, window-total format, per-bucket
 * autoMaxFloor) stay local to each chart — they vary with point shape and
 * with bucket size (day vs week).
 */
export const METRIC_DEFS: Record<
  MetricKey,
  { label: string; color: string; format: (v: number) => string }
> = {
  distance: { label: 'Distance', color: SERIES.walkingDistance, format: fmtKm },
  duration: { label: 'Duration', color: SERIES.walkingDuration, format: fmtMin },
  steps: { label: 'Steps', color: SERIES.walkingSteps, format: fmtSteps },
}

// ── Global selection ────────────────────────────────────────────────────────

// `createPersistedState` is the house persistence API — versioned envelope, Standard-Schema
// validation, cross-tab `storage` event, and a snapshot cached on the raw string so the array
// keeps a stable reference while the stored set is unchanged. This module used to hand-roll all
// four (a module-scoped `useSyncExternalStore` store, ~50 lines). Writes normalize to
// `ALL_METRICS` order, so equal sets serialize identically and the cached snapshot never churns.
//
// The key is un-namespaced on purpose — the store prefixes it to `basalt:walking-pad:metrics`.
// That is a NEW key: a selection stored under the old `walkingpad-metrics-enabled` is not
// migrated and falls back to the default once.

const MetricSelectionSchema = z.array(z.enum(['distance', 'duration', 'steps']))

const DEFAULT_SELECTION: MetricKey[] = ['distance']

const useStoredMetrics = createPersistedState<MetricKey[]>({
  key: 'walking-pad:metrics',
  version: 1,
  initial: DEFAULT_SELECTION,
  schema: MetricSelectionSchema,
})

/**
 * Subscribes a component to the global walking-pad metric selection.
 * Returns the current selection (stable reference when the set is unchanged)
 * plus a toggle helper. Persists to localStorage; reacts to changes in other
 * tabs via the storage event.
 */
export function useMetricSelection(): {
  enabled: ReadonlyArray<MetricKey>
  toggle: (m: MetricKey) => void
  setEnabled: (next: ReadonlyArray<MetricKey>) => void
} {
  const [enabled, setStored] = useStoredMetrics()
  const setEnabled = (next: ReadonlyArray<MetricKey>) =>
    setStored(ALL_METRICS.filter((m) => next.includes(m)))
  return {
    enabled,
    toggle: (m) =>
      setEnabled(enabled.includes(m) ? enabled.filter((x) => x !== m) : [...enabled, m]),
    setEnabled,
  }
}

// ── UI: multi-select chip group for the page header ─────────────────────────

export function MetricToggle() {
  const { enabled, setEnabled } = useMetricSelection()
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed" fw={500}>
        Metrics
      </Text>
      <Chip.Group
        multiple
        value={[...enabled]}
        onChange={(values) => setEnabled(values as MetricKey[])}
      >
        <Group gap={4} wrap="nowrap">
          {ALL_METRICS.map((m) => (
            <Chip key={m} value={m} size="xs" variant="outline">
              {METRIC_DEFS[m].label}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
    </Group>
  )
}
