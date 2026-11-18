import { useQuery } from '@tanstack/react-query'
import { Group, Text } from '@mantine/core'
import { StatusDot } from 'basalt-ui'
import { ChartCard, Lines, type ChartSeries } from 'basalt-ui/charts'
import { chartStateOf } from '../../../lib/chart-state'
import { lineQueries, type LineSpeedtests } from '../../../lib/queries/line'
import { SERIES } from '../../../lib/series'
import { lineStore } from '../../../lib/window-stores'
import { WINDOW_NOUN, formatMbit, median } from '../model'
import { outageBands, timeAxis } from './shared'

type Point = LineSpeedtests['runs'][number] & { x: number }

const HEIGHT = 96
/** The neighbouring cards carry a legend row above their chart; the speed card's legend sits in its header, so its chart takes that row. */
const LEGEND_ROW = 26

/** A run is a point, not a joined line: a speed test is a sample, and a line would invent the hours between. */
const DOT = () => ({ r: 2 })

const SERIES_DEF: readonly ChartSeries<Point>[] = [
  {
    key: 'down',
    label: 'Download',
    color: SERIES.lineDown,
    getValue: (d) => d.downloadMbit,
    formatValue: (v) => `${formatMbit(v)} Mbit/s`,
    strokeOpacity: 0,
    getMarker: DOT,
  },
  {
    key: 'up',
    label: 'Upload',
    color: SERIES.lineUp,
    getValue: (d) => d.uploadMbit,
    formatValue: (v) => `${formatMbit(v)} Mbit/s`,
    strokeOpacity: 0,
    getMarker: DOT,
  },
]

/** Hourly speed tests as points on the page's time axis, with the median download as the fact. */
export function SpeedChart() {
  const { window } = lineStore.useValues()
  const speed = useQuery(lineQueries.speedtests(window))
  const uptime = useQuery(lineQueries.uptime(window))
  const points: Point[] = (speed.data?.runs ?? []).map((r) => ({ ...r, x: r.t * 1000 }))
  const downloads = points.flatMap((p) => (p.downloadMbit === null ? [] : [p.downloadMbit]))
  const axis = timeAxis(speed.data, window)
  const empty = speed.isSuccess && points.length === 0 ? 'No speed tests in this window' : undefined

  return (
    <ChartCard
      title="Speed tests"
      actions={
        <Group gap="sm">
          {SERIES_DEF.map((s) => (
            <Group key={s.key} gap={4} wrap="nowrap">
              <StatusDot color={s.color} />
              <Text size="xs" c="dimmed">
                {s.label}
              </Text>
            </Group>
          ))}
        </Group>
      }
      state={chartStateOf(speed, empty)}
      onRetry={() => void speed.refetch()}
      retrying={speed.isFetching}
      placeholderHeight={HEIGHT}
      facts={{
        value: formatMbit(median(downloads)),
        unit: 'Mbit/s',
        period: `median download · ${points.length} tests`,
      }}
    >
      <Lines
        ariaLabel={`Speed test download and upload in megabits per second, one point per hourly run, ${WINDOW_NOUN[window]}`}
        data={points}
        height={HEIGHT + LEGEND_ROW}
        x={(d: Point) => d.x}
        series={SERIES_DEF}
        y={{ ticks: 3, format: (v) => String(Math.round(v)) }}
        xDomain={axis.xDomain}
        xTicks={axis.xTicks}
        formatX={axis.formatX}
        cursorGroup={axis.cursorGroup}
        tooltip={axis.tooltip}
        xZones={outageBands(uptime.data)}
        legend={false}
      />
    </ChartCard>
  )
}
