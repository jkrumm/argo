/**
 * Section C, cache efficiency: per tool, the four-way token split as 100 % stacked bars (cache-read /
 * cache-write / fresh input / output), and under it the dollars per million tokens with the
 * cache-read share, so the tool paying for fresh input that should have been cached shows next to
 * what it costs, in the bars' order (largest first, Other last). Read from the same `/usage/flow` response as section B. A tool that reports no cache
 * fields is listed as `no cache data` and left out of the bars: a zero cache share there is silence,
 * not a measurement.
 */
import { BarList } from 'basalt-ui'
import { Bars, ChartCard } from 'basalt-ui/charts'
import { Box, Stack, Text } from '@mantine/core'
import type { Range } from '../../lib/queries/usage'
import { USAGE_TOKEN } from '../../lib/series'
import type { UsageLens, UsageScope } from '../../lib/window-stores'
import { NO_CACHE_DATA, fmtUsdPerMillion, toolSplits, type ToolSplit } from './budget-model'
import { fmtShare, fmtTokens, noDataInWindow, periodNoun } from './model'
import type { TokenClass } from './over-time-model'
import { useFlow } from './use-flow'
import type { WorkspaceValue } from './types'
import classes from './usage.module.css'

const BAR_HEIGHT = 260
/** Named tools before the rest fold into Other: with Other, few enough bars that every one keeps its x label. */
const CHART_TOOLS = 5
/** Longest x label in characters at 390 px: the axis drops a label that overlaps its neighbour, so a longer name is cut. */
const AXIS_LABEL_MAX = 9

const INFO =
  'Each bar is one tool, split into the share of its tokens that were re-read from the cache, written to it, sent as fresh input, and produced as output. The five largest tools are named, the rest (and any under 1 M tokens) are grouped as Other. Below: what each tool costs per million tokens processed, with its cache-read share. A tool that reports no cache fields is marked.'

const LABELS: Record<TokenClass, string> = {
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  input: 'Fresh input',
  output: 'Output',
}

const VALUE: Record<TokenClass, (d: ToolSplit) => number> = {
  cacheRead: (d) => d.cacheRead,
  cacheWrite: (d) => d.cacheWrite,
  input: (d) => d.freshInput,
  output: (d) => d.output,
}

/** Bottom to top, as in section A: the fresh classes on the baseline, cache-read on top. */
const STACK: readonly TokenClass[] = ['output', 'input', 'cacheWrite', 'cacheRead']

/** The bars are normalized, so the tooltip row reads the class as a share of the tool's tokens and its absolute count beside it. */
const classReading = (cls: TokenClass, count: number, d: ToolSplit): string =>
  `${fmtShare(d.processed > 0 ? count / d.processed : null)} · ${fmtTokens(count)}`

const BARS = STACK.map((cls) => ({
  key: cls,
  label: LABELS[cls],
  color: USAGE_TOKEN[cls],
  getValue: VALUE[cls],
  formatValue: (v: number, d: ToolSplit) => classReading(cls, v, d),
}))

const fmtAxisShare = (v: number) => `${Math.round(v * 100)} %`

/** Short axis names for tools whose generic shortening would not read (or would collide). */
const KNOWN_SHORT: Record<string, string> = {
  review_ocr: 'ocr',
  'agent-gateway:review': 'review',
  'agent-gateway:check': 'check',
  'research-gateway': 'research',
  interactive: 'interact',
}

const lastSegment = (name: string): string => name.split(':').pop() ?? name

/** A tool's axis names from the shortest to the full name; a collision between two tools moves both one step down. */
const axisCandidates = (name: string): string[] => {
  const generic = lastSegment(name)
    .replace(/-(gateway|agent|code)$/, '')
    .replace(/^review_/, '')
  return [KNOWN_SHORT[name] ?? generic, lastSegment(name), name]
}

const cut = (label: string): string =>
  label.length > AXIS_LABEL_MAX ? `${label.slice(0, AXIS_LABEL_MAX - 1)}…` : label

/** The axis label per tool: short, distinct within the chart; the list below and the tooltip keep the full name. */
const axisLabels = (names: readonly string[]): Map<string, string> => {
  const candidates = new Map(names.map((n) => [n, axisCandidates(n)]))
  const level = new Map(names.map((n) => [n, 0]))
  const pick = (n: string) => {
    const options = candidates.get(n)!
    return options[Math.min(level.get(n)!, options.length - 1)]!
  }
  for (let pass = 0; pass < 3; pass++) {
    const owners = new Map<string, string[]>()
    for (const n of names) owners.set(pick(n), [...(owners.get(pick(n)) ?? []), n])
    const clashing = [...owners.values()].filter((group) => group.length > 1).flat()
    if (clashing.length === 0) break
    for (const n of clashing) level.set(n, level.get(n)! + 1)
  }
  return new Map(names.map((n) => [n, cut(pick(n))]))
}

const readShare = (d: ToolSplit): string =>
  d.noCacheData || d.cacheReadShare === null
    ? NO_CACHE_DATA
    : `cache-read ${fmtShare(d.cacheReadShare)}`

export default function CacheEfficiency({
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
  const splits = toolSplits(flow.rows, { top: CHART_TOOLS })
  const bars = splits.filter((s) => !s.noCacheData)
  const axis = axisLabels(bars.map((d) => d.subTool))
  const emptyText = noDataInWindow('tool usage', range)

  return (
    <Box data-shot="cache-efficiency" data-shot-states="empty" h="100%">
      <ChartCard
        className={classes.fill}
        placeholderHeight="content"
        title={`Cache efficiency by tool · ${periodNoun(range)}`}
        info={INFO}
        state={{ empty: splits.length === 0 && emptyText }}
      >
        <Stack gap="md">
          {bars.length > 0 && (
            <Box data-shot-tooltip>
              <Bars
                ariaLabel={`Token split per tool, ${periodNoun(range)}: cache read, cache write, fresh input and output as shares of each tool's tokens`}
                data={bars}
                height={BAR_HEIGHT}
                x={(d: ToolSplit) => d.subTool}
                xTicks={bars.map((d) => d.subTool)}
                formatX={(x) => axis.get(x) ?? x}
                layout="normalized"
                bars={BARS}
                y={{ domain: [0, 1], ticks: [0, 0.5, 1], format: fmtAxisShare }}
                legend={{ placement: 'bottom' }}
                tooltip={{
                  formatHeader: (x) => x,
                  rows: (d) => [
                    { label: 'Processed', value: fmtTokens(d.processed) },
                    { label: 'Per 1 M tokens', value: fmtUsdPerMillion(d.usdPerMillion) },
                  ],
                }}
              />
            </Box>
          )}
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              Cost per 1 M tokens
            </Text>
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
          </Stack>
        </Stack>
      </ChartCard>
    </Box>
  )
}
