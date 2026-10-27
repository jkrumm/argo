/**
 * Projects, Tools and Models of one scope (a wallet, or the Claude Max selection): the ones that account for the most, ranked by the
 * measure (dollars at API prices, or fresh tokens) from `/usage/split`. Each row shows the other
 * measure muted and the change against the window before as a delta glyph, so what moved is visible
 * where it is ranked. The tail is a text line, not a bar: it would outrank every named row.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Group, Text } from '@mantine/core'
import { BarList } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { usageQueries, type Range, type SplitBy } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import type { UsageLens } from '../../lib/window-stores'
import { UNKNOWN_MODEL } from './budget-model'
import { ChangeBadge } from './change-badge'
import { fmtTokens, fmtUsdWhole, noDataInWindow, periodNoun, tokensFormatterFor } from './model'
import { change } from './period-model'
import type { Scope } from './scope'
import { cutList, measureOf, priorMeasureOf, UNSET_KEY } from './split-model'
import type { WorkspaceValue } from './types'

const ROWS = 8

const DIMENSIONS = {
  project: {
    title: 'Projects',
    noun: 'projects',
    usage: 'project usage',
    info: 'The projects worked on most, normalized from the working directory.',
    label: (key: string) => (key === UNSET_KEY ? '(no project)' : key),
  },
  sub_tool: {
    title: 'Tools',
    noun: 'tools',
    usage: 'tool usage',
    info: 'The tools and lanes (interactive sessions, waves, reviews, workers) that account for the most.',
    label: (key: string) => (key === UNSET_KEY ? '(no tool)' : key),
  },
  model_norm: {
    title: 'Models',
    noun: 'models',
    usage: 'model usage',
    info: 'The models that account for the most, with version suffixes normalized.',
    label: (key: string) => (key === UNSET_KEY ? UNKNOWN_MODEL : key),
  },
} as const satisfies Record<SplitBy, unknown>

const SHARED_INFO =
  ' The bar follows the measure; the muted figure is the other measure and the glyph is the change against the equally long window before (new: nothing or next to nothing in it).'

export default function RankedList({
  by,
  scope,
  range,
  lens,
  workspace,
}: {
  by: SplitBy
  scope: Scope
  range: Range
  lens: UsageLens
  workspace: WorkspaceValue[] | undefined
}) {
  const dim = DIMENSIONS[by]
  const cost = lens === 'cost'
  const query = useSuspenseQuery(
    usageQueries.split({ by, range, lens, payer: scope.payers, workspace }),
  )
  const cut = cutList(shotState() === 'empty' ? [] : query.data.rows, ROWS)
  const peak = cut.named.reduce((max, r) => Math.max(max, measureOf(r, lens)), 0)
  const word = cost ? scope.word : 'fresh tokens'

  return (
    <Box data-shot={`ranked-${by}-${scope.id}`} data-shot-states="empty">
      <ChartCard
        placeholderHeight="content"
        title={`${dim.title} · ${word} · ${periodNoun(range)}`}
        info={dim.info + SHARED_INFO}
        state={{ empty: cut.named.length === 0 && noDataInWindow(dim.usage, range) }}
      >
        <BarList
          label={`Top ${dim.noun} by ${word}, ${periodNoun(range)}`}
          format={cost ? fmtUsdWhole : tokensFormatterFor(Math.max(peak, 1))}
          variant="thin"
          items={cut.named.map((r) => {
            const value = measureOf(r, lens)
            return {
              key: r.key,
              label: dim.label(r.key),
              value,
              secondary: (
                <Group gap="xs" wrap="nowrap" justify="flex-end">
                  <Text component="span" inherit c="dimmed">
                    {cost ? fmtTokens(r.fresh) : fmtUsdWhole(r.cost)}
                  </Text>
                  <ChangeBadge
                    change={change(value, priorMeasureOf(r, lens))}
                    polarity={cost ? scope.polarity : 'neutral'}
                  />
                </Group>
              ),
            }
          })}
        />
        {cut.rest === null ? null : (
          <Text size="xs" c="dimmed">
            Other: {fmtUsdWhole(cut.rest.cost)} · {fmtTokens(cut.rest.fresh)}
          </Text>
        )}
      </ChartCard>
    </Box>
  )
}
