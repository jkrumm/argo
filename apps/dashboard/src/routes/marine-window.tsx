import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo } from 'react'
import { Grid, Stack } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ChartHoverSync } from 'basalt-ui/charts'
import { PageActions } from 'basalt-ui'
import {
  ChartEmpty,
  DayFacts,
  DayStrip,
  Section,
  SIDE_PANEL_HEIGHT,
  SpotMap,
  SpotSelector,
  SwellTimelineChart,
  VerdictHero,
  WindChart,
} from '../features/marine-window'
import { marineQueries, type MarineWindowParams } from '../lib/queries/marine'

// ── Search params ──────────────────────────────────────────────────────────

const SearchSchema = z.object({
  spot: z.string().default('hossegor'),
  days: z.number().int().min(1).max(7).default(5),
  detailDate: z.string().optional(),
})

type SearchParams = z.infer<typeof SearchSchema>

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/marine-window')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    spot: search.spot,
    days: search.days,
    detailDate: search.detailDate,
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(marineQueries.window(deps)),
      context.queryClient.ensureQueryData(marineQueries.spots()),
    ]),
  component: MarineWindowPage,
})

// ── Page component ─────────────────────────────────────────────────────────

function MarineWindowPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const params = useMemo<MarineWindowParams>(
    () => ({
      spot: search.spot,
      days: search.days,
      ...(search.detailDate !== undefined && { detailDate: search.detailDate }),
    }),
    [search.spot, search.days, search.detailDate],
  )

  const { data } = useSuspenseQuery(marineQueries.window(params))

  const handleSpotChange = useCallback(
    (spot: string) => {
      void navigate({
        to: '/marine-window',
        search: { spot, days: search.days, detailDate: undefined },
      })
    },
    [navigate, search.days],
  )

  const handleDaysChange = useCallback(
    (days: number) => {
      void navigate({
        to: '/marine-window',
        search: { spot: search.spot, days, detailDate: undefined },
      })
    },
    [navigate, search.spot],
  )

  const handleSelectDate = useCallback(
    (detailDate: string) => {
      void navigate({
        to: '/marine-window',
        search: { spot: search.spot, days: search.days, detailDate },
      })
    },
    [navigate, search.spot, search.days],
  )

  const selectedDate = data.detail.date
  const selectedDay = data.days.find((d) => d.date === selectedDate) ?? data.days[0] ?? null

  return (
    <ChartHoverSync>
      {/* Page controls live in the shared top-bar slot; the breadcrumb names the page. */}
      <PageActions>
        <SpotSelector
          spot={search.spot}
          days={search.days}
          onSpotChange={handleSpotChange}
          onDaysChange={handleDaysChange}
        />
      </PageActions>

      <Section title="Marine Window" subtitle="Is this day worth the drive for a surf?">
        <Stack gap="sm">
          <VerdictHero data={data} />

          <DayStrip days={data.days} selectedDate={selectedDate} onSelect={handleSelectDate} />

          <Grid gap="sm" align="stretch">
            <Grid.Col span={{ base: 12, lg: 7 }}>
              <Suspense fallback={<ChartEmpty height={SIDE_PANEL_HEIGHT} message="Loading map…" />}>
                <SpotMap spotId={search.spot} onSelectSpot={handleSpotChange} />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 5 }}>
              {selectedDay && <DayFacts day={selectedDay} location={data.location} />}
            </Grid.Col>
          </Grid>

          {selectedDay && (
            <>
              <SwellTimelineChart hourly={data.detail.hourly} day={selectedDay} />
              <WindChart hourly={data.detail.hourly} />
            </>
          )}
        </Stack>
      </Section>
    </ChartHoverSync>
  )
}
