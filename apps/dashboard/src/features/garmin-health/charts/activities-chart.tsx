import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bars, ChartCard, type BarsBar } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { activitiesWindowQueries } from '../../../lib/queries/activities'
import { activitiesRange } from '../../../lib/queries/activities-window'
import { ACTIVITY } from '../../../lib/series'
import { activitiesFact, fmtMinutes, windowDayCount } from '../model'
import { VISIBLE_DATE_MIN } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'
import { chartStateOf } from '../../../lib/chart-state'
import { localDay } from './local-day'

const CHART_HEIGHT = 240

/** Floor for the auto y-domain — a 20-minute day still reads against a half-hour axis. */
const AXIS_FLOOR_MIN = 30

type Activity = Awaited<
  ReturnType<NonNullable<ReturnType<typeof activitiesWindowQueries.list>['queryFn']>>
>[number]

type ActivityTypeMeta = { label: string; color: string }

const ACTIVITY_TYPE_META: Record<string, ActivityTypeMeta> = {
  indoor_cardio: { label: 'Gym', color: ACTIVITY.gym },
  strength_training: { label: 'Gym', color: ACTIVITY.gym },
  cycling: { label: 'Cycling', color: ACTIVITY.cycling },
  road_biking: { label: 'Cycling', color: ACTIVITY.cycling },
  mountain_biking: { label: 'MTB', color: ACTIVITY.cycling },
  indoor_cycling: { label: 'Indoor Bike', color: ACTIVITY.cycling },
  tennis_v2: { label: 'Tennis', color: ACTIVITY.tennis },
  tennis: { label: 'Tennis', color: ACTIVITY.tennis },
  running: { label: 'Running', color: ACTIVITY.running },
  trail_running: { label: 'Trail Run', color: ACTIVITY.running },
  treadmill_running: { label: 'Treadmill', color: ACTIVITY.running },
  hiking: { label: 'Hiking', color: ACTIVITY.hiking },
  surfing_v2: { label: 'Surfing', color: ACTIVITY.surfing },
  surfing: { label: 'Surfing', color: ACTIVITY.surfing },
}

const ACTIVITY_TYPE_OTHER: ActivityTypeMeta = {
  label: 'Other',
  color: ACTIVITY.other,
}

function activityTypeMeta(typeKey: string): ActivityTypeMeta {
  return ACTIVITY_TYPE_META[typeKey] ?? ACTIVITY_TYPE_OTHER
}

type ActivityDayPoint = {
  date: string
  day: Date
  /** Per-type minute totals keyed by canonical label (Gym, Cycling, etc.). */
  totals: Record<string, number>
  /** Individual activities for that day, sorted chronologically. */
  activities: Activity[]
}

/**
 * Group activities by local date. Excludes days with zero total duration
 * (rest days are not rendered).
 */
function buildPoints(activities: Activity[]): ActivityDayPoint[] {
  const byDate = new Map<string, Activity[]>()
  for (const a of activities) {
    const list = byDate.get(a.date) ?? []
    list.push(a)
    byDate.set(a.date, list)
  }
  const out: ActivityDayPoint[] = []
  for (const [date, list] of byDate.entries()) {
    list.sort((x, y) => x.start_time_local.localeCompare(y.start_time_local))
    const totals: Record<string, number> = {}
    let sumSec = 0
    for (const a of list) {
      const dur = a.duration_sec ?? 0
      if (dur <= 0) continue
      sumSec += dur
      const meta = activityTypeMeta(a.type_key)
      totals[meta.label] = (totals[meta.label] ?? 0) + dur / 60
    }
    if (sumSec <= 0) continue
    out.push({ date, day: localDay(date), totals, activities: list })
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

/** Distinct (label, color) pairs observed, ordered by total duration desc. */
function buildOrderedTypes(activities: Activity[]): ActivityTypeMeta[] {
  const totals = new Map<string, number>()
  const seen = new Map<string, ActivityTypeMeta>()
  for (const a of activities) {
    const meta = activityTypeMeta(a.type_key)
    const dur = a.duration_sec ?? 0
    totals.set(meta.label, (totals.get(meta.label) ?? 0) + dur)
    if (!seen.has(meta.label)) seen.set(meta.label, meta)
  }
  return [...seen.values()].toSorted(
    (a, b) => (totals.get(b.label) ?? 0) - (totals.get(a.label) ?? 0),
  )
}

function activityRowProps(activity: Activity) {
  const meta = activityTypeMeta(activity.type_key)
  const dur = (activity.duration_sec ?? 0) / 60
  const isGym = meta.label === 'Gym'
  const showDistinctName =
    activity.activity_name &&
    activity.activity_name.toLowerCase() !== meta.label.toLowerCase() &&
    !isGym
  const aero = activity.aerobic_te
  const anaero = activity.anaerobic_te
  const teText =
    aero !== null || anaero !== null
      ? `TE ${aero?.toFixed(1) ?? '—'}/${anaero?.toFixed(1) ?? '—'}`
      : null
  const hrText =
    activity.avg_hr !== null || activity.max_hr !== null
      ? `HR ${activity.avg_hr ?? '—'}/${activity.max_hr ?? '—'}`
      : null
  const loadText =
    activity.training_load !== null ? `Load ${Math.round(activity.training_load)}` : null
  const detail = [hrText, teText, loadText].filter(Boolean).join(' · ')
  const labelBase = showDistinctName ? `${meta.label} · ${activity.activity_name}` : meta.label
  return {
    color: meta.color,
    label: detail ? `${labelBase} (${detail})` : labelBase,
    value: fmtMinutes(dur),
  }
}

export default function ActivitiesChart({ params }: { params: SummaryParams }) {
  const query = useQuery(activitiesWindowQueries.list(params))

  const activities = useMemo(
    () => applyVisibilityFilter(query.data ?? [], (a) => a.date),
    [query.data],
  )
  const points = useMemo(() => buildPoints(activities), [activities])
  const orderedTypes = useMemo(() => buildOrderedTypes(activities), [activities])

  // The window's length in calendar days (not the rows returned), clipped at the visible floor.
  const dayCount = windowDayCount(activitiesRange(params), VISIBLE_DATE_MIN)

  const totalMin = useMemo(
    () => points.reduce((s, p) => s + Object.values(p.totals).reduce((acc, v) => acc + v, 0), 0),
    [points],
  )

  // `tooltip: false` throughout: the tooltip lists the day's individual activities (`rows`),
  // so a per-type total would repeat a single-activity day's duration verbatim.
  const bars = useMemo<BarsBar<ActivityDayPoint>[]>(
    () =>
      orderedTypes.map((m) => ({
        key: m.label,
        label: m.label,
        color: m.color,
        getValue: (d) => {
          const v = d.totals[m.label]
          return v === undefined || v <= 0 ? null : v
        },
        tooltip: false,
      })),
    [orderedTypes],
  )

  return (
    <ChartCard
      title="Activities"
      state={chartStateOf(query, points.length === 0 ? 'No activities in this window' : undefined)}
      placeholderHeight={CHART_HEIGHT}
      facts={toChartFact(activitiesFact({ sessions: activities.length, totalMin, dayCount }))}
    >
      <Bars
        cursorResolution="leading"
        ariaLabel="Daily activities stacked by type"
        data={points}
        height={CHART_HEIGHT}
        x={(d) => d.day}
        bars={bars}
        y={{ autoMaxFloor: AXIS_FLOOR_MIN, ticks: 4, format: (v) => fmtMinutes(v) }}
        tooltip={{
          rows: (d, ctx) => {
            const hidden = new Set(ctx.hidden.map((s) => s.key))
            const total = Object.values(d.totals).reduce((a, b) => a + b, 0)
            return [
              { label: 'Total', value: fmtMinutes(total), color: VX.axis },
              ...d.activities
                .filter((a) => !hidden.has(activityTypeMeta(a.type_key).label))
                .map(activityRowProps),
            ]
          },
        }}
      />
    </ChartCard>
  )
}
