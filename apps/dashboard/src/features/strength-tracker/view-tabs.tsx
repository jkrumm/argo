import { SegmentedControl } from '@mantine/core'

export type StrengthView = 'charts' | 'scan' | 'history' | 'body-weight'

const OPTIONS: { value: StrengthView; label: string }[] = [
  { value: 'charts', label: 'Charts' },
  { value: 'scan', label: 'Scan' },
  { value: 'history', label: 'History' },
  { value: 'body-weight', label: 'Body Weight' },
]

export function ViewTabs({
  value,
  onChange,
}: {
  value: StrengthView
  onChange: (next: StrengthView) => void
}) {
  return (
    <SegmentedControl
      size="xs"
      value={value}
      onChange={(v) => onChange(v as StrengthView)}
      data={OPTIONS}
    />
  )
}
