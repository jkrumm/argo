/**
 * Where the IU API tokens go: one ranked list of the top (tool, model) pairs from `/usage/flow`, one
 * row per pair labelled `tool · model` on one line, sized by the lens (dollars, or every token class
 * including cache-read), with the figure the lens does not rank by muted beside it. The ranked list
 * answers "what is the single most expensive thing"; a heatmap or flow diagram would not. Rows are
 * not clickable: the page store has no tool or model filter to set.
 */
import { Box, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import type { Range } from '../../lib/queries/usage'
import type { UsageLens } from '../../lib/window-stores'
import type { PayerValue } from './accounts'
import { rankPairs, type PairRow } from './budget-model'
import { fmtTokens, fmtUsdWhole, noDataInWindow, periodNoun, tokensFormatterFor } from './model'
import { useFlow } from './use-flow'
import type { WorkspaceValue } from './types'
import classes from './usage.module.css'

/** Pairs named before the rest fold into one Other row. */
const TOP_PAIRS = 6

const INFO =
  'The (tool, model) pairs that account for the most, ranked by the lens: dollars of API spend, or all tokens processed including cache-read. The muted figure is the other measure. The tail is grouped as Other.'

const rowLabel = (r: PairRow): string => (r.pairs > 1 ? `Other (${r.pairs} pairs)` : r.label)

export default function TopSpenders({
  range,
  lens,
  payers,
  workspace,
}: {
  range: Range
  lens: UsageLens
  payers: PayerValue[]
  workspace: WorkspaceValue[] | undefined
}) {
  const flow = useFlow({ range, lens, payers, workspace })
  const ranked = rankPairs(flow.rows, lens, TOP_PAIRS)
  const spend = lens === 'cost'
  const peak = ranked.rows.reduce((max, r) => Math.max(max, r.value), 0)
  const format = spend ? fmtUsdWhole : tokensFormatterFor(peak)
  const second = spend ? fmtTokens : fmtUsdWhole
  const emptyText = noDataInWindow(spend ? 'spend' : 'token usage', range)

  return (
    <Box data-shot="top-spenders" data-shot-states="empty">
      <ChartCard
        placeholderHeight="content"
        title={`Where the tokens go: tool · model · ${periodNoun(range)}`}
        info={INFO}
        facts={
          spend
            ? { value: fmtUsdWhole(ranked.total), period: 'IU API spend' }
            : { value: fmtTokens(ranked.total), period: 'incl. cache-read' }
        }
        {...(spend ? { subtitle: 'Muted figure: tokens' } : {})}
        state={{ empty: (ranked.rows.length === 0 || ranked.total <= 0) && emptyText }}
      >
        <BarList
          label={`Top tool and model pairs by ${spend ? 'spend' : 'tokens'}, ${periodNoun(range)}`}
          format={format}
          variant="thin"
          items={ranked.rows.map((r) => ({
            key: r.key,
            label: rowLabel(r),
            value: r.value,
            secondary: (
              <Text span size="xs" c="dimmed" className={classes.share}>
                {second(r.secondary)}
              </Text>
            ),
          }))}
        />
      </ChartCard>
    </Box>
  )
}
