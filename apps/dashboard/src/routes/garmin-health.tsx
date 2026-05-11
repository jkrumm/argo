import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Card, Grid, Group, SegmentedControl, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useElementSize } from '@mantine/hooks'
import { IconMinus, IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'
import {
  ChartCard,
  ChartLegend,
  HoverContext,
  VX,
  ZonedLine,
  useVxTheme,
  type HoverCtx,
} from '@argo/charts'
import { dailyMetricsQueries, type WindowParams } from '../lib/queries/daily-metrics'

// ── Search params ──────────────────────────────────────────────────────────

const SearchSchema = z.object({
  window: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
  from: z.string().optional(),
  to: z.string().optional(),
})

type SearchParams = z.infer<typeof SearchSchema>

// ── Local types (mirror API response shape) ────────────────────────────────

type MetricSummary = {
  current: number | null
  ma7: number | null
  ma30: number | null
  trend: 'up' | 'down' | 'flat'
}

type SeriesPoint = {
  date: string
  hrv: number | null
  restingHr: number | null
  sleepScore: number | null
  stress: number | null
  steps: number | null
  activeKcal: number | null
  sleepDurationSec: number | null
}

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/garmin-health')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    window: search.window as WindowParams['window'],
    from: search.from,
    to: search.to,
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(dailyMetricsQueries.summary(deps)),
      context.queryClient.ensureQueryData(dailyMetricsQueries.series(deps)),
    ]),
  component: GarminHealthPage,
})

// ── Shared chart container (responsive width via ResizeObserver) ────────────

function ChartContainer({
  height = 240,
  children,
}: {
  height?: number
  children: (width: number) => ReactNode
}) {
  const { ref, width } = useElementSize<HTMLDivElement>()
  return (
    <div ref={ref} style={{ height, width: '100%' }}>
      {width > 0 ? children(Math.max(width, 200)) : null}
    </div>
  )
}

// ── Summary card ───────────────────────────────────────────────────────────

function trendColor(trend: 'up' | 'down' | 'flat', betterDirection: 'up' | 'down'): string {
  if (trend === 'flat') return 'gray'
  return trend === betterDirection ? VX.goodSolid : VX.badSolid
}

function fmtMetric(v: number | null): string {
  return v === null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function SummaryCard({
  label,
  unit,
  betterDirection,
  summary,
}: {
  label: string
  unit: string
  betterDirection: 'up' | 'down'
  summary: MetricSummary
}) {
  const { current, ma7, ma30, trend } = summary
  const color = trendColor(trend, betterDirection)

  const TrendIconEl =
    trend === 'up' ? (
      <IconTrendingUp size={16} color={color} />
    ) : trend === 'down' ? (
      <IconTrendingDown size={16} color={color} />
    ) : (
      <IconMinus size={16} color={color} />
    )

  return (
    <Card padding="md" withBorder>
      <Text size="xs" c="dimmed" mb={4}>
        {label}
      </Text>
      <Group gap={6} align="baseline" mb={8}>
        <Text
          size="xl"
          fw={700}
          style={{ color: trend !== 'flat' ? color : undefined, lineHeight: 1 }}
        >
          {fmtMetric(current)}
        </Text>
        {unit.length > 0 && (
          <Text size="sm" c="dimmed">
            {unit}
          </Text>
        )}
        {TrendIconEl}
      </Group>
      <Group gap={16}>
        <div>
          <Text size="xs" c="dimmed">
            7d avg
          </Text>
          <Text size="sm">{fmtMetric(ma7)}</Text>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            30d avg
          </Text>
          <Text size="sm">{fmtMetric(ma30)}</Text>
        </div>
      </Group>
    </Card>
  )
}

// ── Chart components ───────────────────────────────────────────────────────

function HrvChart({ points }: { points: SeriesPoint[] }) {
  const { line } = useVxTheme()
  const latest = points[points.length - 1]
  const latestHrv = latest?.hrv ?? null

  return (
    <ChartCard
      title="HRV"
      subtitle="Is my recovery capacity improving?"
      tooltip="Heart Rate Variability last night average (ms). Higher is generally better — a sustained drop below your baseline may signal overtraining or illness."
      extra={
        latestHrv !== null ? (
          <span style={{ fontSize: 13 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{Math.round(latestHrv)}</span>
            <span style={{ opacity: 0.5 }}> ms</span>
          </span>
        ) : undefined
      }
    >
      <ChartContainer height={240}>
        {(width) => (
          <ZonedLine
            data={points}
            width={width}
            height={240}
            chartId="hrv"
            getX={(d) => d.date}
            getY={(d) => d.hrv}
            yDomain="auto"
            yAutoMinCeil={Infinity}
            seriesLabel="HRV (ms)"
            formatValue={(v) => `${Math.round(v)} ms`}
          />
        )}
      </ChartContainer>
      <ChartLegend
        items={[{ key: 'hrv', label: 'HRV (ms)', color: line }]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

function RestingHrChart({ points }: { points: SeriesPoint[] }) {
  const { line } = useVxTheme()
  const latest = points[points.length - 1]
  const latestRhr = latest?.restingHr ?? null

  return (
    <ChartCard
      title="Resting HR"
      subtitle="Is my cardiovascular fitness improving?"
      tooltip="Resting heart rate (bpm). Lower is better — fit adults 50–65 bpm, endurance athletes 35–55. A spike of 5–10+ bpm may signal illness or overtraining."
      extra={
        latestRhr !== null ? (
          <span style={{ fontSize: 13 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{Math.round(latestRhr)}</span>
            <span style={{ opacity: 0.5 }}> bpm</span>
          </span>
        ) : undefined
      }
    >
      <ChartContainer height={240}>
        {(width) => (
          <ZonedLine
            data={points}
            width={width}
            height={240}
            chartId="resting-hr"
            getX={(d) => d.date}
            getY={(d) => d.restingHr}
            yDomain="auto"
            yAutoMinCeil={Infinity}
            seriesLabel="Resting HR (bpm)"
            formatValue={(v) => `${Math.round(v)} bpm`}
          />
        )}
      </ChartContainer>
      <ChartLegend
        items={[{ key: 'restingHr', label: 'Resting HR (bpm)', color: line }]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

function SleepChart({ points }: { points: SeriesPoint[] }) {
  const { line } = useVxTheme()
  const latest = points[points.length - 1]
  const latestSleep = latest?.sleepScore ?? null

  function sleepLabel(score: number): { text: string; color: string } {
    if (score >= 90) return { text: 'Excellent', color: VX.goodSolid }
    if (score >= 80) return { text: 'Good', color: VX.goodSolid }
    if (score >= 60) return { text: 'Fair', color: VX.warnSolid }
    return { text: 'Poor', color: VX.badSolid }
  }

  return (
    <ChartCard
      title="Sleep Quality"
      subtitle="How well did I sleep?"
      tooltip="Sleep score (0–100). 90+ excellent, 80–89 good, 60–79 fair, <60 poor. Garmin user average is 72."
      extra={
        latestSleep !== null
          ? (() => {
              const { text, color } = sleepLabel(latestSleep)
              return (
                <span style={{ fontSize: 13 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color }}>{latestSleep}</span>
                  <span style={{ opacity: 0.5 }}> {text}</span>
                </span>
              )
            })()
          : undefined
      }
    >
      <ChartContainer height={240}>
        {(width) => (
          <ZonedLine
            data={points}
            width={width}
            height={240}
            chartId="sleep-score"
            getX={(d) => d.date}
            getY={(d) => d.sleepScore}
            yDomain={[0, 100]}
            zones={[
              { from: 90, to: 100, fill: VX.good },
              { from: 80, to: 90, fill: VX.goodSoft },
              { from: 60, to: 80, fill: VX.warn },
              { from: 0, to: 60, fill: VX.bad },
            ]}
            refLines={[
              { value: 90, color: VX.goodRef },
              { value: 80, color: VX.goodRef },
              { value: 60, color: VX.warnRef },
            ]}
            seriesLabel="Sleep Score"
            formatValue={(v) => String(Math.round(v))}
            tooltipLabel={(d) => (d.sleepScore !== null ? sleepLabel(d.sleepScore) : null)}
          />
        )}
      </ChartContainer>
      <ChartLegend
        items={[
          { key: 'sleep', label: 'Sleep Score', color: line },
          { key: 'good', label: 'Good (≥80)', color: VX.goodSolid, shape: 'bar' },
          { key: 'fair', label: 'Fair (60–79)', color: VX.warnSolid, shape: 'bar' },
          { key: 'poor', label: 'Poor (<60)', color: VX.badSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

function StressChart({ points }: { points: SeriesPoint[] }) {
  const { line } = useVxTheme()
  const latest = points[points.length - 1]
  const latestStress = latest?.stress ?? null

  function stressLabel(s: number): { text: string; color: string } {
    if (s >= 75) return { text: 'High', color: VX.badSolid }
    if (s >= 50) return { text: 'Moderate', color: VX.warnSolid }
    if (s >= 25) return { text: 'Low', color: VX.goodSolid }
    return { text: 'Rest', color: VX.goodSolid }
  }

  return (
    <ChartCard
      title="Stress Levels"
      subtitle="How calm was my day?"
      tooltip="HRV-based autonomic stress (0–100). 0–24 rest, 25–49 low, 50–74 moderate, 75+ high. Elevated overnight stress may indicate sleep apnea or overtraining."
      extra={
        latestStress !== null
          ? (() => {
              const { text, color } = stressLabel(latestStress)
              return (
                <span style={{ fontSize: 13 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color }}>
                    {Math.round(latestStress)}
                  </span>
                  <span style={{ opacity: 0.5 }}> {text}</span>
                </span>
              )
            })()
          : undefined
      }
    >
      <ChartContainer height={240}>
        {(width) => (
          <ZonedLine
            data={points}
            width={width}
            height={240}
            chartId="stress"
            getX={(d) => d.date}
            getY={(d) => d.stress}
            yDomain={[0, 100]}
            zones={[
              { from: 75, to: 100, fill: VX.bad },
              { from: 50, to: 75, fill: VX.warn },
              { from: 25, to: 50, fill: VX.goodSoft },
              { from: 0, to: 25, fill: VX.good },
            ]}
            refLines={[
              { value: 75, color: VX.badRef },
              { value: 50, color: VX.warnRef },
              { value: 25, color: VX.goodRef },
            ]}
            seriesLabel="Stress"
            formatValue={(v) => String(Math.round(v))}
            tooltipLabel={(d) => (d.stress !== null ? stressLabel(d.stress) : null)}
          />
        )}
      </ChartContainer>
      <ChartLegend
        items={[
          { key: 'stress', label: 'Avg Stress', color: line },
          { key: 'high', label: 'High (≥75)', color: VX.badSolid, shape: 'bar' },
          { key: 'moderate', label: 'Moderate (50–74)', color: VX.warnSolid, shape: 'bar' },
        ]}
        highlighted={null}
        onHighlight={() => {}}
      />
    </ChartCard>
  )
}

// ── Page component ─────────────────────────────────────────────────────────

function GarminHealthPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const params = useMemo<WindowParams>(
    () => ({ window: search.window, from: search.from, to: search.to }),
    [search.window, search.from, search.to],
  )

  const { data: summary } = useSuspenseQuery(dailyMetricsQueries.summary(params))
  const { data: series } = useSuspenseQuery(dailyMetricsQueries.series(params))

  const [hoverState, setHoverState] = useState<{ date: string | null; source: string | null }>({
    date: null,
    source: null,
  })

  const setHover = useCallback((date: string | null, source: string | null) => {
    setHoverState({ date, source })
  }, [])

  const hoverCtx = useMemo<HoverCtx>(() => ({ ...hoverState, setHover }), [hoverState, setHover])

  function handleWindowChange(value: string) {
    void navigate({
      to: '/garmin-health',
      search: { window: value as '7d' | '30d' | '90d' | 'all' },
    })
  }

  function handleDateRange([from, to]: [string | null, string | null]) {
    void navigate({
      to: '/garmin-health',
      search: {
        window: search.window,
        from: from ?? undefined,
        to: to ?? undefined,
      },
    })
  }

  return (
    <HoverContext.Provider value={hoverCtx}>
      <Stack>
        <Group justify="space-between" wrap="wrap">
          <Title order={2}>Garmin Health</Title>
          <Group>
            <SegmentedControl
              value={search.window}
              onChange={handleWindowChange}
              size="xs"
              data={[
                { label: '7D', value: '7d' },
                { label: '30D', value: '30d' },
                { label: '90D', value: '90d' },
                { label: 'All', value: 'all' },
              ]}
            />
            <DatePickerInput
              type="range"
              placeholder="Custom range"
              value={[search.from ?? null, search.to ?? null]}
              onChange={handleDateRange}
              clearable
              size="xs"
            />
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
          <SummaryCard label="HRV" unit="ms" betterDirection="up" summary={summary.hrv} />
          <SummaryCard
            label="Resting HR"
            unit="bpm"
            betterDirection="down"
            summary={summary.restingHr}
          />
          <SummaryCard label="Sleep Score" unit="" betterDirection="up" summary={summary.sleep} />
          <SummaryCard label="Stress" unit="" betterDirection="down" summary={summary.stress} />
        </SimpleGrid>

        <Grid>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <HrvChart points={series.points} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <RestingHrChart points={series.points} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <SleepChart points={series.points} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <StressChart points={series.points} />
          </Grid.Col>
        </Grid>
      </Stack>
    </HoverContext.Provider>
  )
}
