import { useQuery } from '@tanstack/react-query'
import { ViewTabs } from 'basalt-ui/controls'
import { Bars, ChartCard, Lines } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../lib/chart-state'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { SERIES } from '../../lib/series'
import { walkingStore } from '../../lib/window-stores'
import { useNow } from '../../lib/use-now'
import { walkingLocal } from './local-store'
import {
  DAY_VIEW_MAX,
  fmtKm,
  fmtKmh,
  mondayKey,
  trimLeadingEmpty,
  windowTitle,
  type SeriesPoint,
} from './model'

const HEIGHT = { base: 200, regular: 240 } as const
const utcDay = (key: string): Date => new Date(`${key}T00:00:00Z`)
const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const kmAxis = (v: number) => String(Number(v.toFixed(1)))

type Point = SeriesPoint & { at: Date; km: number }
const toPoint = (p: SeriesPoint): Point => ({ ...p, at: utcDay(p.date), km: p.distance_m / 1000 })

/** The page's main chart: weekly distance against the target; days and weekly pace behind tabs. */
export function WeekChart({ params }: { params: WalkingPadWindowParams }) {
  const { window: preset } = walkingStore.useValues()
  const [view] = walkingLocal.field.view.use()
  const [targetKm] = walkingLocal.field.weeklyTargetKm.use()
  const isDefault = walkingLocal.field.weeklyTargetKm.isDefault(targetKm)
  const heroes = useQuery(walkingPadQueries.heroes(params))
  const weekly = useQuery(walkingPadQueries.series({ ...params, bucket: 'week' }))
  const daily = useQuery({
    ...walkingPadQueries.series({ ...params, bucket: 'day' }),
    enabled: view === 'days',
  })
  const now = useNow()
  const thisMonday = mondayKey(now)
  const query = view === 'days' ? daily : weekly
  const when = windowTitle(preset)

  const weeks = trimLeadingEmpty(weekly.data?.points ?? []).map(toPoint)
  const days = trimLeadingEmpty(daily.data?.points ?? [])
    .map(toPoint)
    .slice(-DAY_VIEW_MAX)
  const dayMeanKm = days.length === 0 ? null : days.reduce((s, d) => s + d.km, 0) / days.length

  const title =
    view === 'days'
      ? `Daily distance, ${days.length < (daily.data?.points.length ?? 0) || days.length === DAY_VIEW_MAX ? `last ${days.length} days` : when}`
      : view === 'pace'
        ? `Weekly pace, ${when}`
        : `Weekly distance, ${when}`
  const paceAvg = heroes.data?.pace.currentAvgKmh ?? null
  const facts =
    view === 'days'
      ? dayMeanKm === null
        ? undefined
        : { value: dayMeanKm.toFixed(1), unit: 'km/day', period: `mean over ${days.length} days` }
      : view === 'pace'
        ? paceAvg === null
          ? undefined
          : { value: fmtKmh(paceAvg), unit: 'km/h', period: 'window average, weekly points' }
        : {
            value: String(targetKm),
            unit: 'km',
            period: `${isDefault ? 'default weekly target' : 'weekly target'}, bars are km per week`,
          }
  const targetLabel = `${isDefault ? 'default weekly target' : 'weekly target'} ${targetKm} km`

  return (
    <ChartCard
      title={title}
      actions={<ViewTabs field={walkingLocal.field.view} label="Chart view" />}
      state={chartStateOf(query, undefined)}
      placeholderHeight={240}
      facts={facts}
    >
      {view === 'weeks' && (
        <Bars
          ariaLabel="Weekly distance in kilometres against the weekly target"
          data={weeks}
          height={HEIGHT}
          x={(d) => d.at}
          formatX={(x) => dayFormat.format(x)}
          cursorResolution="leading"
          bars={[
            {
              key: 'past',
              label: 'Distance',
              color: alpha(VX.muted, 0.55),
              getValue: (d) => (d.date !== thisMonday && d.km > 0 ? d.km : null),
              formatValue: (v) => `${v.toFixed(1)} km`,
            },
            {
              key: 'current',
              label: 'This week so far',
              color: SERIES.walkingDistance,
              getValue: (d) => (d.date === thisMonday && d.km > 0 ? d.km : null),
              formatValue: (v) => `${v.toFixed(1)} km`,
            },
          ]}
          y={{ domain: 'auto', autoMaxFloor: targetKm * 1.2, format: kmAxis, ticks: 4, nice: true }}
          refLines={[{ value: targetKm, color: VX.muted, dashed: true, label: targetLabel }]}
          legend={false}
          tooltip={{
            formatHeader: (_x, d) =>
              `Week of ${dayFormat.format(d.at)} · ${d.sessions} ${d.sessions === 1 ? 'walk' : 'walks'}`,
          }}
        />
      )}
      {view === 'days' && (
        <Bars
          ariaLabel="Daily distance in kilometres with the daily mean"
          data={days}
          height={HEIGHT}
          x={(d) => d.at}
          formatX={(x) => dayFormat.format(x)}
          bars={[
            {
              key: 'day',
              label: 'Distance',
              color: alpha(VX.muted, 0.55),
              getValue: (d) => (d.km > 0 ? d.km : null),
              formatValue: (v) => `${v.toFixed(1)} km`,
            },
          ]}
          y={{ domain: 'auto', autoMaxFloor: 2, format: kmAxis, ticks: 4, nice: true }}
          {...(dayMeanKm !== null && {
            refLines: [{ value: dayMeanKm, color: VX.muted, dashed: true, label: 'mean' }],
          })}
          legend={false}
          tooltip={{
            formatHeader: (_x, d) => `${dayFormat.format(d.at)} · ${fmtKm(d.distance_m)} km`,
          }}
        />
      )}
      {view === 'pace' && (
        <Lines
          ariaLabel="Weekly average pace in km/h"
          data={weeks}
          height={HEIGHT}
          x={(d) => d.at}
          formatX={(x) => dayFormat.format(x)}
          cursorResolution="leading"
          series={[
            {
              key: 'pace',
              label: 'Avg pace',
              color: SERIES.walkingPace,
              getValue: (d) => d.avg_speed_kmh,
              formatValue: (v) => `${v.toFixed(1)} km/h`,
            },
          ]}
          y={{
            domain: 'auto',
            autoMaxFloor: 6,
            autoMinCeil: 1,
            nice: true,
            format: (v) => `${v} km/h`,
          }}
          {...(heroes.data?.pace.currentAvgKmh != null && {
            refLines: [
              {
                value: heroes.data.pace.currentAvgKmh,
                color: VX.muted,
                dashed: true,
                label: 'avg',
              },
            ],
          })}
          legend={false}
        />
      )}
    </ChartCard>
  )
}
