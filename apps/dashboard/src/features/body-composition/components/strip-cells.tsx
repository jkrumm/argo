/**
 * The three cells of the body-composition strip. Each takes already-fetched data and returns one
 * question: where is the weight against the goal, how fast is it moving, how thick are the folds.
 */
import { Box } from '@mantine/core'
import { DeltaBadge, Meter, type StatStripCell } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { format } from 'date-fns'
import { SERIES } from '../../../lib/series'
import { skinfoldDirectionLabel } from '../formulas'
import {
  deltaFromMean,
  fixed,
  goalProgress,
  intensityBand,
  RATE_NEUTRAL_KG_WK,
  rateFooter,
  RATE_SCALE_KG_WK,
  signed,
  weightDeltaPolarity,
  type SiteRow,
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

export function weightCell({
  summary,
  stats,
  goal,
  startWeight,
  startDate,
  latestDate,
}: {
  summary: WeightSummary
  stats: WeightWindowStats
  goal: number | null
  startWeight: number | null
  startDate: string | null
  latestDate: string | null
}): StatStripCell {
  const delta = deltaFromMean(summary.current, stats.mean30)
  const progress = goalProgress({ start: startWeight, current: summary.current, goal })
  const latest = dateLabel(latestDate)

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
          format={(v) => `${Math.abs(v).toFixed(1)} kg`}
          period="30 d mean"
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
            format={(v) => `${v.toFixed(1)} kg`}
            startCaption={`start ${fixed(startWeight)} kg${startDate === null ? '' : ` \u00b7 ${dateLabel(startDate)}`}`}
            endCaption={`${fixed(goal)} kg goal`}
            tone="muted"
          />
        ),
      }),
    footer: (
      <>
        <span>
          7 d mean {fixed(stats.mean7)}&nbsp;kg · 30 d mean {fixed(stats.mean30)}&nbsp;kg
        </span>
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
  stats,
  rateDays,
  latestDate,
}: {
  summary: WeightSummary
  stats: WeightWindowStats
  rateDays: number
  latestDate: string | null
}): StatStripCell {
  const rate = summary.kgPerWeek
  const band = intensityBand(rate)
  return {
    key: 'rate',
    caption: 'Rate',
    qualifier: `${rateDays} d slope to ${dateLabel(latestDate) ?? 'latest entry'}`,
    value: rate === null ? null : signed(rate, 2),
    unit: 'kg/wk',
    visual: (
      <Meter
        label="Weight change rate against the maintenance band"
        value={rate}
        min={-RATE_SCALE_KG_WK}
        max={RATE_SCALE_KG_WK}
        format={(v) => `${signed(v, 2)} kg/wk`}
        zones={[
          { from: -RATE_SCALE_KG_WK, to: -RATE_NEUTRAL_KG_WK, label: 'Cut' },
          {
            from: -RATE_NEUTRAL_KG_WK,
            to: RATE_NEUTRAL_KG_WK,
            label: `Maintenance \u00b1${RATE_NEUTRAL_KG_WK}`,
          },
          { from: RATE_NEUTRAL_KG_WK, to: RATE_SCALE_KG_WK, label: 'Bulk' },
        ]}
        startCaption={null}
        endCaption={band === null ? null : `tier ${band}`}
        emptyText="No rate yet"
      />
    ),
    // No hero-extra pill slot on a strip cell, so the intensity word leads the footer.
    footer:
      rate === null
        ? rateFooter(stats.slope7)
        : `${summary.intensity} · ${rateFooter(stats.slope7)}`,
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
