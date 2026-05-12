import { useMemo, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Text } from '@mantine/core'
import { Bars, ChartCard, ChartLegend, VX, useVxTheme, type LegendEntry } from '@argo/charts'
import { activitiesQueries } from '../../../lib/queries/daily-metrics'
import { METRIC_TOOLTIPS } from '../constants'
import type { SummaryParams } from '../types'

const CHART_HEIGHT = 240
const CHART_ID = 'activities'

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
  indoor_cardio: { label: 'Gym', color: VX.series.activity.gym },
  strength_training: { label: 'Gym', color: VX.series.activity.gym },
  cycling: { label: 'Cycling', color: VX.series.activity.cycling },
  road_biking: { label: 'Cycling', color: VX.series.activity.cycling },
  mountain_biking: { label: 'MTB', color: VX.series.activity.cycling },
  indoor_cycling: { label: 'Indoor Bike', color: VX.series.activity.cycling },
  tennis_v2: { label: 'Tennis', color: VX.series.activity.tennis },
  tennis: { label: 'Tennis', color: VX.series.activity.tennis },
  running: { label: 'Running', color: VX.series.activity.running },
  trail_running: { label: 'Trail Run', color: VX.series.activity.running },
  treadmill_running: { label: 'Treadmill', color: VX.series.activity.running },
}

const ACTIVITY_TYPE_OTHER: ActivityTypeMeta = {
  label: 'Other',
  color: VX.series.activity.other,
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

function ActivityTooltipRow({
  activity,
  isFirst,
  tooltipMuted,
}: {
  activity: Activity
  isFirst: boolean
  tooltipMuted: string
}) {
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

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '4px 10px',
        borderTop: isFirst ? '1px solid rgba(128,128,128,0.2)' : '1px solid rgba(128,128,128,0.15)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          backgroundColor: meta.color,
          marginTop: 5,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontWeight: 500 }}>
            {meta.label}
            {showDistinctName ? (
              <span style={{ fontWeight: 400, opacity: 0.7 }}> · {activity.activity_name}</span>
            ) : null}
          </span>
          <span>{fmtMin(dur)}</span>
        </div>
        <div style={{ fontSize: 10.5, color: tooltipMuted, marginTop: 2 }}>
          {[hrText, teText, loadText].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
    </div>
  )
}

export default function ActivitiesChart({ params }: { params: SummaryParams }) {
  const { data } = useSuspenseQuery(
    activitiesQueries.list({
      date_from: params.from,
      date_to: params.to,
      limit: 200,
    }),
  )
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { tooltipMuted, axis } = useVxTheme()
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const activities = data.data as Activity[]
  const points = useMemo(() => buildPoints(activities), [activities])
  const orderedTypes = useMemo(() => buildOrderedTypes(activities), [activities])

  const totalMin = useMemo(
    () => points.reduce((s, p) => s + Object.values(p.totals).reduce((acc, v) => acc + v, 0), 0),
    [points],
  )
  const activeDays = points.length

  const positiveBars = useMemo(
    () =>
      orderedTypes.map((m) => ({
        key: m.label,
        label: m.label,
        color: m.color,
      })),
    [orderedTypes],
  )

  const legendItems: LegendEntry[] = useMemo(
    () =>
      orderedTypes.map((m) => ({
        key: m.label,
        label: m.label,
        color: m.color,
        shape: 'bar' as const,
      })),
    [orderedTypes],
  )

  return (
    <ChartCard
      title="Activities"
      subtitle="What did I do?"
      tooltip={METRIC_TOOLTIPS.activities}
      extra={
        <Text size="sm" c="dimmed">
          {activeDays} active · {fmtMin(totalMin)}
        </Text>
      }
    >
      <div ref={ref} style={{ height: CHART_HEIGHT, width: '100%' }}>
        {width > 0 && points.length > 0 && (
          <Bars<ActivityDayPoint>
            data={points}
            width={Math.max(width, 200)}
            height={CHART_HEIGHT}
            chartId={CHART_ID}
            getX={(d) => d.date}
            getValue={getDayValue}
            positiveBars={positiveBars}
            leftAxis={{
              domain: 'auto',
              autoMaxFloor: 30,
              numTicks: 4,
              formatTick: (v) => fmtMin(v),
            }}
            tooltipLabel={(d) => {
              const total = Object.values(d.totals).reduce((a, b) => a + b, 0)
              return total > 0 ? { text: fmtMin(total), color: axis } : null
            }}
            hideBarTooltipRows
            renderExtraTooltipRows={(d) => (
              <>
                {d.activities.map((a, idx) => (
                  <ActivityTooltipRow
                    key={a.activity_id}
                    activity={a}
                    isFirst={idx === 0}
                    tooltipMuted={tooltipMuted}
                  />
                ))}
              </>
            )}
            highlightedKey={highlighted}
          />
        )}
      </div>
      {legendItems.length > 0 && (
        <ChartLegend items={legendItems} highlighted={highlighted} onHighlight={setHighlighted} />
      )}
    </ChartCard>
  )
}
