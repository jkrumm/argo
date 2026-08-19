import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo } from 'react'
import { Box, Grid, Stack } from '@mantine/core'
import { z } from 'zod'
import { usageQueries } from '../lib/queries/usage'
import { PageActions } from 'basalt-ui'
import { FilterBar } from '../features/usage-tracking/filter-bar'
import { HeroStats } from '../features/usage-tracking/hero-stats'
import { Section } from '../features/usage-tracking/section'
import CostOverTime from '../features/usage-tracking/charts/cost-over-time'
import TokensOverTime from '../features/usage-tracking/charts/tokens-over-time'
import CacheHitRatio from '../features/usage-tracking/charts/cache-hit-ratio'
import ErrorRate from '../features/usage-tracking/charts/error-rate'
import LatencyP95 from '../features/usage-tracking/charts/latency-p95'
import BillingSplit from '../features/usage-tracking/charts/billing-split'
import TopProjects from '../features/usage-tracking/charts/top-projects'
import type {
  BillingValue,
  CostGroupBy,
  TokensGroupBy,
  UsageSearch,
  WorkspaceValue,
} from '../features/usage-tracking/types'

function ChartFallback({ height = 280 }: { height?: number }) {
  return <Box h={height} w="100%" />
}

const RangeEnum = z.enum(['7d', '30d', '90d', 'all'])
const GrainEnum = z.enum(['day', 'week'])
const BillingValueEnum = z.enum(['max', 'iu', 'unknown'])
const WorkspaceValueEnum = z.enum(['work', 'private'])
const CostGroupByEnum = z.enum(['source', 'machine', 'billing'])
const TokensGroupByEnum = z.enum(['sub_tool', 'model_norm', 'project', 'source'])

const SearchSchema = z.object({
  range: RangeEnum.default('30d'),
  grain: GrainEnum.default('day'),
  sources: z.array(z.string()).optional(),
  machines: z.array(z.string()).optional(),
  billing: z.array(BillingValueEnum).optional(),
  workspace: z.array(WorkspaceValueEnum).optional(),
  costGroupBy: CostGroupByEnum.default('source'),
  tokensGroupBy: TokensGroupByEnum.default('sub_tool'),
})

type SearchParams = z.infer<typeof SearchSchema>

export const Route = createFileRoute('/usage-tracking')({
  validateSearch: (raw: Record<string, unknown>) => SearchSchema.parse(raw),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    range: search.range,
    grain: search.grain,
    billing: search.billing,
    workspace: search.workspace,
    costGroupBy: search.costGroupBy,
    tokensGroupBy: search.tokensGroupBy,
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(usageQueries.headline()),
  component: UsageTrackingPage,
})

function UsageTrackingPage() {
  const search: UsageSearch = Route.useSearch()
  const navigate = useNavigate()

  const patch = useCallback(
    (next: Partial<UsageSearch>) => {
      void navigate({
        to: '/usage-tracking',
        search: { ...search, ...next },
      })
    },
    [navigate, search],
  )

  const onRangeChange = useCallback((r: SearchParams['range']) => patch({ range: r }), [patch])
  const onGrainChange = useCallback((g: SearchParams['grain']) => patch({ grain: g }), [patch])
  const onBillingChange = useCallback(
    (b: BillingValue[] | undefined) => patch({ billing: b }),
    [patch],
  )
  const onWorkspaceChange = useCallback(
    (w: WorkspaceValue[] | undefined) => patch({ workspace: w }),
    [patch],
  )
  const onCostGroupBy = useCallback((g: CostGroupBy) => patch({ costGroupBy: g }), [patch])
  const onTokensGroupBy = useCallback((g: TokensGroupBy) => patch({ tokensGroupBy: g }), [patch])

  const range = search.range
  const grain = search.grain
  const billing = search.billing
  const workspace = search.workspace

  const tsBase = useMemo(
    () => ({ range, grain, billing, workspace }),
    [range, grain, billing, workspace],
  )

  return (
    <>
      {/* Page controls live in the shared top-bar slot; the breadcrumb names the page. */}
      <PageActions>
        <FilterBar
          range={search.range}
          grain={search.grain}
          billing={search.billing}
          workspace={search.workspace}
          onRangeChange={onRangeChange}
          onGrainChange={onGrainChange}
          onBillingChange={onBillingChange}
          onWorkspaceChange={onWorkspaceChange}
        />
      </PageActions>

      <Stack gap="md">
        <HeroStats />

        <Section title="Cost">
          <Grid>
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Suspense fallback={<ChartFallback />}>
                <CostOverTime
                  {...tsBase}
                  groupBy={search.costGroupBy}
                  onGroupByChange={onCostGroupBy}
                />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Suspense fallback={<ChartFallback />}>
                <BillingSplit range={range} workspace={workspace} />
              </Suspense>
            </Grid.Col>
          </Grid>
        </Section>

        <Section title="Volume">
          <Grid>
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <Suspense fallback={<ChartFallback />}>
                <TokensOverTime
                  {...tsBase}
                  groupBy={search.tokensGroupBy}
                  onGroupByChange={onTokensGroupBy}
                />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Suspense fallback={<ChartFallback height={240} />}>
                <CacheHitRatio {...tsBase} />
              </Suspense>
            </Grid.Col>
          </Grid>
        </Section>

        <Section title="Health">
          <Grid>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Suspense fallback={<ChartFallback height={240} />}>
                <ErrorRate {...tsBase} />
              </Suspense>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Suspense fallback={<ChartFallback height={240} />}>
                <LatencyP95 {...tsBase} />
              </Suspense>
            </Grid.Col>
          </Grid>
        </Section>

        <Section title="Top projects">
          <Suspense fallback={<ChartFallback height={280} />}>
            <TopProjects range={range} billing={billing} workspace={workspace} />
          </Suspense>
        </Section>
      </Stack>
    </>
  )
}
