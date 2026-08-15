import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo } from 'react'
import { Grid, Stack } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ChartHoverSync } from 'basalt-ui/charts'
import { PageActions } from 'basalt-ui'
import {
  ChartEmpty,
  CloudLayersChart,
  NightFacts,
  NightStrip,
  NightTimelineChart,
  Section,
  SIDE_PANEL_HEIGHT,
  SiteMap,
  SiteSelector,
  VerdictHero,
} from '../features/astro-window'
import { astroQueries, type AstroWindowParams } from '../lib/queries/astro'

// ── Search params ──────────────────────────────────────────────────────────

const SearchSchema = z.object({
  site: z.string().default('alpenvorland'),
  nights: z.number().int().min(1).max(14).default(10),
  detailDate: z.string().optional(),
})

type SearchParams = z.infer<typeof SearchSchema>

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/astro-window')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    site: search.site,
    nights: search.nights,
    detailDate: search.detailDate,
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(astroQueries.window(deps)),
      context.queryClient.ensureQueryData(astroQueries.sites()),
    ]),
  component: AstroWindowPage,
})

// ── Page component ─────────────────────────────────────────────────────────

function AstroWindowPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const params = useMemo<AstroWindowParams>(
    () => ({
      site: search.site,
      nights: search.nights,
      ...(search.detailDate !== undefined && { detailDate: search.detailDate }),
    }),
    [search.site, search.nights, search.detailDate],
  )

  const { data } = useSuspenseQuery(astroQueries.window(params))

  const handleSiteChange = useCallback(
    (site: string) => {
      void navigate({
        to: '/astro-window',
        search: { site, nights: search.nights, detailDate: undefined },
      })
    },
    [navigate, search.nights],
  )

  const handleNightsChange = useCallback(
    (nights: number) => {
      void navigate({
        to: '/astro-window',
        search: { site: search.site, nights, detailDate: undefined },
      })
    },
    [navigate, search.site],
  )

  const handleSelectDate = useCallback(
    (detailDate: string) => {
      void navigate({
        to: '/astro-window',
        search: { site: search.site, nights: search.nights, detailDate },
      })
    },
    [navigate, search.site, search.nights],
  )

  const selectedDate = data.detail.date
  const selectedNight = data.nights.find((n) => n.date === selectedDate) ?? data.nights[0] ?? null

  return (
    <ChartHoverSync>
      {/* Page controls live in the shared top-bar slot; the breadcrumb names the page. */}
      <PageActions>
        <SiteSelector
          site={search.site}
          nights={search.nights}
          onSiteChange={handleSiteChange}
          onNightsChange={handleNightsChange}
        />
      </PageActions>

      <Section
        title="Astro Window"
        subtitle="Is tonight worth going out for Milky Way nightscapes?"
      >
        <Stack gap="sm">
          <VerdictHero data={data} />

          <NightStrip
            nights={data.nights}
            selectedDate={selectedDate}
            onSelect={handleSelectDate}
          />

          <Grid gap="sm" align="stretch">
            <Grid.Col span={{ base: 12, lg: 7 }}>
              <Suspense fallback={<ChartEmpty height={SIDE_PANEL_HEIGHT} message="Loading map…" />}>
                <SiteMap siteId={search.site} onSelectSite={handleSiteChange} />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 5 }}>
              {selectedNight && (
                <NightFacts
                  night={selectedNight}
                  bortle={data.location.bortle}
                  timeZone={data.location.timeZone}
                />
              )}
            </Grid.Col>
          </Grid>

          {selectedNight && (
            <>
              <NightTimelineChart hourly={data.detail.hourly} night={selectedNight} />
              <CloudLayersChart hourly={data.detail.hourly} />
            </>
          )}
        </Stack>
      </Section>
    </ChartHoverSync>
  )
}
