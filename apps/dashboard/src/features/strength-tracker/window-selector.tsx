import { useEffect } from 'react'
import { Group, Select, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { WINDOW_PRESET_OPTIONS, WINDOW_STORAGE_KEY, type WindowPreset } from './constants'
import type { SummaryParams } from './types'

/**
 * Translate one of the 7 visible presets to the API's accepted query.
 *
 * The backend `WindowQuerySchema` accepts 7d / 30d / 90d / all directly;
 * 3m / 6m / 1y / ytd are sent as explicit `from/to` ISO date strings.
 */
export function presetToParams(preset: WindowPreset): SummaryParams {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  switch (preset) {
    case '7d':
      return { window: '7d' }
    case '30d':
      return { window: '30d' }
    case '3m': {
      const from = new Date(today)
      from.setMonth(from.getMonth() - 3)
      return { from: from.toISOString().slice(0, 10), to: todayStr }
    }
    case '6m': {
      const from = new Date(today)
      from.setMonth(from.getMonth() - 6)
      return { from: from.toISOString().slice(0, 10), to: todayStr }
    }
    case '1y': {
      const from = new Date(today)
      from.setFullYear(from.getFullYear() - 1)
      return { from: from.toISOString().slice(0, 10), to: todayStr }
    }
    case 'ytd': {
      const from = new Date(today.getFullYear(), 0, 1)
      return { from: from.toISOString().slice(0, 10), to: todayStr }
    }
    case 'all':
      return { window: 'all' }
  }
}

function readStoredPreset(): WindowPreset | null {
  try {
    const raw = localStorage.getItem(WINDOW_STORAGE_KEY)
    if (raw === null) return null
    const value = JSON.parse(raw) as WindowPreset
    return WINDOW_PRESET_OPTIONS.some((opt) => opt.value === value) ? value : null
  } catch {
    return null
  }
}

function writeStoredPreset(preset: WindowPreset) {
  try {
    localStorage.setItem(WINDOW_STORAGE_KEY, JSON.stringify(preset))
  } catch {
    /* localStorage unavailable — ignore */
  }
}

export type WindowSelectorProps = {
  preset: WindowPreset
  from: string | undefined
  to: string | undefined
  visibleDays?: number | null
  onPresetChange: (preset: WindowPreset) => void
  onRangeChange: (from: string | undefined, to: string | undefined) => void
}

export function WindowSelector({
  preset,
  from,
  to,
  visibleDays,
  onPresetChange,
  onRangeChange,
}: WindowSelectorProps) {
  useEffect(() => {
    writeStoredPreset(preset)
  }, [preset])

  return (
    <Group gap="xs">
      <Select
        data={WINDOW_PRESET_OPTIONS}
        value={preset}
        onChange={(v) => v !== null && onPresetChange(v as WindowPreset)}
        size="xs"
        w={90}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      <DatePickerInput
        type="range"
        placeholder="Custom range"
        value={[from ?? null, to ?? null]}
        onChange={([f, t]) => onRangeChange(f ?? undefined, t ?? undefined)}
        clearable
        size="xs"
      />
      {typeof visibleDays === 'number' && (
        <Text size="xs" c="dimmed">
          {visibleDays} days
        </Text>
      )}
    </Group>
  )
}

/**
 * One-shot helper: returns the persisted preset (or fallback) for use in the
 * route's initial search-param resolution.
 */
export function getInitialPreset(fallback: WindowPreset = 'all'): WindowPreset {
  return readStoredPreset() ?? fallback
}
