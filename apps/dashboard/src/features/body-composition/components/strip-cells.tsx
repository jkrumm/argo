/**
 * The three cells of the body-composition strip. Each takes already-fetched data and renders one
 * question: where is the weight against the goal, how fast is it moving, how thick are the folds.
 */
import { Badge, Box } from '@mantine/core'
import { DeltaBadge, Meter } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { format } from 'date-fns'
import { SERIES } from '../../../lib/series'
import { skinfoldDirectionLabel } from '../formulas'
import {
  deltaFromMean,
  fixed,
  goalProgress,
  intensityBand,
  RATE_NEUTRAL_KG_WK,
  RATE_SCALE_KG_WK,
  signed,
  weightDeltaPolarity,
  type SiteRow,
} from '../model'
import { localDay } from '../charts/series-data'
import type { SkinfoldSummary, WeightSummary, WeightWindowStats } from '../types'
import { GoalPopover } from './goal-popover'
import { SiteLine, StripCell } from './body-strip'

const MUTED_FILL = alpha(VX.muted, 0.35)

const SITE_COLORS = {
  abdominal: SERIES.skinfoldAbdominal,
  suprailiac: SERIES.skinfoldSuprailiac,
} as const

const dateLabel = (key: string | null): string | undefined =>
  key === null ? undefined : format(localDay(key), 'd MMM')

export function WeightCell({
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
}) {
  const delta = deltaFromMean(summary.current, stats.mean30)
  const progress = goalProgress({ start: startWeight, current: summary.current, goal })
  const latest = dateLabel(latestDate)

  return (
    <StripCell
      shot="strip-weight"
      caption="Weight"
      {...(latest !== undefined && { qualifier: `latest ${latest}` })}
      value={fixed(summary.current)}
      unit="kg"
      heroExtra={
        delta === null ? null : (
          <DeltaBadge
            value={delta}
            polarity={weightDeltaPolarity(summary.current, goal)}
            format={(v) => `${Math.abs(v).toFixed(1)} kg`}
            period="vs 30 d mean"
          />
        )
      }
      footer={
        <>
          <span>
            7 d mean {fixed(stats.mean7)} kg · 30 d mean {fixed(stats.mean30)} kg
          </span>
          {goal === null && <GoalPopover lastWeight={summary.current} />}
        </>
      }
    >
      {progress !== null && goal !== null && startWeight !== null && (
        <Meter
          label="Progress from the first weight in the window to the goal weight"
          value={progress.moved}
          min={0}
          max={progress.span}
          target={progress.span}
          format={(v) => `${v.toFixed(1)} kg`}
          startCaption={`start ${fixed(startWeight)} kg${startDate === null ? '' : ` \u00b7 ${dateLabel(startDate)}`}`}
          endCaption={`${fixed(goal)} kg goal`}
          color={MUTED_FILL}
        />
      )}
    </StripCell>
  )
}

export function RateCell({
  summary,
  stats,
  latestDate,
}: {
  summary: WeightSummary
  stats: WeightWindowStats
  latestDate: string | null
}) {
  const rate = summary.kgPerWeek
  const band = intensityBand(rate)
  return (
    <StripCell
      shot="strip-rate"
      caption="Rate"
      qualifier={`28 d slope to ${dateLabel(latestDate) ?? 'latest entry'}`}
      value={signed(rate, 2)}
      unit="kg/wk"
      heroExtra={
        rate === null ? null : (
          <Badge size="sm" variant="light" color="gray">
            {summary.intensity}
          </Badge>
        )
      }
      footer={
        <span>
          {signed(stats.slope7, 2)} kg/wk over 7 d · {signed(stats.slope30, 2)} kg/wk over 30 d
        </span>
      }
    >
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
    </StripCell>
  )
}

export function SkinfoldCell({
  summary,
  rows,
  latestDate,
}: {
  summary: SkinfoldSummary
  rows: SiteRow[]
  latestDate: string | null
}) {
  const latest = dateLabel(latestDate)
  return (
    <StripCell
      shot="strip-skinfold"
      caption="Skinfold"
      {...(latest !== undefined && { qualifier: `latest session ${latest}` })}
      value={fixed(summary.current)}
      unit="mm session average"
      footer={
        <span>
          {skinfoldDirectionLabel(summary.direction)} · {signed(summary.mmPerWeek, 2)} mm/wk over 28
          d
        </span>
      }
    >
      <Box>
        {rows.map((row) => (
          <SiteLine
            key={row.site}
            label={row.label}
            value={row.current === null ? '—' : `${row.current.toFixed(1)} mm`}
            sparkline={
              row.values.length >= 2 ? (
                <Sparkline
                  ariaLabel={`${row.label} skinfold readings per session`}
                  data={row.values}
                  height={24}
                  color={SITE_COLORS[row.site]}
                  emphasizeLast
                />
              ) : null
            }
            delta={
              row.delta === null ? null : (
                <DeltaBadge
                  value={row.delta}
                  polarity="up-bad"
                  format={(v) => `${Math.abs(v).toFixed(1)} mm`}
                  period={row.priorDate === null ? 'vs prior' : `vs ${dateLabel(row.priorDate)}`}
                />
              )
            }
          />
        ))}
      </Box>
    </StripCell>
  )
}
