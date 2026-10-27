/**
 * Projects and Tools on the Overview: the rows that account for the most across the wallets, each
 * with one bar split into the wallets that fed it (payer hue, the amounts named under it), its total
 * in the measure, the change against the window before and an inline daily sparkline.
 * A row opens its timeline: daily bars by wallet for that project over the range (a tool has no
 * per-wallet series, so its bars are one neutral series). One row is open at a time, by click or
 * keyboard. The tail is a text line, not a bar. The bars share one scale: the first row's total.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { Meter } from 'basalt-ui'
import { Bars, ChartCard, Sparkline } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { usageQueries, type Range, type SplitRow } from '../../lib/queries/usage'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import type { UsageLens } from '../../lib/window-stores'
import { PAYER_LABELS, type PayerValue } from './accounts'
import { colorForPayer, toTimePoints } from './constants'
import { ChangeBadge } from './change-badge'
import {
  dropPartialBucket,
  fmtTokens,
  fmtUsdWhole,
  noDataInWindow,
  periodNoun,
  shortDay,
  tokensFormatterFor,
} from './model'
import { change } from './period-model'
import { cutList, measureOf, mixSegments, priorMeasureOf, UNSET_KEY } from './split-model'
import type { TimePoint, WorkspaceValue } from './types'

const ROWS = 8
/** Keys the sparkline call keeps: wider than the rows shown, so a rank difference never drops one. */
const SERIES_TOP = 12
const SPARK_WIDTH = 96
const SPARK_HEIGHT = 28
const TIMELINE_HEIGHT = 140

const SHARED_INFO =
  'Each bar is split by the wallet that paid for it, the amounts named under it. The glyph is the change against the equally long window before. Subscription dollars are list value, API dollars are spend: the bar adds them as one currency, API prices. The line at the right is the row’s usage per day; a row opens its timeline.'

const DIMENSIONS = {
  project: {
    title: 'Projects',
    usage: 'project usage',
    groupBy: 'project',
    info: `The projects worked on most, normalized from the working directory. ${SHARED_INFO}`,
    label: (key: string) => (key === UNSET_KEY ? '(no project)' : key),
    /** Only a named project can be filtered on: an unset one is NULL in the table. */
    hasTimeline: (key: string) => key !== UNSET_KEY,
  },
  tool: {
    title: 'Tools',
    usage: 'tool usage',
    groupBy: 'sub_tool',
    info: `The tools and lanes (interactive sessions, waves, reviews, workers) that account for the most. ${SHARED_INFO}`,
    label: (key: string) => (key === UNSET_KEY ? '(no tool)' : key),
    hasTimeline: () => true,
  },
} as const

export type SplitDimension = keyof typeof DIMENSIONS

const dayTotal = (d: TimePoint): number =>
  Object.values(d.groups).reduce<number>((sum, v) => sum + (v ?? 0), 0)

/** Daily bars of one row: by wallet for a project, one neutral series for a tool. */
function Timeline({
  id,
  dimension,
  rowKey,
  tool,
  range,
  lens,
  workspace,
  now,
}: {
  id: string
  dimension: SplitDimension
  rowKey: string
  /** The tool's own points (from the sparkline call); unused for a project. */
  tool: readonly TimePoint[]
  range: Range
  lens: UsageLens
  workspace: WorkspaceValue[] | undefined
  now: number
}) {
  const cost = lens === 'cost'
  const project = dimension === 'project'
  const query = useQuery({
    ...usageQueries.timeseries({
      range,
      grain: 'day',
      metric: cost ? 'cost' : 'tokens',
      groupBy: 'payer',
      project: [rowKey],
      workspace,
    }),
    enabled: project,
  })
  const points = project ? toTimePoints(query.data?.buckets ?? []) : [...tool]
  const keys = project ? (query.data?.groupKeys ?? []) : [rowKey]
  const drawn = dropPartialBucket(points, now, 'day')
  const peak = drawn.reduce((max, p) => Math.max(max, dayTotal(p)), 0)
  const format = cost ? fmtUsdWhole : tokensFormatterFor(Math.max(peak, 1))
  const pending = project && query.isPending

  return (
    <Box id={id} data-shot-timeline>
      {pending ? (
        <Text size="xs" c="dimmed">
          loading
        </Text>
      ) : drawn.length === 0 || peak <= 0 ? (
        <Text size="xs" c="dimmed">
          Nothing in this window
        </Text>
      ) : (
        <Bars
          ariaLabel={`${DIMENSIONS[dimension].label(rowKey)} per day${project ? ', stacked by wallet' : ''}`}
          data={drawn}
          height={TIMELINE_HEIGHT}
          x={(d: TimePoint) => d.date}
          formatX={(d) => shortDay(d)}
          cursorGroup={`usage-row-${id}`}
          cursorResolution="leading"
          bars={keys.map((key) => ({
            key,
            label: project
              ? (PAYER_LABELS[key as PayerValue] ?? key)
              : DIMENSIONS[dimension].label(key),
            color: project ? colorForPayer(key) : VX.line,
            getValue: (d: TimePoint) => d.groups[key] ?? 0,
            formatValue: format,
          }))}
          y={{ format, ticks: 3 }}
          tooltip={{ rows: (d) => [{ label: 'Total', value: format(dayTotal(d)) }] }}
        />
      )}
    </Box>
  )
}

export function SplitList({
  dimension,
  rows,
  lens,
  range,
  workspace,
}: {
  dimension: SplitDimension
  rows: readonly SplitRow[]
  lens: UsageLens
  range: Range
  workspace: WorkspaceValue[] | undefined
}) {
  const dim = DIMENSIONS[dimension]
  const cost = lens === 'cost'
  const now = useNow()
  const [open, setOpen] = useState<string | null>(null)
  const cut = cutList(shotState() === 'empty' ? [] : rows, ROWS)
  const first = cut.named[0]
  const scaleMax = first === undefined ? 0 : measureOf(first, lens)
  const format = cost ? fmtUsdWhole : tokensFormatterFor(Math.max(scaleMax, 1))
  // One call for every row's sparkline: the top keys of the dimension by day.
  const daily = useQuery(
    usageQueries.timeseries({
      range,
      grain: 'day',
      metric: cost ? 'cost' : 'tokens',
      groupBy: dim.groupBy,
      top: SERIES_TOP,
      workspace,
    }),
  )
  const dailyPoints = dropPartialBucket(toTimePoints(daily.data?.buckets ?? []), now, 'day')
  const sparkFormat = cost ? fmtUsdWhole : tokensFormatterFor(Math.max(scaleMax, 1))

  return (
    <Box data-shot={`split-${dimension}`} data-shot-states="empty">
      <ChartCard
        placeholderHeight="content"
        title={`${dim.title} · ${cost ? '$ at API prices' : 'fresh tokens'} · ${periodNoun(range)}`}
        info={dim.info}
        state={{ empty: cut.named.length === 0 && noDataInWindow(dim.usage, range) }}
      >
        <Stack gap="sm">
          {cut.named.map((row, index) => {
            const total = measureOf(row, lens)
            const label = dim.label(row.key)
            const expandable = dim.hasTimeline(row.key)
            const isOpen = open === row.key
            const timelineId = `usage-${dimension}-timeline-${index}`
            const known = daily.data?.groupKeys.includes(row.key) ?? false
            const rowPoints = known ? dailyPoints : []
            const rowValues = rowPoints.map((p) => p.groups[row.key] ?? 0)
            const body = (
              <Group wrap="nowrap" gap="md" align="center">
                <Stack gap={2} flex={1} miw={0}>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Group gap={4} wrap="nowrap" miw={0}>
                      {expandable ? (
                        <Box component="span" flex="none" lh={0} c="dimmed">
                          {isOpen ? (
                            <IconChevronDown size={14} aria-hidden />
                          ) : (
                            <IconChevronRight size={14} aria-hidden />
                          )}
                        </Box>
                      ) : null}
                      <Text size="sm" truncate>
                        {label}
                      </Text>
                    </Group>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm">{format(total)}</Text>
                      <ChangeBadge
                        change={change(total, priorMeasureOf(row, lens))}
                        polarity={cost ? 'up-bad' : 'neutral'}
                      />
                    </Group>
                  </Group>
                  <Meter
                    label={`${label}, split by wallet`}
                    size="row"
                    reading={false}
                    max={scaleMax}
                    format={format}
                    segments={mixSegments(row, lens)}
                  />
                </Stack>
                <Box w={SPARK_WIDTH} h={SPARK_HEIGHT} flex="none">
                  {rowValues.length < 2 ? null : (
                    <Sparkline
                      ariaLabel={`${label} per day, ${periodNoun(range)}`}
                      data={rowValues}
                      labels={rowPoints.map((p) => shortDay(p.date))}
                      height={SPARK_HEIGHT}
                      width={SPARK_WIDTH}
                      mark="bar"
                      emphasizeLast={false}
                      format={sparkFormat}
                    />
                  )}
                </Box>
              </Group>
            )
            return (
              <Stack key={row.key} gap="xs">
                {expandable ? (
                  <UnstyledButton
                    w="100%"
                    aria-expanded={isOpen}
                    aria-controls={timelineId}
                    onClick={() => setOpen(isOpen ? null : row.key)}
                  >
                    {body}
                  </UnstyledButton>
                ) : (
                  body
                )}
                {isOpen ? (
                  <Timeline
                    id={timelineId}
                    dimension={dimension}
                    rowKey={row.key}
                    tool={
                      dimension === 'tool'
                        ? dailyPoints.map((p) => ({
                            date: p.date,
                            groups: { [row.key]: p.groups[row.key] ?? 0 },
                          }))
                        : []
                    }
                    range={range}
                    lens={lens}
                    workspace={workspace}
                    now={now}
                  />
                ) : null}
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
