import { useQuery } from '@tanstack/react-query'
import { ChartCard, Heatmap } from 'basalt-ui/charts'
import { chartStateOf } from '../../lib/chart-state'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { VX } from 'basalt-ui/tokens'
import { useNow } from '../../lib/use-now'
import { walkingStore } from '../../lib/window-stores'
import {
  busiestCell,
  fmtKm,
  firstVisibleHour,
  offsetLabel,
  shiftCellsToLocal,
  windowTitle,
} from './model'
import { Facts } from './facts'

/** Monday first; the API's `dow` is 0 = Sunday. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dayOf = (dow: number): string => DAYS[(dow + 6) % 7] ?? String(dow)
const hourKey = (hour: number): string => `${String(hour).padStart(2, '0')}:00`
const HEIGHT = 180

export function HourGrid({ params }: { params: WalkingPadWindowParams }) {
  const { window: preset } = walkingStore.useValues()
  const now = useNow()
  const query = useQuery(walkingPadQueries.hourOfDay(params))
  // The API buckets by UTC; shift each cell by the browser's current offset so the grid reads in local time.
  const offset = new Date(now).getTimezoneOffset()
  const all = shiftCellsToLocal(query.data?.cells ?? [], offset)
  const first = firstVisibleHour(all)
  const cells = all.filter((c) => c.hour >= first)
  const hours = Array.from({ length: 24 - first }, (_, i) => hourKey(first + i))
  const peak = busiestCell(all)

  return (
    <ChartCard
      title={`Walks by hour, ${windowTitle(preset)}`}
      state={chartStateOf(query, undefined)}
      placeholderHeight={HEIGHT}
    >
      {peak !== null && (
        <Facts
          value={`${dayOf(peak.dow)} ${hourKey(peak.hour)}`}
          context={`most walks · local time, current ${offsetLabel(offset)} · hours from ${hourKey(first)}`}
        />
      )}
      <Heatmap
        ariaLabel="Walks by weekday and hour of day in local time"
        data={cells}
        getRow={(c) => dayOf(c.dow)}
        getCol={(c) => hourKey(c.hour)}
        getValue={(c) => c.sessions}
        rows={DAYS}
        cols={hours}
        color={VX.muted}
        formatValue={(v) => `${Math.round(v)}`}
        legend={{ label: 'Walks' }}
        tooltip={{
          rows: (c) => [
            { label: 'Walks', value: String(c.sessions), color: VX.muted },
            { label: 'Distance', value: `${fmtKm(c.distance_m)} km`, color: VX.muted },
          ],
        }}
        height={HEIGHT}
      />
    </ChartCard>
  )
}
