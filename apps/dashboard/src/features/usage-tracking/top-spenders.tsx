/**
 * Section B, top spenders: one ranked list of (tool, model) pairs from `/usage/flow`, one row per pair
 * labelled by the model with the tool as a secondary line, sized by the
 * lens (dollars, or every token class including cache-read), with the figure the lens does not rank
 * by muted beside it and the cache-read share as a small tag. The ranked list answers "what is the
 * single most expensive thing"; a heatmap or flow diagram would not. Rows are not clickable: the
 * page store has no tool or model filter to set.
 */
import { Box, Group, Stack, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import type { Range } from '../../lib/queries/usage'
import type { UsageLens, UsageScope } from '../../lib/window-stores'
import { flowLensOf, rankPairs, type PairRow } from './budget-model'
import {
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  noDataInWindow,
  periodNoun,
  tokensFormatterFor,
  SPEND_NOUN,
} from './model'
import { useFlow } from './use-flow'
import type { WorkspaceValue } from './types'
import classes from './usage.module.css'

const INFO =
  'The (model, tool) pairs that account for the most, ranked by the lens: dollars of API spend, or all tokens processed including cache-read. Each row is a model, with its tool beneath the figures; the muted figure is the other measure and the tag is the share of tokens re-read from the cache. The tail is grouped as Other.'

/** The row label is the model alone, so it never needs an ellipsis; the tool is the secondary column's first line. */
const rowLabel = (r: PairRow): string => (r.pairs > 1 ? `Other (${r.pairs} pairs)` : r.model)

export default function TopSpenders({
  range,
  lens,
  scope,
  workspace,
}: {
  range: Range
  lens: UsageLens
  scope: UsageScope
  workspace: WorkspaceValue[] | undefined
}) {
  const flow = useFlow({ range, lens, scope, workspace })
  const ranked = rankPairs(flow.rows, flowLensOf(lens))
  const spend = lens === 'spend'
  const peak = ranked.rows.reduce((max, r) => Math.max(max, r.value), 0)
  const format = spend ? fmtUsdWhole : tokensFormatterFor(peak)
  const second = spend ? fmtTokens : fmtUsdWhole
  const emptyText = noDataInWindow(spend ? 'spend' : 'token usage', range)

  return (
    <Box data-shot="top-spenders" data-shot-states="empty" h="100%">
      <ChartCard
        className={classes.fill}
        placeholderHeight="content"
        title={`Top ${spend ? 'spenders' : 'consumers'}: model · tool · ${periodNoun(range)}`}
        info={INFO}
        facts={
          spend
            ? { value: fmtUsdWhole(ranked.total), period: SPEND_NOUN[scope] }
            : { value: fmtTokens(ranked.total), period: 'incl. cache-read' }
        }
        {...(spend
          ? {
              subtitle: `${scope === 'all' ? 'Includes subscriptions at list value · ' : ''}Muted figure: tokens`,
            }
          : scope === 'all'
            ? { subtitle: 'Includes subscriptions at list value' }
            : {})}
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
              <Stack gap={0} align="flex-end">
                {r.pairs === 1 && (
                  <Text size="xs" c="dimmed" className={classes.share}>
                    {r.subTool}
                  </Text>
                )}
                <Group gap="xs" wrap="nowrap" justify="flex-end">
                  <Text span size="xs" c="dimmed">
                    {second(r.secondary)}
                  </Text>
                  {r.cacheReadShare !== null && (
                    <Text span size="xs" c="dimmed" className={classes.share}>
                      {fmtShare(r.cacheReadShare)} cached
                    </Text>
                  )}
                </Group>
              </Stack>
            ),
          }))}
        />
      </ChartCard>
    </Box>
  )
}
