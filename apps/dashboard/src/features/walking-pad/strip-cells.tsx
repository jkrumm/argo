import { useQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { DeltaBadge, Meter } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { useNow } from '../../lib/use-now'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { walkingStore } from '../../lib/window-stores'
import { walkingLocal } from './local-store'
import {
  fmtDuration,
  fmtKm,
  fmtKmh,
  fmtKmAbs,
  fmtKmhAbs,
  overallKmh,
  paceValues,
  priorLabel,
  weekSummary,
  weekTicks,
  windowQualifier,
} from './model'
import { TargetPopover } from './target-popover'
import { Strip, StripCell } from './strip'
import { WEEK_DAYS_SERIES } from './week-queries'
import classes from './strip.module.css'

const EM_DASH = '—'
/** A reading that is not a verdict: `Meter`'s neutral fill is near-white in dark mode. */
const MUTED_FILL = alpha(VX.muted, 0.35)
/** The meter's track runs past the target so an overrun stays visible; the tick marks the target. */
const TARGET_HEADROOM = 1.25

function WeekCell() {
  const now = useNow()
  const query = useQuery(WEEK_DAYS_SERIES)
  const [targetKm] = walkingLocal.field.weeklyTargetKm.use()
  const isDefault = walkingLocal.field.weeklyTargetKm.isDefault(targetKm)
  const week = query.data === undefined ? null : weekSummary(query.data.points, now)
  const km = week === null ? null : week.distanceM / 1000
  return (
    <StripCell
      shot="strip-week"
      caption="This week"
      qualifier="Mon–Sun, UTC"
      action={<TargetPopover />}
      value={week === null ? EM_DASH : fmtKm(week.distanceM)}
      unit="km"
      loading={query.isPending}
      {...(week?.deltaM != null && {
        delta: (
          <DeltaBadge
            value={week.deltaM}
            format={fmtKmAbs}
            polarity="up-good"
            period={`vs last week to ${week.weekday}`}
          />
        ),
      })}
      footer={
        week === null
          ? 'this week not reported'
          : `${week.sessions} ${week.sessions === 1 ? 'walk' : 'walks'} · ${Math.round(((km ?? 0) / targetKm) * 100)} % of target`
      }
    >
      <Meter
        label="Distance this week against the weekly target"
        value={km}
        min={0}
        max={Math.max(targetKm * TARGET_HEADROOM, km ?? 0)}
        target={targetKm}
        format={(v) => `${v.toFixed(1)} km`}
        startCaption="so far"
        endCaption={`${isDefault ? 'default' : 'target'} ${targetKm} km`}
        color={MUTED_FILL}
        loading={query.isPending}
        emptyText="No data this week"
      />
    </StripCell>
  )
}

function PaceCell({ params }: { params: WalkingPadWindowParams }) {
  const { window: preset } = walkingStore.useValues()
  const heroes = useQuery(walkingPadQueries.heroes(params))
  const series = useQuery(walkingPadQueries.series({ ...params, bucket: 'week' }))
  const pace = heroes.data?.pace
  const values = series.data === undefined ? [] : paceValues(series.data.points)
  return (
    <StripCell
      shot="strip-pace"
      caption="Pace"
      qualifier={`avg ${windowQualifier(preset)}`}
      value={fmtKmh(pace?.currentAvgKmh ?? null)}
      {...(pace?.currentAvgKmh != null && { unit: 'km/h' })}
      loading={heroes.isPending}
      {...(pace?.deltaKmh != null && {
        delta: (
          <DeltaBadge
            value={pace.deltaKmh}
            format={fmtKmhAbs}
            polarity="up-good"
            period={`vs ${priorLabel(preset)}`}
          />
        ),
      })}
      footer={
        values.length < 2
          ? 'distance-weighted mean of walk speeds'
          : `distance-weighted mean of walk speeds · ${values.length} walked weeks`
      }
    >
      {values.length >= 2 && (
        <Sparkline
          ariaLabel="Weekly average pace in km/h over the window"
          data={values}
          height={32}
          emphasizeLast
        />
      )}
    </StripCell>
  )
}

function StreakCell({ params }: { params: WalkingPadWindowParams }) {
  const now = useNow()
  const heroes = useQuery(walkingPadQueries.heroes(params))
  const days = useQuery(WEEK_DAYS_SERIES)
  const streak = heroes.data?.streak
  const ticks = weekTicks(days.data?.points ?? [], now)
  return (
    <StripCell
      shot="strip-streak"
      caption="Streak"
      {...(streak !== undefined && { qualifier: `best ${streak.bestDays} d` })}
      value={streak === undefined ? EM_DASH : String(streak.currentDays)}
      unit={streak?.currentDays === 1 ? 'day' : 'days'}
      loading={heroes.isPending}
      footer={`${ticks.filter((t) => t.state === 'walked').length} walked this week · UTC days`}
    >
      <Box
        className={classes.days}
        role="list"
        aria-label="Days walked this week, Monday to Sunday"
      >
        {ticks.map((t) => (
          <Box key={t.key} className={classes.day} role="listitem">
            <Box
              className={[
                classes.tick,
                t.state === 'walked' ? classes.walked : '',
                t.state === 'upcoming' ? classes.upcoming : '',
                t.today ? classes.today : '',
              ].join(' ')}
              aria-label={`${t.label}: ${t.state === 'walked' ? 'walked' : t.state === 'rest' ? 'no walk' : 'upcoming'}${t.today ? ', today' : ''}`}
            />
            <span>{t.label}</span>
          </Box>
        ))}
      </Box>
    </StripCell>
  )
}

function TotalsCell({ params }: { params: WalkingPadWindowParams }) {
  const { window: preset } = walkingStore.useValues()
  const query = useQuery(walkingPadQueries.summary(params))
  const s = query.data
  const walks = s?.sessions ?? 0
  const avgKm = s === undefined || walks === 0 ? null : s.distance_m / walks
  const rows =
    s === undefined
      ? []
      : [
          {
            label: 'Walks',
            value: String(walks),
            context: avgKm === null ? undefined : `avg ${fmtKm(avgKm)} km`,
          },
          {
            label: 'Time',
            value: fmtDuration(s.duration_s),
            context:
              s.avg_session_min === null ? undefined : `avg ${fmtDuration(s.avg_session_min * 60)}`,
          },
          {
            label: 'Pace',
            value: `${fmtKmh(overallKmh(s.distance_m, s.duration_s))} km/h`,
            context: 'distance ÷ time',
          },
          {
            label: 'Energy',
            value: `${Math.round(s.kcal).toLocaleString('en-GB')} kcal`,
            context: `${s.steps.toLocaleString('en-GB')} steps`,
          },
        ]
  return (
    <StripCell
      shot="strip-totals"
      caption="Totals"
      qualifier={windowQualifier(preset)}
      value={s === undefined ? EM_DASH : fmtKm(s.distance_m)}
      unit="km"
      loading={query.isPending}
    >
      <Box className={classes.rows}>
        {rows.map((r) => (
          <Box key={r.label} className={classes.row}>
            <span className={classes.rowLabel}>{r.label}</span>
            <span className={classes.rowValue}>{r.value}</span>
            {r.context !== undefined && <span className={classes.rowContext}>{r.context}</span>}
          </Box>
        ))}
      </Box>
    </StripCell>
  )
}

export function WalkingStrip({ params }: { params: WalkingPadWindowParams }) {
  return (
    <Strip>
      <WeekCell />
      <PaceCell params={params} />
      <StreakCell params={params} />
      <TotalsCell params={params} />
    </Strip>
  )
}
