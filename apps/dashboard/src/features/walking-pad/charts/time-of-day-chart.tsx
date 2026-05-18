import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Group as MGroup, Stack, Text } from '@mantine/core'
import { useMemo } from 'react'
import { ChartCard, Group, useVxTheme } from '@argo/charts'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { ChartEmpty } from './empty'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Treadmill is never used between midnight and 06:00 — hide that quarter of
// the chart so the visible window (06:00–23:00) has room to breathe.
const MIN_HOUR = 6
const MAX_HOUR = 24
const HOUR_SPAN = MAX_HOUR - MIN_HOUR // 18 columns
const HOUR_TICKS = [6, 9, 12, 15, 18, 21]

type Cell = { hour: number; dow: number; sessions: number; distance_m: number }

/**
 * Local hour-of-day × day-of-week heatmap. Bespoke (no kind primitive matches)
 * but stays inside the chart contract — pulls colors from VX and resolves
 * theme neutrals via useVxTheme. Cells fade from a neutral grid color
 * (no walks) toward the WalkingPad distance hue (max walks in the window).
 */
export function TimeOfDayChart({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.hourOfDay(params))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { axis, line } = useVxTheme()
  const cells: Cell[] = useMemo(
    () => (data.cells as Cell[]).filter((c) => c.hour >= MIN_HOUR && c.hour < MAX_HOUR),
    [data.cells],
  )

  const maxSessions = useMemo(() => cells.reduce((m, c) => Math.max(m, c.sessions), 0), [cells])
  const total = cells.reduce((s, c) => s + c.sessions, 0)

  if (total === 0) {
    return (
      <ChartCard
        title="Time of day"
        subtitle="When do I tend to walk?"
        tooltip="Heatmap of session starts by day-of-week × hour-of-day (UTC). Darker cells = more sessions. Useful for spotting whether the desk-treadmill habit aligns with your meeting calendar or evening routine."
      >
        <ChartEmpty height={240} label="No walks yet — heatmap unlocks on first session." />
      </ChartCard>
    )
  }

  const height = 240
  const padLeft = 36
  const padBottom = 24
  const padTop = 8
  // Right margin reserves room for the gradient legend strip + "more / less"
  // labels which sit at `left={width - LEGEND_OFFSET}` below. Without this
  // the heatmap cells draw under the legend.
  const LEGEND_OFFSET = 50
  const padRight = LEGEND_OFFSET + 4
  const gridW = Math.max(0, width - padLeft - padRight)
  const cellW = gridW / HOUR_SPAN
  const cellH = (height - padTop - padBottom) / 7

  // Find the busiest cell for the badge.
  const busiest = cells.reduce<Cell | null>(
    (best, c) => (best === null || c.sessions > best.sessions ? c : best),
    null,
  )

  return (
    <ChartCard
      title="Time of day"
      subtitle="When do I tend to walk?"
      tooltip="Heatmap of session starts by day-of-week × hour-of-day (UTC). Darker cells = more sessions. Useful for spotting whether the desk-treadmill habit aligns with your meeting calendar or evening routine."
      extra={
        busiest !== null ? (
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            Peak: {DAY_LABELS[busiest.dow]} {String(busiest.hour).padStart(2, '0')}:00
          </span>
        ) : null
      }
    >
      <div ref={ref} style={{ height, width: '100%' }}>
        {width > 0 ? (
          <svg width={width} height={height}>
            <Group left={padLeft} top={padTop}>
              {cells.map((c) => {
                const x = (c.hour - MIN_HOUR) * cellW
                const y = c.dow * cellH
                const intensity = maxSessions > 0 ? c.sessions / maxSessions : 0
                return (
                  <rect
                    key={`${c.dow}-${c.hour}`}
                    x={x + 1}
                    y={y + 1}
                    width={Math.max(0, cellW - 2)}
                    height={Math.max(0, cellH - 2)}
                    fill={
                      c.sessions === 0
                        ? 'rgba(128,128,128,0.07)'
                        : `rgba(0, 184, 148, ${0.18 + intensity * 0.72})`
                    }
                    rx={2}
                  >
                    <title>
                      {`${DAY_LABELS[c.dow]} ${String(c.hour).padStart(2, '0')}:00 — ${c.sessions} session${c.sessions === 1 ? '' : 's'}, ${(c.distance_m / 1000).toFixed(2)} km`}
                    </title>
                  </rect>
                )
              })}
            </Group>
            {/* Day labels (left). */}
            <Group left={0} top={padTop}>
              {DAY_LABELS.map((d, i) => (
                <text
                  key={d}
                  x={padLeft - 6}
                  y={i * cellH + cellH / 2 + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill={axis}
                >
                  {d}
                </text>
              ))}
            </Group>
            {/* Hour ticks (bottom). */}
            <Group left={padLeft} top={height - padBottom}>
              {HOUR_TICKS.map((h) => (
                <text
                  key={h}
                  x={(h - MIN_HOUR) * cellW + cellW / 2}
                  y={14}
                  textAnchor="middle"
                  fontSize={10}
                  fill={axis}
                >
                  {String(h).padStart(2, '0')}:00
                </text>
              ))}
            </Group>
            {/* Legend gradient strip on the right margin */}
            <Group left={width - LEGEND_OFFSET} top={padTop}>
              <text x={0} y={-2} fontSize={9} fill={axis}>
                more
              </text>
              <defs>
                <linearGradient id="wp-heat-gradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={`rgba(0,184,148,0.9)`} />
                  <stop offset="100%" stopColor={`rgba(0,184,148,0.18)`} />
                </linearGradient>
              </defs>
              <rect width={6} height={cellH * 7} fill="url(#wp-heat-gradient)" rx={2} />
              <text x={0} y={cellH * 7 + 10} fontSize={9} fill={axis}>
                less
              </text>
            </Group>
            {/* Hidden reference to line so it stays in deps for theme refresh */}
            <text style={{ display: 'none' }}>{line}</text>
          </svg>
        ) : null}
      </div>
      <MGroup justify="space-between" mt={4}>
        <Text size="xs" c="dimmed">
          {String(MIN_HOUR).padStart(2, '0')}:00–{String(MAX_HOUR - 1).padStart(2, '0')}:59 UTC ·{' '}
          {total} sessions in window
        </Text>
        <Text size="xs" c="dimmed">
          Tip: hover a cell for exact totals
        </Text>
      </MGroup>
      <Stack gap={0} style={{ display: 'none' }}>
        {/* SR-only fallback summary so the chart isn't silent for screen readers. */}
        {cells.map((c) => (
          <span key={`a-${c.dow}-${c.hour}`}>
            {DAY_LABELS[c.dow]} {c.hour}: {c.sessions}
          </span>
        ))}
      </Stack>
    </ChartCard>
  )
}
