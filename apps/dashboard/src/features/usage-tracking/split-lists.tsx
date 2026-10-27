/**
 * Projects and Tools on the Overview: the rows that account for the most across the wallets, each
 * with one bar split into the wallets that fed it (payer hue), its total in the measure, the change
 * against the window before and the biggest wallet's share written out. The tail is a text line, not a
 * bar, so it cannot squash the named rows. The bars share one scale: the first row's total.
 */
import { Box, Group, Stack, Text } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import type { Range, SplitRow } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import type { UsageLens } from '../../lib/window-stores'
import { ChangeBadge } from './change-badge'
import {
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  noDataInWindow,
  periodNoun,
  tokensFormatterFor,
} from './model'
import { change } from './period-model'
import {
  biggestWallet,
  cutList,
  measureOf,
  mixSegments,
  priorMeasureOf,
  UNSET_KEY,
} from './split-model'

const ROWS = 8

const DIMENSIONS = {
  project: {
    title: 'Projects',
    noun: 'projects',
    usage: 'project usage',
    info: 'The projects worked on most, normalized from the working directory. Each bar is split by the wallet that paid for it; the muted words before the total name the biggest wallet and its share. The glyph is the change against the equally long window before. Subscription dollars are list value, API dollars are spend: the bar adds them as one currency, API prices.',
    label: (key: string) => (key === UNSET_KEY ? '(no project)' : key),
  },
  tool: {
    title: 'Tools',
    noun: 'tools',
    usage: 'tool usage',
    info: 'The tools and lanes (interactive sessions, waves, reviews, workers) that account for the most. Each bar is split by the wallet that paid for it; the muted words before the total name the biggest wallet and its share. The glyph is the change against the equally long window before. Subscription dollars are list value, API dollars are spend: the bar adds them as one currency, API prices.',
    label: (key: string) => (key === UNSET_KEY ? '(no tool)' : key),
  },
} as const

export type SplitDimension = keyof typeof DIMENSIONS

export function SplitList({
  dimension,
  rows,
  lens,
  range,
}: {
  dimension: SplitDimension
  rows: readonly SplitRow[]
  lens: UsageLens
  range: Range
}) {
  const dim = DIMENSIONS[dimension]
  const cost = lens === 'cost'
  const cut = cutList(shotState() === 'empty' ? [] : rows, ROWS)
  const first = cut.named[0]
  const scaleMax = first === undefined ? 0 : measureOf(first, lens)
  const format = cost ? fmtUsdWhole : tokensFormatterFor(Math.max(scaleMax, 1))

  return (
    <Box data-shot={`split-${dimension}`} data-shot-states="empty">
      <ChartCard
        placeholderHeight="content"
        title={`${dim.title} · ${cost ? '$ at API prices' : 'fresh tokens'} · ${periodNoun(range)}`}
        info={dim.info}
        state={{ empty: cut.named.length === 0 && noDataInWindow(dim.usage, range) }}
      >
        <Stack gap="sm">
          {cut.named.map((row) => {
            const total = measureOf(row, lens)
            const top = biggestWallet(row, lens)
            return (
              <Stack key={row.key} gap={2}>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="sm" truncate>
                    {dim.label(row.key)}
                  </Text>
                  <Group gap="xs" wrap="nowrap">
                    {top === null ? null : (
                      <Text size="xs" c="dimmed">
                        {top.label} {fmtShare(top.share)}
                      </Text>
                    )}
                    <Text size="sm">{format(total)}</Text>
                    <ChangeBadge
                      change={change(total, priorMeasureOf(row, lens))}
                      polarity={cost ? 'up-bad' : 'neutral'}
                    />
                  </Group>
                </Group>
                <Meter
                  label={`${dim.label(row.key)}, split by wallet`}
                  size="row"
                  reading={false}
                  max={scaleMax}
                  format={format}
                  segments={mixSegments(row, lens)}
                />
              </Stack>
            )
          })}
          {cut.rest === null ? null : (
            <Text size="xs" c="dimmed">
              Other: {fmtUsdWhole(cut.rest.cost)} · {fmtTokens(cut.rest.fresh)}
            </Text>
          )}
        </Stack>
      </ChartCard>
    </Box>
  )
}
