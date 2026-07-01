import { useEffect } from 'react'
import { Group, Select } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { WINDOW_PRESET_OPTIONS, WINDOW_STORAGE_KEY, type WindowPreset } from './constants'
import type { SummaryParams } from './types'

/**
 * Translate one of the 4 visible presets to the API's accepted query. Unlike Strength
 * Tracker, every preset here maps 1:1 to the backend's `WindowQuerySchema` — no from/to
 * date math needed.
 */
export function presetToParams(preset: WindowPreset): SummaryParams {
  return { window: preset }
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
  onPresetChange: (preset: WindowPreset) => void
  onRangeChange: (from: string | undefined, to: string | undefined) => void
}

export function WindowSelector({
  preset,
  from,
  to,
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
        w={80}
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
    </Group>
  )
}

/**
 * One-shot helper: returns the persisted preset (or fallback) for use in the route's
 * initial search-param resolution.
 */
export function getInitialPreset(fallback: WindowPreset = '90d'): WindowPreset {
  return readStoredPreset() ?? fallback
}
