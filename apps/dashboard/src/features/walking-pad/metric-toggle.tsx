import { useSyncExternalStore } from 'react'
import { Chip, Group, Text } from '@mantine/core'
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

// ── Global selection (localStorage-backed, cross-tab via storage event) ────

const STORAGE_KEY = 'walkingpad-metrics-enabled'
const DEFAULT_SELECTION: ReadonlyArray<MetricKey> = ['distance']
const CHANGE_EVENT = 'walkingpad-metrics-changed'

type Snapshot = ReadonlyArray<MetricKey>

function readStorage(): Snapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_SELECTION
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return DEFAULT_SELECTION
    const filtered = parsed.filter(
      (v): v is MetricKey =>
        typeof v === 'string' && (ALL_METRICS as ReadonlyArray<string>).includes(v),
    )
    // Sort by ALL_METRICS order so referential equality is stable across
    // toggle order changes that produce the same logical set.
    return ALL_METRICS.filter((m) => filtered.includes(m))
  } catch {
    return DEFAULT_SELECTION
  }
}

let snapshot: Snapshot = readStorage()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function writeStorage(next: Snapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore — selection still updates in memory.
  }
}

function setSelection(next: Snapshot) {
  // Normalize to ALL_METRICS order so equal sets are reference-equal.
  const normalized = ALL_METRICS.filter((m) => next.includes(m))
  snapshot = normalized
  writeStorage(normalized)
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    snapshot = readStorage()
    emit()
  })
  window.addEventListener(CHANGE_EVENT, () => {
    snapshot = readStorage()
    emit()
  })
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

function getSnapshot(): Snapshot {
  return snapshot
}

/**
 * Subscribes a component to the global walking-pad metric selection.
 * Returns the current selection (stable reference when the set is unchanged)
 * plus a toggle helper. Persists to localStorage; reacts to changes in other
 * tabs via the storage event.
 */
export function useMetricSelection(): {
  enabled: Snapshot
  toggle: (m: MetricKey) => void
  setEnabled: (next: ReadonlyArray<MetricKey>) => void
} {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    enabled,
    toggle: (m) => {
      const next = enabled.includes(m) ? enabled.filter((x) => x !== m) : [...enabled, m]
      setSelection(next)
    },
    setEnabled: (next) => setSelection(next),
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
