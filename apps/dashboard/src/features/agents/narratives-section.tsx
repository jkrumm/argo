import { useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Badge, Box } from '@mantine/core'
import { EventList, Section } from 'basalt-ui'
import type { Narrative } from '../../lib/queries/agents'

type Props = {
  query: UseQueryResult<{ data: Narrative[] }>
}

const COLLAPSED_ROWS = 8

/** Per-project prose as the narrator last revised it, day-grouped by `revisedAt` (not the upsert time). */
export function NarrativesSection({ query }: Props) {
  const [visible, setVisible] = useState(COLLAPSED_ROWS)
  const narratives = query.data?.data ?? []
  // Newest first; an unparseable `revisedAt` is NaN and sorts last.
  const all = narratives
    .map((n) => ({ n, ms: Date.parse(n.revisedAt) }))
    .toSorted((a, b) => (Number.isNaN(a.ms) ? 1 : Number.isNaN(b.ms) ? -1 : b.ms - a.ms))
  const remaining = all.length - visible
  const items = all.slice(0, visible).map(({ n, ms }) => ({
    id: n.project,
    at: ms,
    actor: n.project,
    title: n.summary,
    chips: n.page ? (
      <Badge variant="light" color="gray" size="sm" tt="none" title={n.page}>
        wiki page
      </Badge>
    ) : undefined,
  }))

  return (
    <Section
      title="Narratives"
      count={narratives.length}
      query={query}
      empty={{ title: 'No narratives yet', description: 'The narrator has not written any.' }}
    >
      <Box data-shot="narratives">
        <EventList
          label="Project narratives by day"
          density="timeline"
          rail={false}
          group="day"
          items={items}
          {...(remaining > 0
            ? { earlier: { onLoad: () => setVisible(all.length), remaining } }
            : {})}
        />
      </Box>
    </Section>
  )
}
