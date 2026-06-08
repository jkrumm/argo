import { useSuspenseQuery } from '@tanstack/react-query'
import { useElementSize } from '@mantine/hooks'
import { Group as MGroup, Stack, Text } from '@mantine/core'
import { useMemo } from 'react'
import {
  ChartCard,
  ChartTooltip,
  Group,
  TooltipBody,
  TooltipRow,
  useChartTooltip,
  useTooltipStyles,
  useVxTheme,
  VX,
  alpha,
} from '@argo/charts'
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
// Chrome eaten by ChartCard around the SVG body when `matchHeight` is set:
// ~44px header (title+subtitle row + 1px border) + 16px body vertical padding
// + ~22px footer line (the "tip" row below the heatmap). Subtract from the
// matched height so the SVG fills the remainder exactly. Floor at the
// original 240 so a short history card doesn't squish the heatmap.
const CHART_CARD_CHROME = 82
const DEFAULT_HEIGHT = 240

/** WalkingPad distance hue (theme-aware) at a given opacity — drives the heat intensity. */
const distFill = (alpha: number) =>
  `color-mix(in srgb, ${VX.series.walkingDistance} ${Math.round(alpha * 100)}%, transparent)`

export function TimeOfDayChart({
  params,
  matchHeight,
}: {
  params: WalkingPadWindowParams
  matchHeight?: number
}) {
  const { data } = useSuspenseQuery(walkingPadQueries.hourOfDay(params))
  const { ref, width } = useElementSize<HTMLDivElement>()
  const { axis, line, tooltipMuted } = useVxTheme()
  const tooltipStyles = useTooltipStyles()
  const { tip, show, hide, tooltipRef } = useChartTooltip<Cell>()
  const cells: Cell[] = useMemo(
    () => (data.cells as Cell[]).filter((c) => c.hour >= MIN_HOUR && c.hour < MAX_HOUR),
    [data.cells],
  )

  const maxSessions = useMemo(() => cells.reduce((m, c) => Math.max(m, c.sessions), 0), [cells])
  // Unique-session count comes from the API; per-cell sessions sum over-counts
  // because a single session contributes to every hour it touched.
  const totalSessions = data.totalSessions

  if (totalSessions === 0) {
    return (
      <ChartCard
        title="Time of day"
        subtitle="When do I tend to walk?"
        tooltip="Heatmap of walking activity by day-of-week × hour-of-day (UTC). Each session lights up every hour it touched, not just its start hour — so a 2-hour walk starting at 14:00 colours 14:00, 15:00, and the partial overlap at 16:00. Darker cells = more sessions active in that hour. Useful for spotting whether the desk-treadmill habit aligns with your meeting calendar or evening routine."
      >
        <ChartEmpty
          height={DEFAULT_HEIGHT}
          label="No walks yet — heatmap unlocks on first session."
        />
      </ChartCard>
    )
  }

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

  // Find the busiest cell for the badge.
  const busiest = cells.reduce<Cell | null>(
    (best, c) => (best === null || c.sessions > best.sessions ? c : best),
    null,
  )

  return (
    <ChartCard
      title="Time of day"
      subtitle="When do I tend to walk?"
      tooltip="Heatmap of walking activity by day-of-week × hour-of-day (UTC). Each session lights up every hour it touched, not just its start hour — so a 2-hour walk starting at 14:00 colours 14:00, 15:00, and the partial overlap at 16:00. Darker cells = more sessions active in that hour. Useful for spotting whether the desk-treadmill habit aligns with your meeting calendar or evening routine."
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
                  <stop offset="0%" stopColor={distFill(0.9)} />
                  <stop offset="100%" stopColor={distFill(0.18)} />
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
      <MGroup justify="flex-start" mt={4}>
        <Text size="xs" c="dimmed">
          {String(MIN_HOUR).padStart(2, '0')}:00–{String(MAX_HOUR - 1).padStart(2, '0')}:59 UTC ·{' '}
          {totalSessions} session{totalSessions === 1 ? '' : 's'} in window · each session lights
          every hour it touched
        </Text>
      </MGroup>
      <ChartTooltip tip={tip} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip !== null && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
                padding: '6px 10px',
                borderBottom: `1px solid ${alpha(VX.neutral, 0.2)}`,
              }}
            >
              <span style={{ fontSize: 11, color: tooltipMuted }}>
                {DAY_LABELS[tip.data.dow]} · {String(tip.data.hour).padStart(2, '0')}:00 UTC
              </span>
            </div>
            <TooltipBody>
              <TooltipRow
                color={distFill(0.9)}
                shape="bar"
                label="Sessions"
                value={`${tip.data.sessions}`}
              />
              <TooltipRow
                color={distFill(0.45)}
                shape="bar"
                label="Distance"
                value={`${(tip.data.distance_m / 1000).toFixed(2)} km`}
              />
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
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
