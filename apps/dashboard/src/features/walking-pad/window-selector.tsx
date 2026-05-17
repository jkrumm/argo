import { Select } from '@mantine/core'
import type { WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { WINDOW_PRESET_OPTIONS, type WindowPreset } from './constants'

export function presetToParams(preset: WindowPreset): WalkingPadWindowParams {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  switch (preset) {
    case '7d':
      return { window: '7d' }
    case '30d':
      return { window: '30d' }
    case '90d':
      return { window: '90d' }
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
    case 'all':
      return { window: 'all' }
  }
}

export function WindowSelector({
  value,
  onChange,
}: {
  value: WindowPreset
  onChange: (v: WindowPreset) => void
}) {
  return (
    <Select
      value={value}
      onChange={(v) => {
        if (v !== null) onChange(v as WindowPreset)
      }}
      data={WINDOW_PRESET_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      allowDeselect={false}
      checkIconPosition="right"
      w={170}
      size="sm"
    />
  )
}
