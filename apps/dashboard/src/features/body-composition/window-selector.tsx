import { useEffect } from 'react'
import { Group, Select } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { bodyCompWindowStore as windowStore } from '../../lib/window-stores'
import { WINDOW_PRESET_OPTIONS, type WindowPreset } from './constants'
import type { SummaryParams } from './types'

/**
 * Translate one of the 4 visible presets to the API's accepted query. Unlike Strength
 * Tracker, every preset here maps 1:1 to the backend's `WindowQuerySchema` — no from/to
 * date math needed.
 */
export function presetToParams(preset: WindowPreset): SummaryParams {
  return { window: preset }
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
  // Mirror the active preset into the store so the next visit without an explicit `?window=`
  // opens on it — `validateSearch` reads it back through `windowStore.readStored()`.
  const [, persistPreset] = windowStore.useStore()
  useEffect(() => {
    persistPreset(preset)
  }, [preset, persistPreset])

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
