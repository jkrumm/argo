import { Group, SegmentedControl, Select } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { marineQueries } from '../../../lib/queries/marine'
import { DAYS_OPTIONS } from '../constants'

export type SpotSelectorProps = {
  spot: string
  days: number
  onSpotChange: (spot: string) => void
  onDaysChange: (days: number) => void
}

export function SpotSelector({ spot, days, onSpotChange, onDaysChange }: SpotSelectorProps) {
  const { data } = useSuspenseQuery(marineQueries.spots())

  const options = data.data.map((s) => ({
    value: s.id,
    label: `${s.name} · ${s.country} · ${s.driveMinutes}min`,
  }))

  return (
    <Group gap="sm" wrap="nowrap">
      <Select
        data={options}
        value={spot}
        onChange={(v) => v !== null && onSpotChange(v)}
        size="xs"
        w={260}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      <SegmentedControl
        data={DAYS_OPTIONS}
        value={String(days)}
        onChange={(v) => onDaysChange(Number(v))}
        size="xs"
      />
    </Group>
  )
}
