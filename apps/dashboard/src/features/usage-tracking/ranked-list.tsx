/**
 * Projects and Tools: the ones that account for the most, ranked by the lens (spend or fresh
 * tokens). Each row shows the other measure muted and the change against the period before as a
 * delta glyph, so what moved is visible where it is ranked. One component, two dimensions: both read
 * a day-grain series (cost and tokens) over the range plus the period before, folded server-side.
 */
import { useSuspenseQueries } from '@tanstack/react-query'
import { Box, Group, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type Range } from '../../lib/queries/usage'
import { useNow } from '../../lib/use-now'
import type { UsageLens, UsageScope } from '../../lib/window-stores'
import { scopePayers } from './budget-model'
import {
  EM_DASH,
  fmtTokens,
  fmtUsdWhole,
  OTHER_KEY,
  noDataInWindow,
  periodNoun,
  tokensFormatterFor,
} from './model'
import { ChangeBadge } from './change-badge'
import { change, periodSums, priorRange, rankRows } from './period-model'
import type { WorkspaceValue } from './types'

const SERIES_TOP = 16
const ROWS = 8
const UNSET_KEY = '(unset)'

const DIMENSIONS = {
  project: {
    title: 'Projects',
    groupBy: 'project',
    noun: 'projects',
    usage: 'project usage',
    info: 'The projects worked on most, normalized from the working directory. The bar follows the lens; the muted figure is the other measure and the glyph is the change against the period before (new: nothing or next to nothing in it).',
    label: (key: string) => (key === UNSET_KEY ? '(no project)' : key),
  },
  tool: {
    title: 'Tools',
    groupBy: 'sub_tool',
    noun: 'tools',
    usage: 'tool usage',
    info: 'The tools and lanes (interactive sessions, waves, reviews, workers) that account for the most. The bar follows the lens; the muted figure is the other measure and the glyph is the change against the period before (new: nothing or next to nothing in it).',
    label: (key: string) => key,
  },
} as const

export default function RankedList({
  dimension,
  range,
  lens,
  scope,
  workspace,
}: {
  dimension: keyof typeof DIMENSIONS
  range: Range
  lens: UsageLens
  scope: UsageScope
  workspace: WorkspaceValue[] | undefined
}) {
  const dim = DIMENSIONS[dimension]
  const spend = lens === 'spend'
  const base = {
    range: priorRange(range),
    grain: 'day',
    groupBy: dim.groupBy,
    payer: scopePayers(scope),
    workspace,
    top: SERIES_TOP,
  } as const
  const [cost, tokens] = useSuspenseQueries({
    queries: [
      usageQueries.timeseries({ ...base, metric: 'cost' }),
      usageQueries.timeseries({ ...base, metric: 'tokens' }),
    ],
  })
  const now = useNow()
  const rows =
    shotState() === 'empty'
      ? []
      : rankRows({
          cost: periodSums(cost.data.buckets, range, now),
          tokens: periodSums(tokens.data.buckets, range, now),
          lens,
          limit: ROWS,
        })
  // The catch-all is a line under the list, not a bar: it would outrank every named row and squash them.
  const named = rows.filter((r) => r.key !== OTHER_KEY)
  const rest = rows.find((r) => r.key === OTHER_KEY)
  const peakTokens = named.reduce((max, r) => Math.max(max, r.tokens ?? 0), 0)
  const emptyText = noDataInWindow(dim.usage, range)

  return (
    <Box data-shot={`ranked-${dimension}`} data-shot-states="empty">
      <ChartCard
        placeholderHeight="content"
        title={`${dim.title} · ${spend ? (scope === 'all' ? 'spend + list value' : 'spend') : 'fresh tokens'} · ${periodNoun(range)}`}
        info={dim.info}
        state={{ empty: rows.length === 0 && emptyText }}
      >
        <BarList
          label={`Top ${dim.noun} by ${spend ? 'spend' : 'fresh tokens'}, ${periodNoun(range)}`}
          format={spend ? fmtUsdWhole : tokensFormatterFor(Math.max(peakTokens, 1))}
          variant="thin"
          items={named.map((r) => {
            const now_ = (spend ? r.cost : r.tokens) ?? 0
            const other = spend ? r.tokens : r.cost
            const delta = change(now_, spend ? r.costPrior : r.tokensPrior)
            return {
              key: r.key,
              label: dim.label(r.key),
              value: now_,
              secondary: (
                <Group gap="xs" wrap="nowrap" justify="flex-end">
                  <Text component="span" inherit c="dimmed">
                    {other === null ? EM_DASH : spend ? fmtTokens(other) : fmtUsdWhole(other)}
                  </Text>
                  <ChangeBadge change={delta} polarity={spend ? 'up-bad' : 'neutral'} />
                </Group>
              ),
            }
          })}
        />
        {rest === undefined ? null : (
          <Text size="xs" c="dimmed">
            Other: {fmtUsdWhole(rest.cost)} · {fmtTokens(rest.tokens)}
          </Text>
        )}
      </ChartCard>
    </Box>
  )
}
