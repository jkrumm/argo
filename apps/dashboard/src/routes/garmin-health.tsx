import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { Grid, Group, SimpleGrid, Stack, Title } from '@mantine/core'
import { z } from 'zod'
import { HoverContext, type HoverCtx } from '@argo/charts'
import {
  HeroStats,
  Placeholder,
  Section,
  SyncControl,
  WindowSelector,
  presetToParams,
  type SummaryParams,
  type WindowPreset,
} from '../features/garmin-health'
import { dailyMetricsQueries } from '../lib/queries/daily-metrics'

// ── Search params ──────────────────────────────────────────────────────────

const PresetEnum = z.enum(['7d', '30d', '3m', '1y', 'all'])

const SearchSchema = z.object({
  window: PresetEnum.default('30d'),
  from: z.string().optional(),
  to: z.string().optional(),
})

type SearchParams = z.infer<typeof SearchSchema>

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/garmin-health')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    window: search.window,
    from: search.from,
    to: search.to,
  }),
  loader: ({ context, deps }) => {
    const params = resolveParams(deps)
    // Prefetch the three hero-card queries; charts prefetch their own data.
    return Promise.all([
      context.queryClient.ensureQueryData(dailyMetricsQueries.recovery(params)),
      context.queryClient.ensureQueryData(dailyMetricsQueries.fitnessDirection(params)),
      context.queryClient.ensureQueryData(dailyMetricsQueries.trainingLoad(params)),
    ])
  },
  component: GarminHealthPage,
})

function resolveParams(search: SearchParams): SummaryParams {
  if (search.from !== undefined && search.to !== undefined) {
    return { from: search.from, to: search.to }
  }
  return presetToParams(search.window)
}

// ── Page component ─────────────────────────────────────────────────────────

function GarminHealthPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const params = useMemo<SummaryParams>(() => resolveParams(search), [search])

  // Cross-chart hover sync
  const [hoverState, setHoverState] = useState<{ date: string | null; source: string | null }>({
    date: null,
    source: null,
  })
  const setHover = useCallback((date: string | null, source: string | null) => {
    setHoverState({ date, source })
  }, [])
  const hoverCtx = useMemo<HoverCtx>(() => ({ ...hoverState, setHover }), [hoverState, setHover])

  const handlePresetChange = useCallback(
    (preset: WindowPreset) => {
      void navigate({
        to: '/garmin-health',
        search: { window: preset, from: undefined, to: undefined },
      })
    },
    [navigate],
  )

  const handleRangeChange = useCallback(
    (from: string | undefined, to: string | undefined) => {
      void navigate({
        to: '/garmin-health',
        search: { window: search.window, from, to },
      })
    },
    [navigate, search.window],
  )

  return (
    <HoverContext.Provider value={hoverCtx}>
      <Stack gap="md">
        {/* Header */}
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm">
            <Title order={2}>Garmin Health</Title>
            <SyncControl />
          </Group>
          <WindowSelector
            preset={search.window}
            from={search.from}
            to={search.to}
            onPresetChange={handlePresetChange}
            onRangeChange={handleRangeChange}
          />
        </Group>

        {/* Hero composite cards */}
        <HeroStats params={params} />

        {/* Section 1: Activity & Fitness */}
        <Section title="Activity & Fitness">
          {/* CHART_SLOT: activities (full width) */}
          <Placeholder label="Activities" height={220} />
          <Grid>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              {/* CHART_SLOT: activity-score */}
              <Placeholder label="Activity Score" />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              {/* CHART_SLOT: fitness-trends */}
              <Placeholder label="Fitness Trends" />
            </Grid.Col>
          </Grid>
        </Section>

        {/* Section 2: Training Load */}
        <Section title="Training Load">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            {/* CHART_SLOT: acwr */}
            <Placeholder label="ACWR" />
            {/* CHART_SLOT: divergence */}
            <Placeholder label="Load Divergence" />
          </SimpleGrid>
        </Section>

        {/* Section 3: Recovery & Sleep */}
        <Section title="Recovery & Sleep">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            {/* CHART_SLOT: recovery-trend */}
            <Placeholder label="Recovery Trend" />
            {/* CHART_SLOT: sleep-breakdown */}
            <Placeholder label="Sleep Breakdown" />
          </SimpleGrid>
        </Section>

        {/* Section 4: Energy & Stress */}
        <Section title="Energy & Stress">
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            {/* CHART_SLOT: body-battery */}
            <Placeholder label="Body Battery" />
            {/* CHART_SLOT: stress */}
            <Placeholder label="Stress" />
          </SimpleGrid>
        </Section>
      </Stack>
    </HoverContext.Provider>
  )
}
