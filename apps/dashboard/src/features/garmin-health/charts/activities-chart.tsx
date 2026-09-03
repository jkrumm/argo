import { useMemo } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import {
  Bars,
  ChartCard,
  TooltipRow,
  VX,
  type BarsBar,
  type CartesianTooltipRowContext,
} from 'basalt-ui/charts'
import { activitiesQueries } from '../../../lib/queries/daily-metrics'
import { ACTIVITY } from '../../../lib/series'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'
import { applyVisibilityFilter } from '../visibility'

const CHART_HEIGHT = 240
const CHART_ID = 'activities'

/** Floor for the auto y-domain — a 20-minute day still reads against a half-hour axis. */
const AXIS_FLOOR_MIN = 30

type Activity = {
  activity_id: number
  date: string
  start_time_local: string
  type_key: string
  activity_name: string | null
  duration_sec: number | null
  avg_hr: number | null
  max_hr: number | null
  aerobic_te: number | null
  anaerobic_te: number | null
  training_load: number | null
}

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
  hiking: { label: 'Wandern', color: ACTIVITY.hiking },
  surfing_v2: { label: 'Surfen', color: ACTIVITY.surfing },
  surfing: { label: 'Surfen', color: ACTIVITY.surfing },
}

const ACTIVITY_TYPE_OTHER: ActivityTypeMeta = {
  label: 'Other',
  color: ACTIVITY.other,
}

function activityTypeMeta(typeKey: string): ActivityTypeMeta {
  return ACTIVITY_TYPE_META[typeKey] ?? ACTIVITY_TYPE_OTHER
}

function fmtMin(min: number): string {
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

type ActivityDayPoint = {
  date: string
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
    out.push({ date, totals, activities: list })
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

function getDayValue(d: ActivityDayPoint, key: string): number | null {
  const v = d.totals[key]
  return v === undefined || v <= 0 ? null : v
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
    value: fmtMin(dur),
  }
}

export default function ActivitiesChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(
    activitiesQueries.list({
      dateFrom: params.from,
      dateTo: params.to,
      limit: 200,
    }),
  )

  const activities = useMemo(
    () => applyVisibilityFilter(data.data as Activity[], (a) => a.date),
    [data.data],
  )
  const points = useMemo(() => buildPoints(activities), [activities])
  const orderedTypes = useMemo(() => buildOrderedTypes(activities), [activities])

  const totalMin = useMemo(
    () => points.reduce((s, p) => s + Object.values(p.totals).reduce((acc, v) => acc + v, 0), 0),
    [points],
  )
  const activeDays = points.length

  // `tooltip: false` throughout: the tooltip lists the day's individual activities (`extraRows`),
  // so a per-type total would repeat a single-activity day's duration verbatim.
  const positiveBars = useMemo<BarsBar<ActivityDayPoint>[]>(
    () =>
      orderedTypes.map((m) => ({
        key: m.label,
        label: m.label,
        color: m.color,
        tooltip: false,
      })),
    [orderedTypes],
  )

  return (
    <ChartCard
      title="Activities"
      subtitle="What did I do?"
      info={METRIC_TOOLTIPS.activities}
      actions={
        <Text size="sm" c="dimmed">
          {activeDays} active · {fmtMin(totalMin)}
        </Text>
      }
      state={{ empty: points.length === 0 }}
      placeholderHeight={CHART_HEIGHT}
    >
      <Bars
        ariaLabel="Daily activities stacked by type"
        data={points}
        height={CHART_HEIGHT}
        chartId={CHART_ID}
        getX={(d) => d.date}
        getValue={getDayValue}
        positiveBars={positiveBars}
        y={{ autoMaxFloor: AXIS_FLOOR_MIN, ticks: 4, format: (v) => fmtMin(v) }}
        tooltip={{
          label: (d: ActivityDayPoint) => {
            const total = Object.values(d.totals).reduce((a, b) => a + b, 0)
            return total > 0 ? { text: fmtMin(total), color: VX.axis } : null
          },
          extraRows: (d: ActivityDayPoint, ctx: CartesianTooltipRowContext<ActivityDayPoint>) => (
            <>
              {d.activities
                .filter((a) => !ctx.hidden.has(activityTypeMeta(a.type_key).label))
                .map((a) => {
                  const row = activityRowProps(a)
                  return (
                    <TooltipRow
                      key={a.activity_id}
                      color={row.color}
                      shape="bar"
                      label={row.label}
                      value={row.value}
                    />
                  )
                })}
            </>
          ),
        }}
      />
    </ChartCard>
  )
}
