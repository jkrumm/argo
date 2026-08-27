import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo } from 'react'
import { Grid, Stack, useComputedColorScheme } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { BasaltErrorBoundary, PageBar, Section, type BasaltErrorContext } from 'basalt-ui'
import { FilterSet, SelectFilter, ViewTabs } from 'basalt-ui/controls'
import { astroStore } from '../lib/window-stores'
import {
  CHART_HEIGHT,
  ChartEmpty,
  CloudLayersChart,
  MAP_FULL_BLEED_HEIGHT,
  MonthlyBudgetChart,
  NightFacts,
  NightStrip,
  NightTimelineChart,
  PANORAMA_HEIGHT,
  SiteMap,
  SkyPanorama,
  VerdictHero,
  BASE_LAYER_IDS,
  DEFAULT_LP_YEAR,
  formatLpParam,
  formatTerrainParam,
  formatWeatherParam,
  parseLpParam,
  parseTerrainParam,
  parseWeatherParam,
  SCHEME_DEFAULT_BASE,
  type MapLayerState,
} from '../features/astro-window'
import { astroQueries, type AstroWindowParams } from '../lib/queries/astro'

// ── Search params ──────────────────────────────────────────────────────────

/**
 * `MapSchema` — the map's own five keys, plus `detailDate`. `site`/`nights`/`tab` moved onto
 * `astroStore`; these cannot follow, because three carry `.transform()` codecs and one is a free
 * date, none of which the field vocabulary expresses. `validateSearch` below COMPOSES the two
 * halves, which is the documented shape for a route with a genuinely wider search
 * (`.claude/rules/basalt-state.md`).
 *
 * The map's configuration rides in the URL so a configured map is linkable and survives a reload
 * — but COMPACTLY. Six weather overlays with an opacity each would be twelve query keys; `wx`
 * carries them as one delimited string (`radar.cloud:30`), decoded by the catalogue.
 *
 * `base` is deliberately OPTIONAL rather than defaulted: absent means "follow the colour scheme",
 * which is what keeps a dark/light toggle swapping the basemap for anyone who never opened the
 * drawer. It is only written to the URL when the pick differs from the scheme's own default.
 *
 * All three map keys carry `.catch()`, and that is not belt-and-braces — without it the page whose
 * whole job is to be linkable throws on its own links. TanStack's default parser is
 * `parseSearchWith(JSON.parse)`, so `?lp=2025` decodes to the NUMBER 2025 and a bare `z.string()`
 * rejects it; the thrown `SearchParamError` replaces the entire route with the error component.
 * The app's own encoder writes `?lp=%222025%22` (`defaultStringifySearch` quotes a string that
 * would otherwise round-trip as a number), so anyone tidying the quotes out of a shared link lands
 * on exactly that form. `.catch()` is what makes the catalogue's documented fallbacks —
 * `parseLpParam`'s unknown-year clamp, `baseLayer`'s unknown-id fallback — reachable code rather
 * than dead code behind a validator that already threw.
 */
const MapSchema = z.object({
  detailDate: z.string().optional(),
  base: z.enum(BASE_LAYER_IDS).optional().catch(undefined),
  // Same normalise-don't-reject shape as `wx`/`terrain` below — `parseLpParam` already falls back
  // to the default vintage for anything it does not recognise, and now carries the ramp's own
  // opacity and resampling mode too (`<year>[:<percent>[:sharp]]`), so a fixed `z.enum` of bare
  // years can no longer describe every valid value.
  lp: z
    .string()
    .optional()
    .catch(undefined)
    .transform((raw) => formatLpParam(parseLpParam(raw ?? String(DEFAULT_LP_YEAR)))),
  // Normalised rather than rejected: unknown ids are dropped by `parseWeatherParam`, so a stale
  // link opens a slightly different map instead of erroring on the page whose job is to be linked.
  wx: z
    .string()
    .optional()
    .catch(undefined)
    .transform((raw) => formatWeatherParam(parseWeatherParam(raw))),
  // Same normalise-don't-reject shape as `wx` — `parseTerrainParam` already falls back to
  // hillshade on (the untouched-URL default, `TERRAIN_DEFAULT`) with everything else off for
  // anything it does not recognise.
  terrain: z
    .string()
    .optional()
    .catch(undefined)
    .transform((raw) => formatTerrainParam(parseTerrainParam(raw))),
})

type SearchParams = ReturnType<typeof validateSearch>

function validateSearch(raw: Record<string, unknown>) {
  return { ...astroStore.validateSearch(raw), ...MapSchema.parse(raw) }
}

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/astro-window')({
  validateSearch,
  // `tab` rides along even though no query keys off it — without it in the deps the loader does
  // not re-run on a tab change, and a future per-tab prefetch would silently never fire.
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    site: search.site,
    // `nights` is a string enum on the store (there is no numeric filter control), so the query
    // gets the number here rather than the page doing it three times over.
    nights: Number(search.nights),
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

    /*
     * The panorama + monthly-budget charts only render on the Forecast tab — this is exactly the
     * "future per-tab prefetch" the `tab` loaderDep above was already carrying for. Coordinates
     * come from the sites list (never `windowData.location`), so a scouted lat/lon never silently
     * resolves to a different site's terrain.
     *
     * `prefetchQuery`, un-awaited, and NOT `ensureQueryData`. These three are backed by
     * third-party hosts (AWS `elevation-tiles-prod`, `djlorenz.github.io`) whose routes document
     * 502 as a normal outcome. Awaiting `ensureQueryData` made the loader reject on that, and a
     * rejected loader replaces the WHOLE route with the error component — taking the verdict
     * hero, the night strip and both weather charts, none of which touch those upstreams, down
     * with a DEM tile. It also blocked the tab switch behind a cold ~100-tile fetch plus a
     * ~373 ms server-side integral. `prefetchQuery` never rejects; the charts suspend on their
     * own and fail inside their own boundary.
     */
    if (deps.tab === 'forecast') {
      const site = sites.data.find((s) => s.id === deps.site)
      if (site) {
        void context.queryClient.prefetchQuery(
          astroQueries.horizon({ lat: site.lat, lon: site.lon }),
        )
        void context.queryClient.prefetchQuery(
          astroQueries.skyglow({ lat: site.lat, lon: site.lon, date: windowData.detail.date }),
        )
        void context.queryClient.prefetchQuery(astroQueries.visibility({ site: site.id }))
      }
    }
  },
  component: AstroWindowPage,
})

/**
 * A chart-level boundary must not swallow the error: the fallback tells the reader the data is
 * missing, this keeps the reason reachable in the console, the same sink `BasaltProvider`'s own
 * `onError` uses in `main.tsx`.
 */
function reportChartError(error: unknown, ctx: BasaltErrorContext): void {
  // eslint-disable-next-line no-console
  console.error('[astro-window]', ctx, error)
}

// ── Page component ─────────────────────────────────────────────────────────

function AstroWindowPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const params = useMemo<AstroWindowParams>(
    () => ({
      site: search.site,
      nights: Number(search.nights),
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
  /*
   * `site` from the MAP keeps a hand-written navigate, because picking a site there must also drop
   * `detailDate` — a store field's setter writes its own params and nothing else, so it cannot
   * clear a sibling key the store does not model. The bar's own site pill therefore leaves
   * `detailDate` standing; the API resolves an out-of-window date to the nearest night, so that is
   * a nuance rather than a break.
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

  const handleSelectDate = useCallback(
    (detailDate: string) => {
      void navigate({ to: '/astro-window', search: { ...search, detailDate } })
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

  const layers = useMemo<MapLayerState>(() => {
    const lp = parseLpParam(search.lp)
    const wx = parseWeatherParam(search.wx)
    return {
      base: search.base ?? schemeDefaultBase,
      lpYear: lp.year,
      lpOpacity: lp.opacity,
      lpResampling: lp.resampling,
      lpRange: lp.range,
      weather: wx.weather,
      omDomain: wx.omDomain,
      terrain: parseTerrainParam(search.terrain),
    }
  }, [search.base, search.lp, search.wx, search.terrain, schemeDefaultBase])

  const handleLayersChange = useCallback(
    (next: MapLayerState) => {
      void navigate({
        to: '/astro-window',
        search: {
          ...search,
          base: next.base === schemeDefaultBase ? undefined : next.base,
          lp: formatLpParam({
            year: next.lpYear,
            opacity: next.lpOpacity,
            resampling: next.lpResampling,
            range: next.lpRange,
          }),
          wx: formatWeatherParam({ weather: next.weather, omDomain: next.omDomain }),
          terrain: formatTerrainParam(next.terrain),
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
    <>
      <PageBar
        tabs={<ViewTabs field={astroStore.field.tab} label="View" />}
        filters={
          <FilterSet>
            {/* A `field.string` + a RUNTIME catalogue: the site list is fetched and each label
                carries live figures (`mag`, drive minutes), which no closed enum can express. */}
            <SelectFilter
              field={astroStore.field.site}
              label="Site"
              options={sites.data.map((s) => ({
                value: s.id,
                // The core direction, not the zenith: it is the number the ranking turns on.
                label: `${s.name} · ${s.coreDirectionMpsas.toFixed(2)} mag · ${s.driveMinutes}min`,
              }))}
            />
            <SelectFilter field={astroStore.field.nights} label="Nights" />
          </FilterSet>
        }
      />

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
                    {/*
                      Each chart owns its own Suspense AND error boundary. Both read upstreams
                      that legitimately 502 (the DEM bucket, the Lorenz atlas), and neither is
                      worth the rest of the page: a failed skyline should cost the panorama, not
                      the verdict above it.
                    */}
                    <BasaltErrorBoundary
                      onError={reportChartError}
                      fallback={
                        <ChartEmpty
                          height={PANORAMA_HEIGHT}
                          message="Terrain or sky-brightness data is unavailable for this site right now."
                        />
                      }
                    >
                      <Suspense
                        fallback={
                          <ChartEmpty height={PANORAMA_HEIGHT} message="Measuring the skyline…" />
                        }
                      >
                        <SkyPanorama
                          key={`${selectedSite.id}-${selectedDate}`}
                          site={selectedSite}
                          detailDate={selectedDate}
                          hourly={data.detail.hourly}
                          moonIllumination={selectedNight.moon.illumination}
                        />
                      </Suspense>
                    </BasaltErrorBoundary>
                    <BasaltErrorBoundary
                      onError={reportChartError}
                      fallback={
                        <ChartEmpty
                          height={CHART_HEIGHT}
                          message="The annual budget is unavailable for this site right now."
                        />
                      }
                    >
                      <Suspense
                        fallback={
                          <ChartEmpty height={CHART_HEIGHT} message="Integrating the year…" />
                        }
                      >
                        <MonthlyBudgetChart site={selectedSite} />
                      </Suspense>
                    </BasaltErrorBoundary>
                  </>
                ) : (
                  <ChartEmpty height={PANORAMA_HEIGHT} message="Unknown site" />
                )}
              </>
            )}
          </Stack>
        </Section>
      )}
    </>
  )
}
