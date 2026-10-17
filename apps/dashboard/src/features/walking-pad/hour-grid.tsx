import { useQuery } from '@tanstack/react-query'
import { ChartCard, Heatmap } from 'basalt-ui/charts'
import { chartStateOf } from '../../lib/chart-state'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { SERIES } from '../../lib/series'
import { useNow } from '../../lib/use-now'
import { walkingStore } from '../../lib/window-stores'
import { busiestCell, fmtKm, firstVisibleHour, shiftCellsToLocal, windowTitle } from './model'

/** Monday first; the API's `dow` is 0 = Sunday. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dayOf = (dow: number): string => DAYS[(dow + 6) % 7] ?? String(dow)
const hourKey = (hour: number): string => `${String(hour).padStart(2, '0')}:00`
const HEIGHT = 140

export function HourGrid({ params }: { params: WalkingPadWindowParams }) {
  const { window: preset } = walkingStore.useValues()
  const now = useNow()
  const query = useQuery(walkingPadQueries.hourOfDay(params))
  // The API buckets by UTC; shift each cell by the browser's current offset so the grid reads in local time.
  const all = shiftCellsToLocal(query.data?.cells ?? [], new Date(now).getTimezoneOffset())
  const first = firstVisibleHour(all)
  const cells = all.filter((c) => c.hour >= first)
  const hours = Array.from({ length: 24 - first }, (_, i) => hourKey(first + i))
  const peak = busiestCell(all)

  return (
    <ChartCard
      title={`Walks by hour, ${windowTitle(preset)}`}
      {...(peak !== null && {
        subtitle: `most walks ${dayOf(peak.dow)} ${hourKey(peak.hour)} local time`,
      })}
      info="Walks per weekday and hour, in your local time. A walk counts in every hour it touched, so a 2-hour walk starting at 14:00 lights 14:00, 15:00 and the part of 16:00 it reached."
      state={chartStateOf(query, undefined)}
      placeholderHeight={HEIGHT}
    >
      <Heatmap
        ariaLabel="Walks by weekday and hour of day in local time"
        data={cells}
        getRow={(c) => dayOf(c.dow)}
        getCol={(c) => hourKey(c.hour)}
        getValue={(c) => c.sessions}
        rows={DAYS}
        cols={hours}
        color={SERIES.walkingDistance}
        formatValue={(v) => `${Math.round(v)}`}
        legend={{ label: 'Walks' }}
        tooltip={{
          rows: (c) => [
            {
              label: 'Distance',
              value: `${fmtKm(c.distance_m)} km`,
              color: SERIES.walkingDistance,
            },
          ],
        }}
        height={HEIGHT}
      />
    </ChartCard>
  )
}
