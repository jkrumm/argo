import type { UseQueryResult } from '@tanstack/react-query'
import { Badge, Box } from '@mantine/core'
import { Section } from 'basalt-ui'
import type { Narrative } from '../../lib/queries/agents'
import { useNow } from '../../lib/use-now'
import { AgentsEventList, type EventGroup } from './event-list'
import { clockTime, groupByDay } from './model'

type Props = {
  query: UseQueryResult<{ data: Narrative[] }>
}

const COLLAPSED_ROWS = 8

/** Per-project prose as the narrator last revised it, day-grouped by `revisedAt` (not the upsert time). */
export function NarrativesSection({ query }: Props) {
  const now = useNow()
  const narratives = query.data?.data ?? []
  const groups: EventGroup[] = groupByDay(narratives, now).map((g) => ({
    label: g.label,
    rows: g.items.map((n) => ({
      key: n.project,
      actor: n.project,
      title: n.summary,
      time: clockTime(n.revisedAt),
      ...(n.page
        ? {
            chip: (
              <Badge variant="light" color="gray" size="sm" tt="none" title={n.page}>
                wiki page
              </Badge>
            ),
          }
        : {}),
    })),
  }))

  return (
    <Section
      title="Narratives"
      count={narratives.length}
      query={query}
      empty={{ title: 'No narratives yet', description: 'The narrator has not written any.' }}
    >
      <Box data-shot="narratives">
        <AgentsEventList
          label="Project narratives by day"
          groups={groups}
          limit={COLLAPSED_ROWS}
          narrowLines={2}
        />
      </Box>
    </Section>
  )
}
