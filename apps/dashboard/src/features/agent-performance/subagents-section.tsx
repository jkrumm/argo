import type { UseQueryResult } from '@tanstack/react-query'
import { Group, Stack, Text } from '@mantine/core'
import { BarList, Section } from 'basalt-ui'
import type { UsageKpis } from '../../lib/queries/agent-performance'
import { SUBAGENT_SOURCE, fmtUsd, runsLabel, splitSubagents, type SubagentInput } from './model'
import { SourceLine } from './source-line'

type Props = { query: UseQueryResult<UsageKpis>; rows: UsageKpis['subagents']; costBasis: string }

function RankedGroup({ title, rows }: { title: string; rows: readonly SubagentInput[] }) {
  if (rows.length === 0) return null
  // One scale per group: a worker role and a subagent type are not the same kind of spend.
  return (
    <Stack gap="xs">
      <Text size="xs" fw={600} tt="uppercase" c="dimmed">
        {title}
      </Text>
      <BarList
        label={`${title} by cost`}
        format={fmtUsd}
        items={rows.map((r) => ({
          key: `${r.kind}:${r.name}`,
          label: r.name,
          value: r.costUsd,
          secondary: (
            <Group gap="xs" justify="flex-end" wrap="wrap">
              <Text span size="xs" inherit>
                {runsLabel(r.runs)} ·
              </Text>
              <Text span size="xs" inherit>
                {r.requests} requests ·
              </Text>
              <Text span size="xs" inherit>
                avg {fmtUsd(r.avgCostUsd)}
              </Text>
            </Group>
          ),
        }))}
      />
    </Stack>
  )
}

/** Runs, requests and cost per subagent type and per factory worker role, two ranked groups. */
export function SubagentsSection({ query, rows, costBasis }: Props) {
  const { subagents, workers } = splitSubagents(rows)
  return (
    <Section
      title="Subagents and workers"
      count={rows.length}
      query={query}
      empty={{ title: 'No subagent or worker runs in this window' }}
    >
      <Stack gap="md" data-shot="subagents">
        <RankedGroup title="Subagents" rows={subagents} />
        <RankedGroup title="Factory workers" rows={workers} />
        <SourceLine>
          {SUBAGENT_SOURCE} · {costBasis}
        </SourceLine>
      </Stack>
    </Section>
  )
}
