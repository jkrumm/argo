import { Group, SegmentedControl } from '@mantine/core'
import { VX } from '@argo/charts'

export type MetricKey = 'distance' | 'duration' | 'steps'

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
  distance: { label: 'Distance', color: VX.series.walkingDistance, format: fmtKm },
  duration: { label: 'Duration', color: VX.series.walkingDuration, format: fmtMin },
  steps: { label: 'Steps', color: VX.series.walkingSteps, format: fmtSteps },
}

const TOGGLE_DATA = [
  { label: 'Distance', value: 'distance' },
  { label: 'Duration', value: 'duration' },
  { label: 'Steps', value: 'steps' },
]

export function MetricToggle({
  value,
  onChange,
}: {
  value: MetricKey
  onChange: (next: MetricKey) => void
}) {
  return (
    <Group justify="flex-end" mb={6}>
      <SegmentedControl
        size="xs"
        value={value}
        onChange={(v) => onChange(v as MetricKey)}
        data={TOGGLE_DATA}
      />
    </Group>
  )
}
