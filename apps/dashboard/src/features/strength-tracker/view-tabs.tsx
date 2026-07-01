import { SegmentedControl } from '@mantine/core'

export type StrengthView = 'charts' | 'train' | 'history'

// Desktop keeps the workout/timer/records in the right rail, so no Train tab.
const DESKTOP_OPTIONS: { value: StrengthView; label: string }[] = [
  { value: 'charts', label: 'Charts' },
  { value: 'history', label: 'History' },
]

// Phones hide the rail, so Train surfaces the same tools as a leading tab.
const MOBILE_OPTIONS: { value: StrengthView; label: string }[] = [
  { value: 'train', label: 'Train' },
  ...DESKTOP_OPTIONS,
]

export function ViewTabs({
  value,
  onChange,
}: {
  value: StrengthView
  onChange: (next: StrengthView) => void
}) {
  return (
    <>
      <SegmentedControl
        hiddenFrom="sm"
        size="xs"
        value={value}
        onChange={(v) => onChange(v as StrengthView)}
        data={MOBILE_OPTIONS}
      />
      <SegmentedControl
        visibleFrom="sm"
        size="xs"
        value={value === 'train' ? 'charts' : value}
        onChange={(v) => onChange(v as StrengthView)}
        data={DESKTOP_OPTIONS}
      />
    </>
  )
}
