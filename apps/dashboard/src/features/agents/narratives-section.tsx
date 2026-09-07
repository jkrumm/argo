import type { UseQueryResult } from '@tanstack/react-query'
import { Group, Stack, Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { relativeTime } from 'basalt-ui/format'
import type { Narrative } from '../../lib/queries/agents'

type Props = {
  query: UseQueryResult<{ data: Narrative[] }>
}

/** One paragraph per project, as the narrator last wrote it — most recently revised first. */
export function NarrativesSection({ query }: Props) {
  const narratives = query.data?.data ?? []
  return (
    <Section
      title="Narratives"
      count={narratives.length}
      query={query}
      empty={{ title: 'No narratives yet', description: 'The narrator has not written any.' }}
    >
      <Stack gap="sm">
        {narratives.map((n) => (
          <Stack key={n.project} gap={2}>
            <Group gap="xs" justify="space-between" wrap="nowrap">
              <Text size="sm" fw={600}>
                {n.project}
              </Text>
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {relativeTime(n.revisedAt)}
              </Text>
            </Group>
            <Text size="sm">{n.summary}</Text>
          </Stack>
        ))}
      </Stack>
    </Section>
  )
}
