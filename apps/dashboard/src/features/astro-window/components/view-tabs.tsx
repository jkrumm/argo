import { SegmentedControl } from '@mantine/core'

export type AstroView = 'tonight' | 'map' | 'forecast'

/**
 * Three views, one control — the same shape strength-tracker's `ViewTabs` uses, minus its
 * desktop/mobile split (nothing here moves into a right rail on a wide viewport, so one option
 * list serves both).
 */
const OPTIONS: { value: AstroView; label: string }[] = [
  { value: 'tonight', label: 'Tonight' },
  { value: 'map', label: 'Map' },
  { value: 'forecast', label: 'Forecast' },
]

export function ViewTabs({
  value,
  onChange,
}: {
  value: AstroView
  onChange: (next: AstroView) => void
}) {
  return (
    <SegmentedControl
      size="xs"
      value={value}
      onChange={(v) => onChange(v as AstroView)}
      data={OPTIONS}
    />
  )
}
