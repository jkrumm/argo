import { Badge, Group, Stack, Text } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { relativeTime } from 'basalt-ui/format'
import type { OverviewSnapshot } from '../../lib/queries/agents'
import { RECOMMENDATION_ICON, STATE_COLOR, STATE_LABEL, type AgentRow } from './model'

type Props = {
  agents: AgentRow[]
  overview: OverviewSnapshot['overview'] | undefined
}

const columnHelper = createColumnHelper<AgentRow>()

const columns = [
  columnHelper.accessor('project', {
    header: 'Project',
    cell: (ctx) => (
      <Stack gap={0}>
        <Text size="sm" fw={600}>
          {ctx.getValue()}
        </Text>
        {ctx.row.original.title ? (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {ctx.row.original.title}
          </Text>
        ) : null}
      </Stack>
    ),
  }),
  columnHelper.accessor('state', {
    header: 'State',
    cell: (ctx) => (
      <Badge variant="light" color={STATE_COLOR[ctx.getValue()]}>
        {STATE_LABEL[ctx.getValue()]}
      </Badge>
    ),
  }),
  columnHelper.accessor((row) => row.recommendation ?? '', {
    id: 'recommendation',
    header: 'Next',
    cell: (ctx) => {
      const rec = ctx.getValue()
      if (!rec) return <Text c="dimmed">—</Text>
      return (
        <Group gap={6} wrap="nowrap">
          <Text ff="monospace" size="sm" component="span">
            {RECOMMENDATION_ICON[rec] ?? '·'}
          </Text>
          <Text size="sm" component="span">
            {rec}
          </Text>
          {ctx.row.original.recommendationStale ? (
            <Text size="xs" c="dimmed" component="span">
              (stale)
            </Text>
          ) : null}
        </Group>
      )
    },
  }),
  columnHelper.display({
    id: 'standing',
    header: 'Standing',
    enableSorting: false,
    cell: (ctx) => {
      const { blocker, standing } = ctx.row.original
      if (blocker) {
        return (
          <Text size="sm" c="red" lineClamp={2}>
            {blocker}
          </Text>
        )
      }
      return standing ? (
        <Text size="sm" lineClamp={2}>
          {standing}
        </Text>
      ) : (
        <Text c="dimmed">—</Text>
      )
    },
  }),
  columnHelper.accessor((row) => row.lastActivityAt ?? 0, {
    id: 'lastActivity',
    header: 'Last activity',
    cell: (ctx) => {
      const at = ctx.row.original.lastActivityAt
      return at ? <Text size="sm">{relativeTime(at)}</Text> : <Text c="dimmed">—</Text>
    },
  }),
  columnHelper.accessor('source', {
    header: 'Source',
    cell: (ctx) => (
      <Text size="sm" c="dimmed">
        {ctx.getValue() ?? '—'}
        {ctx.row.original.tier ? ` · ${ctx.row.original.tier}` : ''}
      </Text>
    ),
  }),
]

function overviewLine(overview: Props['overview']): string {
  if (!overview) return 'No recommendation run yet — states are deterministic, next steps absent.'
  const backend = overview.backend ? ` on ${overview.backend}` : ''
  return `Recommendations by ${overview.model}${backend} · ${relativeTime(overview.generatedAt)}`
}

export function AgentsTable({ agents, overview }: Props) {
  return (
    <BasaltDataTable
      title="Agents"
      subtitle={overviewLine(overview)}
      data={agents}
      columns={columns}
      getRowId={(row) => row.id}
      emptyState={
        <Text size="sm" c="dimmed">
          No agents in the latest snapshot.
        </Text>
      }
    />
  )
}
