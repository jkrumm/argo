/**
 * The three cells of the body-composition strip. Each takes already-fetched data and returns one
 * question: where is the weight against the goal, how fast is it moving, how thick are the folds.
 */
import type { ReactNode } from 'react'
import { Box } from '@mantine/core'
import { DeltaBadge, Meter, type StatStripCell } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { format } from 'date-fns'
import { NBSP, withUnit } from '../../../lib/format'
import { SERIES } from '../../../lib/series'
import { skinfoldDirectionLabel } from '../formulas'
import {
  deltaFromMean,
  fixed,
  goalProgress,
  NO_WEIGHT_ENTRIES_SHORT,
  RATE_NEUTRAL_KG_WK,
  rateQualifier,
  rateFooter,
  RATE_SCALE_KG_WK,
  signed,
  weightDeltaPolarity,
  type SiteRow,
  withKg,
} from '../model'
import { localDay } from '../charts/series-data'
import type { SkinfoldSummary, WeightSummary, WeightWindowStats } from '../types'
import { GoalPopover } from './goal-popover'

const SITE_COLORS = {
  abdominal: SERIES.skinfoldAbdominal,
  suprailiac: SERIES.skinfoldSuprailiac,
} as const

const dateLabel = (key: string | null): string | undefined =>
  key === null ? undefined : format(localDay(key), 'd MMM')

const hasNoWeightEntries = (summary: WeightSummary, stats: WeightWindowStats): boolean =>
  summary.current === null && stats.mean7 === null

/**
 * A cell in `state` draws no `footer` of its own, so the `Set a goal` action a goalless no-entries
 * Weight cell would lose rides the strip's footer, under that cell.
 */
export function weightFooterEntries({
  summary,
  stats,
  goal,
}: {
  summary: WeightSummary
  stats: WeightWindowStats
  goal: number | null
}): { key: string; under: string; content: ReactNode }[] {
  if (!hasNoWeightEntries(summary, stats) || goal !== null) return []
  return [
    { key: 'weight-goal', under: 'weight', content: <GoalPopover lastWeight={summary.current} /> },
  ]
}

export function weightCell({
  summary,
  stats,
  goal,
  startWeight,
  startDate,
  latestDate,
  range,
}: {
  summary: WeightSummary
  stats: WeightWindowStats
  goal: number | null
  startWeight: number | null
  startDate: string | null
  latestDate: string | null
  /** The window's lowest and highest weigh-in; the no-goal meter's extent. */
  range: { min: number; max: number } | null
}): StatStripCell {
  const delta = deltaFromMean(summary.current, stats.mean30)
  const progress = goalProgress({ start: startWeight, current: summary.current, goal })
  const latest = dateLabel(latestDate)

  const meanFooter = `${withUnit(withUnit(7, 'd'), 'mean')} ${stats.mean7 === null ? '—' : withKg(stats.mean7)}`

  if (hasNoWeightEntries(summary, stats)) {
    return {
      key: 'weight',
      caption: 'Weight',
      ...(latest !== undefined && { qualifier: `latest ${latest}` }),
      state: { kind: 'empty', reason: NO_WEIGHT_ENTRIES_SHORT },
    }
  }

  return {
    key: 'weight',
    caption: 'Weight',
    ...(latest !== undefined && { qualifier: `latest ${latest}` }),
    value: summary.current === null ? null : fixed(summary.current),
    unit: 'kg',
    ...(delta !== null && {
      delta: (
        <DeltaBadge
          value={delta}
          polarity={weightDeltaPolarity(summary.current, goal)}
          format={(v) => withKg(Math.abs(v))}
          period={`30${NBSP}d${NBSP}mean`}
        />
      ),
    }),
    ...(progress !== null &&
      goal !== null &&
      startWeight !== null && {
        visual: (
          <Meter
            label="Progress from the first weight in the window to the goal weight"
            value={progress.moved}
            min={0}
            max={progress.span}
            target={progress.span}
            format={(v) => withKg(v)}
            startCaption={`start ${withKg(startWeight)}${startDate === null ? '' : ` \u00b7 ${dateLabel(startDate)}`}`}
            endCaption={`${withKg(goal)} goal`}
            tone="muted"
          />
        ),
      }),
    ...(goal === null &&
      summary.current !== null &&
      range !== null && {
        visual: (
          <Meter
            label="Current weight within the window's lowest and highest weigh-in"
            value={summary.current}
            min={range.min}
            max={range.max}
            format={(v) => withKg(v)}
            startCaption={`low ${withKg(range.min)}`}
            endCaption={`high ${withKg(range.max)}`}
            tone="muted"
          />
        ),
      }),
    footer: (
      <>
        <span>{meanFooter}</span>
        {goal === null && (
          <Box pt="xs">
            <GoalPopover lastWeight={summary.current} />
          </Box>
        )}
      </>
    ),
  }
}

export function rateCell({
  summary,
  rateDays,
  entries,
  status,
}: {
  summary: WeightSummary
  rateDays: number
  /** Weigh-ins in the window. */
  entries: number
  /** The summary query's state; a loading or failed rate is never a data gap. */
  status: 'pending' | 'error' | 'success'
}): StatStripCell {
  const rate = summary.kgPerWeek
  // A settled cell with no rate says why in the strip's empty state; a pending or failed one keeps the meter line.
  const line = rateFooter({ rate, entries, status })
  if (rate === null && status === 'success') {
    return {
      key: 'rate',
      caption: 'Rate',
      qualifier: rateQualifier(rateDays),
      state: { kind: 'empty', reason: line },
    }
  }
  return {
    key: 'rate',
    caption: 'Rate',
    qualifier: rateQualifier(rateDays),
    value: rate === null ? null : signed(rate, 2),
    unit: 'kg/wk',
    visual: (
      <Meter
        label="Weight change rate against the maintenance band"
        value={rate}
        min={-RATE_SCALE_KG_WK}
        max={RATE_SCALE_KG_WK}
        format={(v) => `${signed(v, 2)}\u00a0kg/wk`}
        zones={[
          { from: -RATE_SCALE_KG_WK, to: -RATE_NEUTRAL_KG_WK, label: 'Cut' },
          {
            from: -RATE_NEUTRAL_KG_WK,
            to: RATE_NEUTRAL_KG_WK,
            label: 'Maintain',
            short: `\u00b1${RATE_NEUTRAL_KG_WK}`,
          },
          { from: RATE_NEUTRAL_KG_WK, to: RATE_SCALE_KG_WK, label: 'Bulk' },
        ]}
        startCaption={null}
        emptyText={line}
      />
    ),
    ...(rate !== null && { footer: line }),
  }
}

export function skinfoldCell({
  summary,
  rows,
  latestDate,
}: {
  summary: SkinfoldSummary
  rows: SiteRow[]
  latestDate: string | null
}): StatStripCell {
  const latest = dateLabel(latestDate)
  return {
    key: 'skinfold',
    caption: 'Skinfold',
    ...(latest !== undefined && { qualifier: `latest session ${latest}` }),
    value: summary.current === null ? null : fixed(summary.current),
    unit: 'mm session average',
    footer: `${skinfoldDirectionLabel(summary.direction)} · ${signed(summary.mmPerWeek, 2)} mm/wk over 28 d`,
    rows: rows.map((row) => ({
      key: row.site,
      label: row.label,
      value: row.current === null ? null : `${row.current.toFixed(1)} mm`,
      ...(row.values.length >= 2 && {
        visual: (
          <Sparkline
            ariaLabel={`${row.label} skinfold readings per session`}
            data={row.values}
            height={24}
            color={SITE_COLORS[row.site]}
            emphasizeLast
          />
        ),
      }),
      ...(row.delta !== null && {
        delta: (
          <DeltaBadge
            value={row.delta}
            polarity="up-bad"
            format={(v) => `${Math.abs(v).toFixed(1)} mm`}
            period={row.priorDate === null ? 'prior' : dateLabel(row.priorDate)}
          />
        ),
      }),
    })),
  }
}
