import { Group, SegmentedControl, Select } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { astroQueries } from '../../../lib/queries/astro'
import { NIGHTS_OPTIONS } from '../constants'

export type SiteSelectorProps = {
  site: string
  nights: number
  onSiteChange: (site: string) => void
  onNightsChange: (nights: number) => void
}

export function SiteSelector({ site, nights, onSiteChange, onNightsChange }: SiteSelectorProps) {
  const { data } = useSuspenseQuery(astroQueries.sites())

  const options = data.data.map((s) => ({
    value: s.id,
    label: `${s.name} · Bortle ${s.bortle} · ${s.driveMinutes}min`,
  }))

  return (
    <Group gap="sm" wrap="nowrap">
      <Select
        data={options}
        value={site}
        onChange={(v) => v !== null && onSiteChange(v)}
        size="xs"
        w={260}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      <SegmentedControl
        data={NIGHTS_OPTIONS}
        value={String(nights)}
        onChange={(v) => onNightsChange(Number(v))}
        size="xs"
      />
    </Group>
  )
}
