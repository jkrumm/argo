import { Group, SegmentedControl } from '@mantine/core'
import type { Grain, Range } from '../../lib/queries/usage'
import type { BillingValue } from './types'
import { ALL_BILLING } from './constants'

export type FilterBarProps = {
  range: Range
  grain: Grain
  billing: BillingValue[] | undefined
  onRangeChange: (r: Range) => void
  onGrainChange: (g: Grain) => void
  onBillingChange: (b: BillingValue[] | undefined) => void
}

const RANGE_OPTIONS = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: 'All', value: 'all' },
]

const GRAIN_OPTIONS = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
]

const BILLING_OPTIONS = [
  { label: 'All', value: '__all__' },
  { label: 'Max', value: 'max' },
  { label: 'IU', value: 'iu' },
  { label: 'Unknown', value: 'unknown' },
]

export function FilterBar({
  range,
  grain,
  billing,
  onRangeChange,
  onGrainChange,
  onBillingChange,
}: FilterBarProps) {
  const billingValue =
    !billing || billing.length === 0 || billing.length === ALL_BILLING.length
      ? '__all__'
      : (billing[0] ?? '__all__')

  return (
    <Group gap="md" wrap="wrap">
      <SegmentedControl
        size="xs"
        value={range}
        onChange={(v) => onRangeChange(v as Range)}
        data={RANGE_OPTIONS}
      />
      <SegmentedControl
        size="xs"
        value={grain}
        onChange={(v) => onGrainChange(v as Grain)}
        data={GRAIN_OPTIONS}
      />
      <SegmentedControl
        size="xs"
        value={billingValue}
        onChange={(v) =>
          onBillingChange(v === '__all__' ? undefined : ([v as BillingValue] as BillingValue[]))
        }
        data={BILLING_OPTIONS}
      />
    </Group>
  )
}
