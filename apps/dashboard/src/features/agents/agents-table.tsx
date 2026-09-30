import { Badge, Group, Stack, Text } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { relativeTime } from 'basalt-ui/format'
import type { OverviewSnapshot, OverviewSummary } from '../../lib/queries/agents'
import {
  breakdownLine,
  RECOMMENDATION_ICON,
  sortAgentsForCards,
  STATE_COLOR,
  STATE_LABEL,
  type AgentRow,
} from './model'
import { AgentCard } from './agent-card'

type Props = {
  agents: AgentRow[]
  overview: OverviewSnapshot['overview'] | undefined
  summary: OverviewSummary | undefined
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
    id: 'source',
    header: 'Source',
    // A low-value provenance column: folds first when the table is too narrow for all six.
    meta: { priority: 10 },
    cell: (ctx) => (
      <Text size="sm" c="dimmed">
        {ctx.getValue() ?? '—'}
        {ctx.row.original.tier ? ` · ${ctx.row.original.tier}` : ''}
      </Text>
    ),
  }),
]

function overviewLine(overview: Props['overview'], summary: OverviewSummary | undefined): string {
  const breakdown = breakdownLine(summary)
  const base = overview
    ? `Recommendations by ${overview.model}${overview.backend ? ` on ${overview.backend}` : ''} · ${relativeTime(overview.generatedAt)}`
    : 'No recommendation run yet — states are deterministic, next steps absent.'
  return breakdown ? `${base} · ${breakdown}` : base
}

const emptyState = (
  <Text size="sm" c="dimmed">
    No agents in the latest snapshot.
  </Text>
)

/**
 * The agents record list. `BasaltDataTable` while it has room; once its own box is narrower than
 * the `regular` container class it projects one `AgentCard` per agent (`renderCard`) — the
 * 6-column table has two free-prose columns, so it cannot flex down to a phone. Between the two,
 * the column fold sheds `source` first. Rows are most-urgent-first (needs you → working → rest)
 * so the card list keeps the triage order it had before — renderCard projects the table's order.
 */
export function AgentsTable({ agents, overview, summary }: Props) {
  return (
    <BasaltDataTable
      title="Agents"
      subtitle={overviewLine(overview, summary)}
      data={sortAgentsForCards(agents)}
      columns={columns}
      getRowId={(row) => row.id}
      stickyHeader
      emptyState={emptyState}
      renderCard={(agent) => <AgentCard agent={agent} />}
    />
  )
}
