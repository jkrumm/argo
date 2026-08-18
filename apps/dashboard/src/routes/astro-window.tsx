import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo } from 'react'
import { Grid, Group, Stack } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ChartHoverSync } from 'basalt-ui/charts'
import { PageActions } from 'basalt-ui'
import {
  type AstroView,
  ChartEmpty,
  CloudLayersChart,
  MAP_FULL_BLEED_HEIGHT,
  NightFacts,
  NightStrip,
  NightTimelineChart,
  Section,
  SiteMap,
  SiteSelector,
  VerdictHero,
  ViewTabs,
} from '../features/astro-window'
import { astroQueries, type AstroWindowParams } from '../lib/queries/astro'

// ── Search params ──────────────────────────────────────────────────────────

const ViewEnum = z.enum(['tonight', 'map', 'forecast'])

const SearchSchema = z.object({
  site: z.string().default('alpenvorland'),
  nights: z.number().int().min(1).max(14).default(10),
  detailDate: z.string().optional(),
  tab: ViewEnum.default('tonight'),
})

type SearchParams = z.infer<typeof SearchSchema>

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/astro-window')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  // `tab` rides along even though no query keys off it — without it in the deps the loader does
  // not re-run on a tab change, and a future per-tab prefetch would silently never fire.
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    site: search.site,
    nights: search.nights,
    detailDate: search.detailDate,
    tab: search.tab,
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        astroQueries.window({
          site: deps.site,
          nights: deps.nights,
          ...(deps.detailDate !== undefined && { detailDate: deps.detailDate }),
        }),
      ),
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
        search: { site, nights: search.nights, detailDate: undefined, tab: search.tab },
      })
    },
    [navigate, search.nights, search.tab],
  )

  const handleNightsChange = useCallback(
    (nights: number) => {
      void navigate({
        to: '/astro-window',
        search: { site: search.site, nights, detailDate: undefined, tab: search.tab },
      })
    },
    [navigate, search.site, search.tab],
  )

  const handleSelectDate = useCallback(
    (detailDate: string) => {
      void navigate({
        to: '/astro-window',
        search: { site: search.site, nights: search.nights, detailDate, tab: search.tab },
      })
    },
    [navigate, search.site, search.nights, search.tab],
  )

  const handleTabChange = useCallback(
    (tab: AstroView) => {
      void navigate({
        to: '/astro-window',
        search: {
          site: search.site,
          nights: search.nights,
          detailDate: search.detailDate,
          tab,
        },
      })
    },
    [navigate, search.site, search.nights, search.detailDate],
  )

  const selectedDate = data.detail.date
  const selectedNight = data.nights.find((n) => n.date === selectedDate) ?? data.nights[0] ?? null

  return (
    <ChartHoverSync>
      {/* Page controls live in the shared top-bar slot; the breadcrumb names the page. */}
      <PageActions>
        <Group gap="sm" wrap="nowrap">
          <ViewTabs value={search.tab} onChange={handleTabChange} />
          <SiteSelector
            site={search.site}
            nights={search.nights}
            onSiteChange={handleSiteChange}
            onNightsChange={handleNightsChange}
          />
        </Group>
      </PageActions>

      {/*
        The Map tab is deliberately unwrapped: no Section heading, no night strip, nothing above
        the card. It is the one view whose whole point is area, and the breadcrumb plus the tabs
        in the header already say where you are.

        The night strip stays on Tonight and Forecast ONLY. It is date navigation, and both of
        those views are date-driven — the facts panel and both charts read `detailDate`. Nothing
        on the map does: the light-pollution atlas is annual and the site markers are static, so
        a date picker there would be a control with no effect, paid for in the ~70px of height
        the tab exists to reclaim.
      */}
      {search.tab === 'map' ? (
        <Suspense fallback={<ChartEmpty height={MAP_FULL_BLEED_HEIGHT} message="Loading map…" />}>
          <SiteMap
            siteId={search.site}
            onSelectSite={handleSiteChange}
            height={MAP_FULL_BLEED_HEIGHT}
          />
        </Suspense>
      ) : (
        <Section
          title="Astro Window"
          subtitle="Is tonight worth going out for Milky Way nightscapes?"
        >
          <Stack gap="sm">
            {search.tab === 'tonight' && <VerdictHero data={data} />}

            <NightStrip
              nights={data.nights}
              selectedDate={selectedDate}
              onSelect={handleSelectDate}
            />

            {search.tab === 'tonight' && selectedNight && (
              <Grid gap="sm" align="stretch">
                {/* The facts panel keeps its column width — it is a label/value list, and
                    stretched across the full page the two halves of every row drift apart. The
                    columns the map used to occupy stay empty on purpose; Phase 5's skyglow rose
                    is what fills them. */}
                <Grid.Col span={{ base: 12, md: 7, lg: 5 }}>
                  <NightFacts
                    night={selectedNight}
                    coreDirectionMpsas={data.location.coreDirectionMpsas}
                    domePenaltyMag={data.location.domePenaltyMag}
                    darknessSource={data.location.darknessSource}
                    timeZone={data.location.timeZone}
                  />
                </Grid.Col>
              </Grid>
            )}

            {search.tab === 'forecast' && selectedNight && (
              <>
                <NightTimelineChart hourly={data.detail.hourly} night={selectedNight} />
                <CloudLayersChart hourly={data.detail.hourly} />
              </>
            )}
          </Stack>
        </Section>
      )}
    </ChartHoverSync>
  )
}
