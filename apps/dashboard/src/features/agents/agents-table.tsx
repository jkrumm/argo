import { useMemo } from 'react'
import { Badge, Group, Stack, Text } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { Section, useBreakpoint } from 'basalt-ui'
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
    cell: (ctx) => (
      <Text size="sm" c="dimmed">
        {ctx.getValue() ?? '—'}
        {ctx.row.original.tier ? ` · ${ctx.row.original.tier}` : ''}
      </Text>
    ),
  }),
]

/** Below `lg` there isn't room for a low-value provenance column beside the two free-prose ones. */
const columnsWithoutSource = columns.filter((c) => c.id !== 'source')

/** A table-width floor for `stickyHeader` to stick against (basalt requires one of `maxHeight` /
 * `minWidth` to pair with `stickyHeader`, or the header has no scroll range to stick within). Six
 * columns, two of them free prose (Standing, Next) — basalt's own note measured a 5-column table
 * at ~448px of min-content, so 720 gives the extra column and both prose columns room to breathe
 * before the row compresses. */
const TABLE_MIN_WIDTH = 720

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
 * The agents record list. `BasaltDataTable` on desktop (`sm` and up); below it the table's own
 * 6-column, no-card-fallback shape is unusable on a phone (two free-prose columns, no
 * column-visibility control — see the module's own `minWidth`/`stickyHeader` note), so it swaps to
 * one `AgentCard` per agent, most-urgent-first.
 */
export function AgentsTable({ agents, overview, summary }: Props) {
  const isDesktop = useBreakpoint('sm')
  const showSource = useBreakpoint('lg')
  const subtitle = overviewLine(overview, summary)
  const tableColumns = useMemo(() => (showSource ? columns : columnsWithoutSource), [showSource])

  if (!isDesktop) {
    const cards = sortAgentsForCards(agents)
    return (
      <Section title="Agents" subtitle={subtitle} count={agents.length}>
        {cards.length === 0 ? (
          emptyState
        ) : (
          <Stack gap="xs">
            {cards.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </Stack>
        )}
      </Section>
    )
  }

  return (
    <BasaltDataTable
      title="Agents"
      subtitle={subtitle}
      data={agents}
      columns={tableColumns}
      getRowId={(row) => row.id}
      stickyHeader
      minWidth={TABLE_MIN_WIDTH}
      emptyState={emptyState}
    />
  )
}
