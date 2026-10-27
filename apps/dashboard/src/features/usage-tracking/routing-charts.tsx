/**
 * The Routing section's charts beside the timeline: why decisions went where they did (reason mix
 * per bucket and spill rate per lane), and the 5 h session quota of every account with the
 * picker's ceiling and the resets that refill it.
 */
import { Box, Grid, Text } from '@mantine/core'
import { lineY } from '@tanstack/charts/line'
import { decorative } from '@tanstack/charts/mark/decorative'
import { ruleX } from '@tanstack/charts/rule'
import { text } from '@tanstack/charts/text'
import { BarList } from 'basalt-ui'
import {
  Bars,
  CartesianChart,
  ChartCard,
  type ChartMarks,
  type ChartSeries,
  type PlotContext,
} from 'basalt-ui/charts'
import { alpha, CONTAINER_GRID_BREAKPOINTS, VX } from 'basalt-ui/tokens'
import { withUnit } from '../../lib/format'
import { shotState } from '../../lib/shot-state'
import type { PicksSummaryResponse, QuotaResponse } from '../../lib/queries/usage'
import { PICKER_CEILINGS } from './accounts'
import { shortDay, shortHour } from './model'
import {
  accountColor,
  accountTitle,
  fiveHourRows,
  laneSpillRows,
  reasonColor,
  reasonKeys,
  reasonLabel,
  reasonRows,
  resetTicks,
  sortAccounts,
  type ReasonRow,
  type SawRow,
} from './routing-model'
import { dayTicks } from './quota-model'

const MIX_HEIGHT = 220
const SAW_HEIGHT = 280
const HOUR_MS = 3_600_000

const MIX_INFO =
  'Why the picker chose what it chose, per bucket, as a share of that bucket’s picks (hover for the counts). Home is the lane’s own account, pace and session are the other healthy reasons; spill (an account took the overflow) and no eligible account (nothing could serve) are the failures. A growing warn or red layer means the ceilings are binding.'

const SPILL_INFO =
  'Spills over picks per lane, worst first: the lane could not be served by its own account. The bar is the rate on a 0–100 % scale; the counts are spills of picks.'

const SAW_INFO =
  'Share of each account’s 5 h session window used, from the collector’s samples. A line climbs while the window fills and drops when it resets. The dashed line is the picker’s session ceiling: above it the account takes no new work. Thin ticks are 5 h resets; the strong, labelled ones are weekly resets.'

const pctText = (v: number) => withUnit(Math.round(v), '%')

export function ReasonMix({ summary, hours }: { summary: PicksSummaryResponse; hours: number }) {
  const rows = shotState() === 'empty' ? [] : reasonRows(summary.series)
  const keys = reasonKeys([...new Set(rows.flatMap((r) => Object.keys(r.counts)))])
  const total = rows.reduce((sum, r) => sum + r.total, 0)
  const home = rows.reduce((sum, r) => sum + (r.counts['home'] ?? 0), 0)
  const hourly = summary.bucketHours === 1
  const formatBucket = hourly ? shortHour : shortDay
  const first = rows[0]?.at

  return (
    <Box data-shot="routing-reasons" data-shot-states="empty" h="100%">
      <ChartCard
        title="Why accounts were chosen"
        info={MIX_INFO}
        subtitle={`Share of each ${hourly ? 'hour' : 'day'}’s picks${first === undefined ? '' : ` · since ${shortDay(first)}`}`}
        placeholderHeight={MIX_HEIGHT}
        state={{ empty: total === 0 && 'No picker decisions in this range' }}
        facts={{
          value: total === 0 ? '—' : String(Math.round((home / total) * 100)),
          unit: '% home',
          period: `of ${total} picks · last ${hours / 24} d`,
        }}
      >
        <Bars<ReasonRow, Date>
          ariaLabel="Picker decisions by reason, as a share per bucket"
          data={rows}
          height={MIX_HEIGHT}
          x={(d) => d.at}
          formatX={(d) => formatBucket(d)}
          layout="normalized"
          cursorGroup="usage-routing-reasons"
          cursorResolution="leading"
          y={{ format: (v) => pctText(v * 100), ticks: [0, 0.5, 1] }}
          bars={keys.map((k) => ({
            key: k,
            label: reasonLabel(k),
            color: reasonColor(k),
            getValue: (d: ReasonRow) => d.counts[k] ?? 0,
            formatValue: (v: number) => `${v} ${v === 1 ? 'pick' : 'picks'}`,
          }))}
          tooltip={{
            formatHeader: (d) => formatBucket(d),
            rows: (d) => [{ label: 'Total', value: `${d.total} picks` }],
          }}
        />
      </ChartCard>
    </Box>
  )
}

export function SpillByLane({ summary }: { summary: PicksSummaryResponse }) {
  const lanes = shotState() === 'empty' ? [] : laneSpillRows(summary.lanes)

  return (
    <Box data-shot="routing-spill-lanes" data-shot-states="empty" h="100%">
      <ChartCard
        title="Spill rate per lane"
        info={SPILL_INFO}
        placeholderHeight="content"
        state={{ empty: lanes.length === 0 && 'No picker decisions in this range' }}
      >
        <BarList
          label="Spill rate per lane"
          variant="thin"
          max={100}
          format={(v) => pctText(v)}
          items={lanes.map((l) => ({
            key: l.lane,
            label: l.lane,
            value: l.rate * 100,
            secondary: (
              <Text component="span" inherit c="dimmed">
                {l.spills} of {l.total}
              </Text>
            ),
          }))}
        />
      </ChartCard>
    </Box>
  )
}

export function ReasonsAndSpill({
  summary,
  hours,
}: {
  summary: PicksSummaryResponse
  hours: number
}) {
  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
      <Grid.Col span={{ base: 12, lg: 8 }}>
        <ReasonMix summary={summary} hours={hours} />
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <SpillByLane summary={summary} />
      </Grid.Col>
    </Grid>
  )
}

export function Sawtooth({
  quota,
  now,
  hours,
}: {
  quota: QuotaResponse
  now: number
  hours: number
}) {
  const fromMs = now - hours * HOUR_MS
  const empty = shotState() === 'empty'
  const rows = empty ? [] : fiveHourRows(quota.series, fromMs)
  const accounts = sortAccounts(quota.series.map((s) => s.account)).filter((a) =>
    rows.some((r) => r.pct[a] !== undefined),
  )
  const firstMs = rows[0]?.at.getTime()
  const lastMs = rows.at(-1)?.at.getTime()
  const ticks =
    firstMs === undefined || lastMs === undefined || empty
      ? []
      : resetTicks(quota.resets, firstMs, lastMs)
  const five = ticks.filter((t) => t.window === 'five_hour')
  const seven = ticks.filter((t) => t.window === 'seven_day')

  const series: ChartSeries<SawRow>[] = accounts.map((a) => ({
    key: a,
    label: accountTitle(a),
    color: accountColor(a),
    getValue: (d) => d.pct[a] ?? null,
    gaps: 'connect',
  }))

  const marks = (plot: PlotContext<SawRow, Date>): ChartMarks => {
    const out: ChartMarks[number][] = []
    if (five.length > 0) {
      out.push(
        decorative(
          ruleX(five, {
            id: 'resets-5h',
            x: (t) => t.at,
            stroke: VX.muted,
            strokeOpacity: 0.12,
            strokeWidth: 1,
          }),
        ),
      )
    }
    for (const s of plot.visible) {
      const own = seven.filter((t) => t.account === s.key)
      if (own.length === 0) continue
      out.push(
        decorative(
          ruleX(own, {
            id: `resets-7d-${s.key}`,
            x: (t) => t.at,
            stroke: s.color,
            strokeOpacity: 0.85,
            strokeWidth: 2,
          }),
        ),
        decorative(
          text(own, {
            id: `resets-7d-label-${s.key}`,
            x: (t) => t.at,
            y: () => plot.yDomain[1],
            text: () => `7 d reset · ${s.key}`,
            fill: VX.ink2,
            fontSize: VX.text.xs,
            anchor: 'start',
            dx: 4,
            dy: 12,
          }),
        ),
      )
    }
    for (const s of plot.visible) {
      const drawn = plot.rows(s.key).filter((r) => r.y !== null)
      out.push(
        lineY(drawn, {
          id: s.key,
          x: (r) => r.x,
          y: 'y',
          z: 'series',
          stroke: s.color,
          strokeWidth: 1.75,
        }),
      )
    }
    return out
  }

  const first = firstMs === undefined ? null : new Date(firstMs)
  const startsInside = firstMs !== undefined && firstMs > fromMs + HOUR_MS

  return (
    <Box data-shot="routing-sawtooth" data-shot-states="empty">
      <ChartCard
        title="5 h session quota"
        info={SAW_INFO}
        subtitle={
          first === null
            ? undefined
            : `Samples ${startsInside ? 'since' : 'from'} ${shortDay(first)} · one point per ${hours <= 72 ? '15 min' : 'hour'}`
        }
        placeholderHeight={SAW_HEIGHT}
        state={{ empty: rows.length === 0 && 'No quota samples in this range' }}
        facts={{
          value: String(five.length),
          unit: five.length === 1 ? '5 h reset' : '5 h resets',
          period: [`${seven.length} weekly`, `last ${hours / 24} d`],
        }}
      >
        <CartesianChart<SawRow, Date>
          ariaLabel="5 hour session quota used per account, with the picker's session ceiling and the resets"
          data={rows}
          height={SAW_HEIGHT}
          x={(d) => d.at}
          xTicks={dayTicks(rows, 6)}
          formatX={(d) => shortDay(d)}
          cursorGroup="usage-routing-quota"
          series={series}
          marks={marks}
          y={{ domain: 'auto', autoMaxFloor: 100, format: pctText, ticks: [0, 50, 100] }}
          refLines={[
            {
              value: PICKER_CEILINGS.session,
              color: alpha(VX.ink, 0.6),
              dashed: true,
              label: `session ceiling ${PICKER_CEILINGS.session} %`,
            },
          ]}
          tooltip={{ formatHeader: (d) => shortHour(d) }}
        />
      </ChartCard>
    </Box>
  )
}
