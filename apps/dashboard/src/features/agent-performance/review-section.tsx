import type { UseQueryResult } from '@tanstack/react-query'
import { Stack, Text } from '@mantine/core'
import { EmptyState, Section } from 'basalt-ui'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import type { ReviewStatsRecord } from '../../lib/queries/agent-performance'
import { TIER_COLOR } from './colors'
import {
  EM_DASH,
  TIERS,
  cleanBasis,
  reviewView,
  pct,
  precisionBasis,
  shortKey,
  type Precision,
  type ReviewBody,
  type PromptRow,
  type ReviewWeekRow,
  type ReviewSummary,
  type TierSummary,
} from './model'
import { SourceLine } from './source-line'
import { WeeklyBars } from './weekly-bars'

type Props = {
  query: UseQueryResult<{ latest: ReviewStatsRecord | null }>
  /** The record to draw; null renders the "not pushed yet" state (also the `empty` shot). */
  record: ReviewStatsRecord | null
  keys: readonly string[]
  now: number
}

const tierColumns = createColumnHelper<TierSummary>()
const promptColumns = createColumnHelper<PromptRow>()

/** A rate over its basis: the figure, the count it is of underneath. */
function Figure({ value, basis }: { value: string; basis: string }) {
  return (
    <Stack gap={0}>
      <Text size="sm">{value}</Text>
      {basis === '' ? null : (
        <Text size="xs" c="dimmed">
          {basis}
        </Text>
      )}
    </Stack>
  )
}

const cleanCell = (s: ReviewSummary) => <Figure value={pct(s.cleanRate)} basis={cleanBasis(s)} />
const precisionCell = (p: Precision | null) => (
  <Figure value={p === null ? EM_DASH : pct(p.rate)} basis={precisionBasis(p)} />
)

/** The two precision columns both tables share; only the important header differs. */
function precisionColumns<R extends ReviewSummary>(
  helper: ReturnType<typeof createColumnHelper<R>>,
  importantHeader: string,
) {
  const column = (severity: 'important' | 'nit', header: string, priority: number) =>
    helper.accessor((row) => row[severity]?.rate ?? null, {
      id: severity,
      meta: { priority, numeral: false },
      header,
      cell: (ctx) => precisionCell(ctx.row.original[severity]),
    })
  return [column('important', importantHeader, 3), column('nit', 'Nits acted on', 4)]
}

const tierTableColumns = [
  tierColumns.accessor('tier', {
    meta: { priority: 0, numeral: false },
    header: 'Tier',
    cell: (ctx) => <Text size="sm">{ctx.getValue()}</Text>,
  }),
  tierColumns.accessor('jobs', { meta: { priority: 1 }, header: 'Jobs' }),
  tierColumns.accessor('cleanRate', {
    meta: { priority: 2, numeral: false },
    header: 'Clean first rounds',
    cell: (ctx) => cleanCell(ctx.row.original),
  }),
  ...precisionColumns(tierColumns, 'Important findings acted on'),
]

const promptTableColumns = [
  promptColumns.accessor('key', {
    meta: { priority: 0, numeral: false },
    header: 'Prompt',
    cell: (ctx) => (
      <Text size="sm" ff="monospace" title={ctx.getValue()}>
        {shortKey(ctx.getValue())}
      </Text>
    ),
  }),
  promptColumns.accessor('jobs', { meta: { priority: 1 }, header: 'Jobs' }),
  promptColumns.accessor('cleanRate', {
    meta: { priority: 2, numeral: false },
    header: 'Clean first rounds',
    cell: (ctx) => cleanCell(ctx.row.original),
  }),
  ...precisionColumns(promptColumns, 'Important acted on'),
]

/** The chart and the per-tier quality table, or why there is none. */
function TierBody({
  body,
  rows,
  tiers,
}: {
  body: ReviewBody
  rows: ReviewWeekRow[]
  tiers: TierSummary[]
}) {
  if (body === 'unpushed') {
    return (
      <EmptyState
        tier="section"
        title="agw has not pushed weekly review stats yet"
        description="agent-workflows pushes `agw review stats` to POST /agents/review-stats. The tables below fill in once it does."
      />
    )
  }
  if (body === 'empty') return <EmptyState tier="section" title="No review jobs in this window" />
  return (
    <>
      <WeeklyBars
        ariaLabel="Review jobs per week by tier"
        data={rows}
        bars={TIERS.map((tier) => ({
          key: tier,
          label: tier,
          color: TIER_COLOR[tier],
          getValue: (d: ReviewWeekRow) => d.jobs[tier],
          formatValue: (v) => `${v} jobs`,
        }))}
      />
      <BasaltDataTable
        title="Quality by tier"
        data={tiers}
        columns={tierTableColumns}
        enableSorting={false}
        verticalSpacing="xs"
      />
    </>
  )
}

/** The per-prompt table with its source line; nothing without prompts. */
function PromptTable({ prompts }: { prompts: PromptRow[] }) {
  if (prompts.length === 0) return null
  return (
    <>
      <BasaltDataTable
        title="By prompt"
        subtitle="all weeks pushed, not limited to the window"
        data={prompts}
        columns={promptTableColumns}
        enableSorting={false}
        verticalSpacing="xs"
      />
      <SourceLine>agw review stats --by prompt</SourceLine>
    </>
  )
}

/** Reviews per week by tier, with the per-tier quality table and the per-prompt table. */
export function ReviewSection({ query, record, keys, now }: Props) {
  const { rows, body, tiers, prompts, source } = reviewView(record, keys, now)
  return (
    <Section title="Reviews" query={query}>
      <Stack gap="md" data-shot="reviews" data-shot-states="empty">
        <TierBody body={body} rows={rows} tiers={tiers} />
        <SourceLine>{source}</SourceLine>
        <PromptTable prompts={prompts} />
      </Stack>
    </Section>
  )
}
