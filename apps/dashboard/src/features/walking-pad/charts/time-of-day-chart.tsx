import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Group as MGroup, Stack, Text, VisuallyHidden } from '@mantine/core'
import { useMemo, useState, type MouseEvent } from 'react'
import {
  ChartCard,
  ChartTooltipFloat,
  Group,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  useChartSize,
} from 'basalt-ui/charts'
import { VX, alpha } from 'basalt-ui/tokens'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../../lib/queries/walking-pad'
import { SERIES } from '../../../lib/series'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Treadmill is never used between midnight and 06:00 — hide that quarter of
// the chart so the visible window (06:00–23:00) has room to breathe.
const MIN_HOUR = 6
const MAX_HOUR = 24
const HOUR_SPAN = MAX_HOUR - MIN_HOUR // 18 columns
const HOUR_TICKS = [6, 9, 12, 15, 18, 21]

type Cell = { hour: number; dow: number; sessions: number; distance_m: number }
type Tip = { cell: Cell; anchor: { x: number; y: number } }

/**
 * Local hour-of-day × day-of-week heatmap. Bespoke rather than the shipped
 * `Heatmap` kind: that kind labels every column (18 hour ticks here, against
 * the 6 this reads with), puts its gradient legend below the grid instead of
 * in the right margin, and hands `renderTooltip` only `{row, col, value}` —
 * which can't reach the per-cell distance this tooltip shows.
 *
 * A day × hour matrix is not a single cartesian plot, so `CartesianChart` (one plot rect, one x
 * scale, one or two y axes) cannot express it. There is deliberately NO `hand-rolled-plot` waiver
 * here: this file renders no assembly primitive, so the rule does not fire and a waiver would
 * suppress nothing today while silently covering the next real finding. If it ever fires, that is
 * a signal worth reading rather than one already answered.
 */
// Chrome eaten by ChartCard around the SVG body when `matchHeight` is set:
// ~44px header (title+subtitle row + 1px border) + 16px body vertical padding
// + ~22px footer line (the "tip" row below the heatmap). Subtract from the
// matched height so the SVG fills the remainder exactly. Floor at the
// original 240 so a short history card doesn't squish the heatmap.
const CHART_CARD_CHROME = 82
const DEFAULT_HEIGHT = 240

/** WalkingPad distance hue (theme-aware) at a given opacity — drives the heat intensity. */
const distFill = (opacity: number) => alpha(SERIES.walkingDistance, opacity)

export function TimeOfDayChart({
  params,
  matchHeight,
}: {
  params: WalkingPadWindowParams
  matchHeight?: number | undefined
}) {
  const { data } = useSuspenseQuery(walkingPadQueries.hourOfDay(params))
  const { ref, width } = useChartSize()
  const [tip, setTip] = useState<Tip | null>(null)
  const cells: Cell[] = useMemo(
    () => (data.cells as Cell[]).filter((c) => c.hour >= MIN_HOUR && c.hour < MAX_HOUR),
    [data.cells],
  )

  const maxSessions = useMemo(() => cells.reduce((m, c) => Math.max(m, c.sessions), 0), [cells])
  // Unique-session count comes from the API; per-cell sessions sum over-counts
  // because a single session contributes to every hour it touched.
  const totalSessions = data.totalSessions

  const height =
    matchHeight !== undefined
      ? Math.max(DEFAULT_HEIGHT, matchHeight - CHART_CARD_CHROME)
      : DEFAULT_HEIGHT
  const padLeft = 36
  const padBottom = 24
  const padTop = 8
  // Right margin reserves room for the gradient legend strip + "more / less"
  // labels which sit at `left={width - LEGEND_OFFSET}` below. Without this
  // the heatmap cells draw under the legend. `LEGEND_OFFSET` is the legend's
  // distance from the SVG's right edge (kept tight — text is ~22px wide);
  // `padRight - LEGEND_OFFSET` is the breathing room between the cells and
  // the legend strip.
  const LEGEND_OFFSET = 28
  const padRight = LEGEND_OFFSET + 20
  const gridW = Math.max(0, width - padLeft - padRight)
  const cellW = gridW / HOUR_SPAN
  const cellH = (height - padTop - padBottom) / 7

  const show = (cell: Cell, event: MouseEvent<SVGRectElement>) => {
    setTip({ cell, anchor: { x: event.clientX, y: event.clientY } })
  }
  const hide = () => setTip(null)

  // Find the busiest cell for the badge.
  const busiest = cells.reduce<Cell | null>(
    (best, c) => (best === null || c.sessions > best.sessions ? c : best),
    null,
  )

  return (
    <ChartCard
      title="Time of day"
      subtitle="When do I tend to walk?"
      info="Heatmap of walking activity by day-of-week × hour-of-day (UTC). Each session lights up every hour it touched, not just its start hour — so a 2-hour walk starting at 14:00 colours 14:00, 15:00, and the partial overlap at 16:00. Darker cells = more sessions active in that hour. Useful for spotting whether the desk-treadmill habit aligns with your meeting calendar or evening routine."
      actions={
        busiest !== null ? (
          <span style={{ fontSize: VX.text.xs, fontWeight: 600 }}>
            Peak: {DAY_LABELS[busiest.dow]} {String(busiest.hour).padStart(2, '0')}:00
          </span>
        ) : null
      }
      state={{ empty: totalSessions === 0 && 'No walks yet — heatmap unlocks on first session.' }}
      placeholderHeight={DEFAULT_HEIGHT}
    >
      <Box ref={ref} h={height} w="100%">
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            // `group`, never `img`: per ARIA every descendant of a `role="img"` element is
            // presentational, which is the bug basalt-ui fixed in `ChartFrame` at 1.16. This
            // matches what `ChartFrame` itself puts on a chart root.
            role="group"
            aria-label="Walking sessions by day of week and hour of day"
          >
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
                    fill={c.sessions === 0 ? VX.grid : distFill(0.18 + intensity * 0.72)}
                    rx={2}
                    style={{ cursor: c.sessions > 0 ? 'pointer' : 'default' }}
                    onMouseMove={(e) => show(c, e)}
                    onMouseLeave={hide}
                  />
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
                  fontSize={VX.text.micro}
                  fill={VX.axis}
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
                  fontSize={VX.text.micro}
                  fill={VX.axis}
                >
                  {String(h).padStart(2, '0')}:00
                </text>
              ))}
            </Group>
            {/* Legend gradient strip on the right margin */}
            <Group left={width - LEGEND_OFFSET} top={padTop}>
              <text x={0} y={-2} fontSize={VX.text.micro} fill={VX.axis}>
                more
              </text>
              <defs>
                <linearGradient id="wp-heat-gradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={distFill(0.9)} />
                  <stop offset="100%" stopColor={distFill(0.18)} />
                </linearGradient>
              </defs>
              <rect width={6} height={cellH * 7} fill="url(#wp-heat-gradient)" rx={2} />
              <text x={0} y={cellH * 7 + 10} fontSize={VX.text.micro} fill={VX.axis}>
                less
              </text>
            </Group>
          </svg>
        ) : null}
      </Box>
      <MGroup justify="flex-start" mt={4}>
        <Text size="xs" c="dimmed">
          {String(MIN_HOUR).padStart(2, '0')}:00–{String(MAX_HOUR - 1).padStart(2, '0')}:59 UTC ·{' '}
          {totalSessions} session{totalSessions === 1 ? '' : 's'} in window · each session lights
          every hour it touched
        </Text>
      </MGroup>
      {tip !== null && (
        <ChartTooltipFloat anchor={tip.anchor}>
          <TooltipHeader
            date={`${DAY_LABELS[tip.cell.dow]} · ${String(tip.cell.hour).padStart(2, '0')}:00 UTC`}
          />
          <TooltipBody>
            <TooltipRow
              color={distFill(0.9)}
              shape="bar"
              label="Sessions"
              value={`${tip.cell.sessions}`}
            />
            <TooltipRow
              color={distFill(0.45)}
              shape="bar"
              label="Distance"
              value={`${(tip.cell.distance_m / 1000).toFixed(2)} km`}
            />
          </TooltipBody>
        </ChartTooltipFloat>
      )}
      {/* SR-only fallback summary. `display: none` would prune it from the accessibility tree
          entirely — `VisuallyHidden` is the only form a screen reader actually reads. */}
      <VisuallyHidden>
        <Stack gap={0}>
          {cells.map((c) => (
            <span key={`a-${c.dow}-${c.hour}`}>
              {DAY_LABELS[c.dow]} {c.hour}: {c.sessions}
            </span>
          ))}
        </Stack>
      </VisuallyHidden>
    </ChartCard>
  )
}
