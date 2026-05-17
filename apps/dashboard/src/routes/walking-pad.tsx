import { Suspense, useCallback, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Grid, Group, SimpleGrid, Stack, Title } from '@mantine/core'
import { useElementSize, useMediaQuery } from '@mantine/hooks'
import { z } from 'zod'
import {
  AchievementsGallery,
  ChartSkeleton,
  DailyActivityChart,
  HeroStats,
  HeroStatsSkeleton,
  LengthHistogramChart,
  LiveCard,
  LiveCardSkeleton,
  PaceTrendChart,
  Section,
  SessionHistoryTable,
  SparklineGridChart,
  TimeOfDayChart,
  WeeklyVolumeChart,
  WindowSelector,
  presetToParams,
  useAchievementWatcher,
  type WindowPreset,
} from '../features/walking-pad'
import { walkingPadQueries } from '../lib/queries/walking-pad'

const SearchSchema = z.object({
  window: z.enum(['7d', '30d', '90d', '6m', '1y', 'all']).default('30d'),
})
type SearchParams = z.infer<typeof SearchSchema>

export const Route = createFileRoute('/walking-pad')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({ window: search.window }),
  loader: ({ context, deps }) => {
    const params = presetToParams(deps.window)
    return Promise.all([
      context.queryClient.ensureQueryData(walkingPadQueries.heroes(params)),
      context.queryClient.ensureQueryData(walkingPadQueries.list({ page: 1, limit: 1 })),
      // Don't await live — it polls anyway, no need to block first paint.
    ])
  },
  component: WalkingPadPage,
})

function WalkingPadPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const params = useMemo(() => presetToParams(search.window), [search.window])

  const handleWindowChange = useCallback(
    (next: WindowPreset) => {
      void navigate({ to: '/walking-pad', search: { window: next } })
    },
    [navigate],
  )

  // Toast + confetti on new achievement unlocks. Side-effect hook.
  useAchievementWatcher()

  // Mirror the left column's height into the achievements card on lg+ so the
  // two columns line up regardless of how many achievements are unlocked.
  // Below `lg` the columns stack — the prop drops back to undefined and the
  // gallery uses its built-in default height.
  const { ref: leftColRef, height: leftColHeight } = useElementSize<HTMLDivElement>()
  const isLg = useMediaQuery('(min-width: 75em)')
  const matchHeight = isLg === true && leftColHeight > 0 ? leftColHeight : undefined

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Title order={2}>WalkingPad</Title>
        <WindowSelector value={search.window} onChange={handleWindowChange} />
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md" ref={leftColRef}>
            <Suspense fallback={<LiveCardSkeleton />}>
              <LiveCard />
            </Suspense>
            <Suspense fallback={<HeroStatsSkeleton />}>
              <HeroStats params={params} />
            </Suspense>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Suspense fallback={<ChartSkeleton height={320} />}>
            <AchievementsGallery matchHeight={matchHeight} />
          </Suspense>
        </Grid.Col>
      </Grid>

      <Section title="Daily rhythm" subtitle="How is each day adding up?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartSkeleton />}>
            <DailyActivityChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartSkeleton />}>
            <PaceTrendChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Volume" subtitle="Am I keeping the habit alive week to week?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartSkeleton />}>
            <WeeklyVolumeChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartSkeleton height={240} />}>
            <LengthHistogramChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="Patterns" subtitle="When and how do I tend to walk?">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Suspense fallback={<ChartSkeleton height={240} />}>
            <TimeOfDayChart params={params} />
          </Suspense>
          <Suspense fallback={<ChartSkeleton />}>
            <SparklineGridChart params={params} />
          </Suspense>
        </SimpleGrid>
      </Section>

      <Section title="History" subtitle="Every closed session, newest first.">
        <Suspense fallback={<ChartSkeleton height={420} />}>
          <SessionHistoryTable />
        </Suspense>
      </Section>
    </Stack>
  )
}
