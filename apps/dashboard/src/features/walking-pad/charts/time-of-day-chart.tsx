import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import { ChartCard, Heatmap } from 'basalt-ui/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { SERIES } from '../../../lib/series'
import { chartStateOf } from '../../../lib/chart-state'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Treadmill is never used between midnight and 06:00 — hide that quarter of the chart so the
// visible window (06:00–23:00) has room to breathe.
const MIN_HOUR = 6
const MAX_HOUR = 24

type Cell = { hour: number; dow: number; sessions: number; distance_m: number }

const hourKey = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const HOURS = Array.from({ length: MAX_HOUR - MIN_HOUR }, (_, i) => hourKey(MIN_HOUR + i))

// Chrome eaten by ChartCard around the heatmap when `matchHeight` is set: ~44px header
// (title+subtitle row + 1px border) + 16px body vertical padding + ~22px footer line. Subtracted
// from the matched height so the heatmap fills the remainder; floored at the original 240 so a
// short history card doesn't squish it.
const CARD_CHROME = 82
const DEFAULT_HEIGHT = 240

export function TimeOfDayChart({
  params,
  matchHeight,
}: {
  params: WalkingPadWindowParams
  matchHeight?: number | undefined
}) {
  const query = useQuery(walkingPadQueries.hourOfDay(params))
  const cells = useMemo<Cell[]>(
    () => (query.data?.cells ?? []).filter((c) => c.hour >= MIN_HOUR && c.hour < MAX_HOUR),
    [query.data],
  )
  // Unique-session count comes from the API; per-cell sessions sum over-counts because a single
  // session contributes to every hour it touched.
  const totalSessions = query.data?.totalSessions ?? 0

  const height =
    matchHeight !== undefined ? Math.max(DEFAULT_HEIGHT, matchHeight - CARD_CHROME) : DEFAULT_HEIGHT

  const busiest = cells.reduce<Cell | null>(
    (best, c) => (best === null || c.sessions > best.sessions ? c : best),
    null,
  )

  return (
    <ChartCard
      title="Time of day"
      subtitle="When do I tend to walk?"
      info="Heatmap of walking activity by day-of-week × hour-of-day (UTC), 06:00–23:59 only — the treadmill is never used overnight. Each session lights up every hour it touched, not just its start hour — so a 2-hour walk starting at 14:00 colours 14:00, 15:00, and the partial overlap at 16:00. Darker cells = more sessions active in that hour. Useful for spotting whether the desk-treadmill habit aligns with your meeting calendar or evening routine."
      actions={
        busiest !== null && busiest.sessions > 0 ? (
          <Text span size="xs" fw={600}>
            Peak: {DAY_LABELS[busiest.dow]} {hourKey(busiest.hour)}
          </Text>
        ) : null
      }
      state={chartStateOf(
        query,
        totalSessions === 0 && 'No walks yet — heatmap unlocks on first session.',
      )}
      placeholderHeight={DEFAULT_HEIGHT}
    >
      <Heatmap
        ariaLabel="Walking sessions by day of week and hour of day"
        data={cells}
        getRow={(c) => DAY_LABELS[c.dow] ?? String(c.dow)}
        getCol={(c) => hourKey(c.hour)}
        getValue={(c) => c.sessions}
        rows={DAY_LABELS}
        cols={HOURS}
        color={SERIES.walkingDistance}
        formatValue={(v) => `${Math.round(v)}`}
        legend={{ label: 'Sessions' }}
        tooltip={{
          rows: (c) => [
            {
              label: 'Distance',
              value: `${(c.distance_m / 1000).toFixed(2)} km`,
              color: SERIES.walkingDistance,
            },
          ],
        }}
        height={height}
      />
      <Text size="xs" c="dimmed" mt={4}>
        {hourKey(MIN_HOUR)}–{String(MAX_HOUR - 1).padStart(2, '0')}:59 UTC · {totalSessions} session
        {totalSessions === 1 ? '' : 's'} in window · each session lights every hour it touched
      </Text>
    </ChartCard>
  )
}
