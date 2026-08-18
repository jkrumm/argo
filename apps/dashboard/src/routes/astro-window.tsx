import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo } from 'react'
import { Grid, Group, Stack, useComputedColorScheme } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ChartHoverSync } from 'basalt-ui/charts'
import { PageActions } from 'basalt-ui'
import {
  type AstroView,
  ChartEmpty,
  CloudLayersChart,
  MAP_FULL_BLEED_HEIGHT,
  MonthlyBudgetChart,
  NightFacts,
  NightStrip,
  NightTimelineChart,
  PANORAMA_HEIGHT,
  Section,
  SiteMap,
  SiteSelector,
  SkyPanorama,
  VerdictHero,
  ViewTabs,
  BASE_LAYER_IDS,
  DEFAULT_LP_YEAR,
  formatLpParam,
  formatWeatherParam,
  LP_PARAM_VALUES,
  normaliseLayerState,
  parseLpParam,
  parseWeatherParam,
  SCHEME_DEFAULT_BASE,
  type MapLayerState,
} from '../features/astro-window'
import { astroQueries, type AstroWindowParams } from '../lib/queries/astro'

// ── Search params ──────────────────────────────────────────────────────────

const ViewEnum = z.enum(['tonight', 'map', 'forecast'])

/**
 * The map's configuration rides in the URL so a configured map is linkable and survives a reload
 * — but COMPACTLY. Four weather overlays with an opacity each would be eight query keys; `wx`
 * carries them as one delimited string (`radar.cloudmask:30`), decoded by the catalogue.
 *
 * `base` is deliberately OPTIONAL rather than defaulted: absent means "follow the colour scheme",
 * which is what keeps a dark/light toggle swapping the basemap for anyone who never opened the
 * drawer. It is only written to the URL when the pick differs from the scheme's own default.
 *
 * All three map keys carry `.catch()`, and that is not belt-and-braces — without it the page whose
 * whole job is to be linkable throws on its own links. TanStack's default parser is
 * `parseSearchWith(JSON.parse)`, so `?lp=2025` decodes to the NUMBER 2025 and a bare `z.enum` of
 * string literals rejects it; the thrown `SearchParamError` replaces the entire route with the
 * error component. The app's own encoder writes `?lp=%222025%22` (`defaultStringifySearch` quotes
 * a string that would otherwise round-trip as a number), so anyone tidying the quotes out of a
 * shared link lands on exactly that form. `.catch()` is what makes the catalogue's documented
 * fallbacks — `parseLpParam`'s unknown-year clamp, `baseLayer`'s unknown-id fallback — reachable
 * code rather than dead code behind a validator that already threw.
 */
const SearchSchema = z.object({
  site: z.string().default('alpenvorland'),
  nights: z.number().int().min(1).max(14).default(10),
  detailDate: z.string().optional(),
  tab: ViewEnum.default('tonight'),
  base: z.enum(BASE_LAYER_IDS).optional().catch(undefined),
  lp: z.enum(LP_PARAM_VALUES).catch(String(DEFAULT_LP_YEAR)),
  // Normalised rather than rejected: unknown ids are dropped by `parseWeatherParam`, so a stale
  // link opens a slightly different map instead of erroring on the page whose job is to be linked.
  wx: z
    .string()
    .optional()
    .catch(undefined)
    .transform((raw) => formatWeatherParam(parseWeatherParam(raw))),
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
  loader: async ({ context, deps }) => {
    const [windowData, sites] = await Promise.all([
      context.queryClient.ensureQueryData(
        astroQueries.window({
          site: deps.site,
          nights: deps.nights,
          ...(deps.detailDate !== undefined && { detailDate: deps.detailDate }),
        }),
      ),
      context.queryClient.ensureQueryData(astroQueries.sites()),
    ])

    // The panorama + monthly-budget charts only render on the Forecast tab — this is exactly the
    // "future per-tab prefetch" the `tab` loaderDep above was already carrying for. Coordinates
    // come from the sites list (never `windowData.location`), so a scouted lat/lon never silently
    // resolves to a different site's terrain.
    if (deps.tab === 'forecast') {
      const site = sites.data.find((s) => s.id === deps.site)
      if (site) {
        await Promise.all([
          context.queryClient.ensureQueryData(
            astroQueries.horizon({ lat: site.lat, lon: site.lon }),
          ),
          context.queryClient.ensureQueryData(
            astroQueries.skyglow({ lat: site.lat, lon: site.lon, date: windowData.detail.date }),
          ),
          context.queryClient.ensureQueryData(astroQueries.visibility({ site: site.id })),
        ])
      }
    }
  },
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
  const { data: sites } = useSuspenseQuery(astroQueries.sites())
  const selectedSite = sites.data.find((s) => s.id === search.site)

  /*
   * Every handler spreads the CURRENT search rather than listing the keys it cares about. With
   * the map's three keys now in the schema, the old key-by-key form silently dropped them:
   * changing the site would have reset the basemap, the atlas year and every weather overlay.
   *
   * A `(prev) => …` reducer is the obvious alternative and does not typecheck here — TanStack
   * types `prev` as the union of every route's search params, so `site`/`nights` come back
   * optional and the result no longer satisfies this route's schema.
   */
  const handleSiteChange = useCallback(
    (site: string) => {
      void navigate({
        to: '/astro-window',
        search: { ...search, site, detailDate: undefined },
      })
    },
    [navigate, search],
  )

  const handleNightsChange = useCallback(
    (nights: number) => {
      void navigate({
        to: '/astro-window',
        search: { ...search, nights, detailDate: undefined },
      })
    },
    [navigate, search],
  )

  const handleSelectDate = useCallback(
    (detailDate: string) => {
      void navigate({ to: '/astro-window', search: { ...search, detailDate } })
    },
    [navigate, search],
  )

  const handleTabChange = useCallback(
    (tab: AstroView) => {
      void navigate({ to: '/astro-window', search: { ...search, tab } })
    },
    [navigate, search],
  )

  /*
   * The map's layer state, decoded once. `base` resolves against the live colour scheme so the
   * map component never has to know that an absent param means "follow the theme" — and the
   * encoder below drops it again when it matches, so a toggle in the drawer that lands back on
   * the scheme default leaves the URL clean and scheme-reactive.
   */
  const resolvedScheme = useComputedColorScheme('dark')
  const schemeDefaultBase = SCHEME_DEFAULT_BASE[resolvedScheme]

  const layers = useMemo<MapLayerState>(
    () =>
      // `normaliseLayerState` applies the imagery/pollution exclusion HERE rather than only in the
      // drawer's handlers, so a shared or hand-trimmed link cannot mount a combination the drawer
      // would refuse to produce — `?base=eox-s2cloudless` alone is enough, since `lp` defaults to
      // the latest vintage rather than to off.
      normaliseLayerState({
        base: search.base ?? schemeDefaultBase,
        lpYear: parseLpParam(search.lp),
        weather: parseWeatherParam(search.wx),
      }),
    [search.base, search.lp, search.wx, schemeDefaultBase],
  )

  const handleLayersChange = useCallback(
    (next: MapLayerState) => {
      void navigate({
        to: '/astro-window',
        search: {
          ...search,
          base: next.base === schemeDefaultBase ? undefined : next.base,
          lp: formatLpParam(next.lpYear),
          wx: formatWeatherParam(next.weather),
        },
        // A layer toggle is a view setting, not a place — stacking one history entry per
        // checkbox would make the back button walk the drawer instead of leaving the page.
        replace: true,
      })
    },
    [navigate, search, schemeDefaultBase],
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
            layers={layers}
            onLayersChange={handleLayersChange}
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
                    columns the map used to occupy stay empty on purpose; the skyglow rose is
                    what fills them, once something renders it. */}
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
                {selectedSite ? (
                  <>
                    <SkyPanorama
                      key={`${selectedSite.id}-${selectedDate}`}
                      site={selectedSite}
                      detailDate={selectedDate}
                      hourly={data.detail.hourly}
                      moonIllumination={selectedNight.moon.illumination}
                    />
                    <MonthlyBudgetChart site={selectedSite} />
                  </>
                ) : (
                  <ChartEmpty height={PANORAMA_HEIGHT} message="Unknown site" />
                )}
              </>
            )}
          </Stack>
        </Section>
      )}
    </ChartHoverSync>
  )
}
