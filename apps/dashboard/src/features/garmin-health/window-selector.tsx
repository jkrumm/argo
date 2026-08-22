import { useEffect } from 'react'
import { Group, Select, Text } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { format } from 'date-fns'
import { garminWindowStore as windowStore } from '../../lib/window-stores'
import { WINDOW_PRESET_OPTIONS, type WindowPreset } from './constants'
import type { SummaryParams } from './types'

/**
 * Translate one of the 5 visible presets to the API's accepted query.
 *
 * The backend `WindowQuerySchema` only allows 7d / 30d / 90d / all directly;
 * 3m and 1y are sent as explicit `from/to` strings.
 */
export function presetToParams(preset: WindowPreset): SummaryParams {
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  switch (preset) {
    case '7d':
      return { window: '7d' }
    case '30d':
      return { window: '30d' }
    case '3m': {
      const from = new Date(today)
      from.setMonth(from.getMonth() - 3)
      return { from: format(from, 'yyyy-MM-dd'), to: todayStr }
    }
    case '1y': {
      const from = new Date(today)
      from.setFullYear(from.getFullYear() - 1)
      return { from: format(from, 'yyyy-MM-dd'), to: todayStr }
    }
    case 'all':
      return { window: 'all' }
  }
}

export type WindowSelectorProps = {
  preset: WindowPreset
  from: string | undefined
  to: string | undefined
  /** Visible row count for the "X days" hint on the right; pass null to skip. */
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
