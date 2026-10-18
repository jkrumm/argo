import { useQuery } from '@tanstack/react-query'
import { Box } from '@mantine/core'
import { DeltaBadge, Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { Sparkline } from 'basalt-ui/charts'
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
  NBSP,
  withKm,
  withKmh,
  withSteps,
  windowQualifier,
} from './model'
import { TargetPopover } from './target-popover'
import { weekDaysSeries } from './week-queries'
import classes from './strip.module.css'

/** The meter's track runs past the target so an overrun stays visible; the tick marks the target. */
const TARGET_HEADROOM = 1.25

// `StatStripRow` has no context column, so each row's context rides its value.
const withContext = (value: string, context: string | undefined) =>
  context === undefined ? value : `${value} · ${context}`

function useWeekCell(): StatStripCell {
  const now = useNow()
  const query = useQuery(weekDaysSeries(now))
  const [targetKm] = walkingLocal.field.weeklyTargetKm.use()
  const isDefault = walkingLocal.field.weeklyTargetKm.isDefault(targetKm)
  const week = query.data === undefined ? null : weekSummary(query.data.points, now)
  const km = week === null ? null : week.distanceM / 1000
  return {
    key: 'week',
    caption: 'This week',
    qualifier: 'Mon–Sun, UTC',
    value: week === null ? null : fmtKm(week.distanceM),
    unit: 'km',
    loading: query.isPending,
    ...(week?.deltaM != null && {
      delta: (
        <DeltaBadge
          value={week.deltaM}
          format={fmtKmAbs}
          polarity="up-good"
          period={`last week to ${week.weekday}`}
        />
      ),
    }),
    visual: (
      <Meter
        label="Distance this week against the weekly target"
        value={km}
        min={0}
        max={Math.max(targetKm * TARGET_HEADROOM, km ?? 0)}
        target={targetKm}
        format={(v) => `${v.toFixed(1)}${NBSP}km`}
        startCaption="so far"
        endCaption={`${isDefault ? 'default' : 'target'} ${targetKm}${NBSP}km`}
        tone="muted"
        loading={query.isPending}
        emptyText="No data this week"
      />
    ),
    // `StatStripCell` has no caption-line action slot, so the target control rides the footer.
    footer: (
      <>
        {query.isPending
          ? null
          : week === null
            ? 'this week not reported'
            : `${week.sessions} ${week.sessions === 1 ? 'walk' : 'walks'} · ${Math.round(((km ?? 0) / targetKm) * 100)} % of target`}
        <TargetPopover />
      </>
    ),
  }
}

function usePaceCell(params: WalkingPadWindowParams): StatStripCell {
  const { window: preset } = walkingStore.useValues()
  const heroes = useQuery(walkingPadQueries.heroes(params))
  const series = useQuery(walkingPadQueries.series({ ...params, bucket: 'week' }))
  const pace = heroes.data?.pace
  const values = series.data === undefined ? [] : paceValues(series.data.points)
  return {
    key: 'pace',
    caption: 'Pace',
    qualifier: `avg ${windowQualifier(preset)}`,
    value: pace?.currentAvgKmh == null ? null : fmtKmh(pace.currentAvgKmh),
    ...(pace?.currentAvgKmh != null && { unit: 'km/h' }),
    loading: heroes.isPending || series.isPending,
    ...(pace?.deltaKmh != null && {
      delta: (
        <DeltaBadge
          value={pace.deltaKmh}
          format={fmtKmhAbs}
          polarity="up-good"
          period={priorLabel(preset)}
        />
      ),
    }),
    ...(values.length >= 2 && {
      visual: (
        <Sparkline
          ariaLabel="Weekly average pace in km/h over the window"
          data={values}
          height={32}
          emphasizeLast
        />
      ),
    }),
    footer: heroes.isPending
      ? null
      : values.length < 2
        ? 'distance-weighted mean of walk speeds'
        : `distance-weighted mean of walk speeds · ${values.length} walked weeks`,
  }
}

function useStreakCell(params: WalkingPadWindowParams): StatStripCell {
  const now = useNow()
  const heroes = useQuery(walkingPadQueries.heroes(params))
  const days = useQuery(weekDaysSeries(now))
  const streak = heroes.data?.streak
  const ticks = weekTicks(days.data?.points ?? [], now)
  return {
    key: 'streak',
    caption: 'Streak',
    ...(streak !== undefined && { qualifier: `best ${streak.bestDays} d` }),
    value: streak === undefined ? null : String(streak.currentDays),
    unit: streak?.currentDays === 1 ? 'day' : 'days',
    loading: heroes.isPending || days.isPending,
    visual: (
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
    ),
    footer:
      heroes.isPending || days.isPending
        ? null
        : `${ticks.filter((t) => t.state === 'walked').length} walked this week · UTC days`,
  }
}

function useTotalsCell(params: WalkingPadWindowParams): StatStripCell {
  const { window: preset } = walkingStore.useValues()
  const query = useQuery(walkingPadQueries.summary(params))
  const s = query.data
  const walks = s?.sessions ?? 0
  const avgKm = s === undefined || walks === 0 ? null : s.distance_m / walks
  return {
    key: 'totals',
    caption: 'Totals',
    qualifier: windowQualifier(preset),
    value: s === undefined ? null : fmtKm(s.distance_m),
    unit: 'km',
    loading: query.isPending,
    ...(s !== undefined && {
      rows: [
        {
          key: 'walks',
          label: 'Walks',
          value: withContext(
            String(walks),
            avgKm === null ? undefined : `avg ${withKm(avgKm * 1000)}`,
          ),
        },
        {
          key: 'time',
          label: 'Time',
          value: withContext(
            fmtDuration(s.duration_s),
            s.avg_session_min === null ? undefined : `avg ${fmtDuration(s.avg_session_min * 60)}`,
          ),
        },
        {
          key: 'pace',
          label: 'Pace',
          value: withContext(withKmh(overallKmh(s.distance_m, s.duration_s)), 'distance ÷ time'),
        },
        {
          key: 'energy',
          label: 'Energy',
          value: withContext(
            `${Math.round(s.kcal).toLocaleString('en-GB')}${NBSP}kcal`,
            withSteps(s.steps),
          ),
        },
      ],
    }),
  }
}

/** The strip of a window with no walks: the same four cells, dimmed, every value `—`. */
function EmptyStrip() {
  const { window: preset } = walkingStore.useValues()
  const cells: StatStripCell[] = [
    { key: 'week', caption: 'This week', qualifier: 'Mon–Sun, UTC', value: null, unit: 'km' },
    { key: 'pace', caption: 'Pace', qualifier: `avg ${windowQualifier(preset)}`, value: null },
    { key: 'streak', caption: 'Streak', value: null, unit: 'days' },
    {
      key: 'totals',
      caption: 'Totals',
      qualifier: windowQualifier(preset),
      value: null,
      unit: 'km',
    },
  ].map((c) => ({ ...c, stale: true }))
  return <StatGroup variant="strip" label="Walking at a glance, no walks" cols={4} cells={cells} />
}

export function WalkingStrip({
  params,
  empty = false,
}: {
  params: WalkingPadWindowParams
  empty?: boolean
}) {
  return empty ? <EmptyStrip /> : <LiveStrip params={params} />
}

function LiveStrip({ params }: { params: WalkingPadWindowParams }) {
  const week = useWeekCell()
  const pace = usePaceCell(params)
  const streak = useStreakCell(params)
  const totals = useTotalsCell(params)
  return (
    <StatGroup
      variant="strip"
      label="Walking at a glance"
      cols={4}
      cells={[week, pace, streak, totals]}
    />
  )
}
