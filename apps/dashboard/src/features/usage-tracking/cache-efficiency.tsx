/**
 * Cache efficiency: per tool, the dollars per million tokens with the cache-read share, so the tool
 * paying for fresh input that should have been cached shows next to what it costs. Largest first,
 * Other last. Read from the same `/usage/flow` response as the top spenders. A tool that reports no
 * cache fields is listed as `no cache data`: a zero cache share there is silence, not a measurement.
 */
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { Box, Text } from '@mantine/core'
import type { Range } from '../../lib/queries/usage'
import type { UsageLens } from '../../lib/window-stores'
import type { PayerValue } from './accounts'
import { NO_CACHE_DATA, fmtUsdPerMillion, toolSplits, type ToolSplit } from './budget-model'
import { fmtShare, noDataInWindow, periodNoun } from './model'
import { useFlow } from './use-flow'
import type { WorkspaceValue } from './types'
import classes from './usage.module.css'

/** Named tools before the rest fold into Other. */
const TOP_TOOLS = 6

const INFO =
  'What each tool costs per million tokens processed, with the share of its tokens re-read from the cache. The six largest tools are named, the rest are grouped as Other. A tool that reports no cache fields is marked.'

const readShare = (d: ToolSplit): string =>
  d.noCacheData || d.cacheReadShare === null
    ? NO_CACHE_DATA
    : `cache-read ${fmtShare(d.cacheReadShare)}`

export default function CacheEfficiency({
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
  const splits = toolSplits(flow.rows, { top: TOP_TOOLS })
  const emptyText = noDataInWindow('tool usage', range)

  return (
    <Box data-shot="cache-efficiency" data-shot-states="empty">
      <ChartCard
        placeholderHeight="content"
        title={`Cost per 1 M tokens · ${periodNoun(range)}`}
        info={INFO}
        state={{ empty: splits.length === 0 && emptyText }}
      >
        <BarList
          label={`Dollars per million tokens by tool, ${periodNoun(range)}`}
          format={fmtUsdPerMillion}
          variant="thin"
          items={splits.map((d) => ({
            key: d.subTool,
            label: d.subTool,
            value: d.usdPerMillion ?? 0,
            secondary: (
              <Text span size="xs" c="dimmed" className={classes.share}>
                {readShare(d)}
              </Text>
            ),
          }))}
        />
      </ChartCard>
    </Box>
  )
}
