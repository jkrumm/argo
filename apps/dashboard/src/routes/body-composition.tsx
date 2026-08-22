import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Suspense, useCallback, useMemo } from 'react'
import { Group, Stack } from '@mantine/core'
import { z } from 'zod'
import { bodyCompWindowStore } from '../lib/window-stores'
import { PageActions } from 'basalt-ui'
import {
  presetToParams,
  Section,
  SkinfoldPanel,
  WeightPanel,
  WINDOW_PRESET_VALUES,
  WindowSelector,
  type SummaryParams,
  type WindowPreset,
} from '../features/body-composition'
import { ChartSkeleton } from '../features/strength-tracker'
import { skinfoldLogQueries } from '../lib/queries/skinfold-log'
import { weightLogQueries } from '../lib/queries/weight-log'

// ── Search params ──────────────────────────────────────────────────────────

const PresetEnum = z.enum(WINDOW_PRESET_VALUES)

const SearchSchema = z.object({
  window: PresetEnum.default('90d'),
  from: z.string().optional(),
  to: z.string().optional(),
})

type SearchParams = z.infer<typeof SearchSchema>

function resolveWindow(search: SearchParams): SummaryParams {
  if (search.from !== undefined && search.to !== undefined) {
    return { from: search.from, to: search.to }
  }
  return presetToParams(search.window)
}

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/body-composition')({
  // An absent `?window=` falls back to the last preset this page was left on
  // (`bodyCompWindowStore`, basalt's search-param store) before zod's own schema default —
  // `lib/nav.tsx`'s click-time thunk reads the same value, so the two cannot disagree.
  validateSearch: (raw: Record<string, unknown>) =>
    SearchSchema.parse({
      ...raw,
      window: raw['window'] ?? bodyCompWindowStore.readStored() ?? undefined,
    }),
  loaderDeps: ({ search }: { search: SearchParams }) => ({
    window: search.window,
    from: search.from,
    to: search.to,
  }),
  loader: ({ context, deps }) => {
    const params = resolveWindow(deps as SearchParams)
    return Promise.all([
      context.queryClient.ensureQueryData(weightLogQueries.summary(params)),
      context.queryClient.ensureQueryData(weightLogQueries.series(params)),
      context.queryClient.ensureQueryData(skinfoldLogQueries.summary(params)),
      context.queryClient.ensureQueryData(skinfoldLogQueries.series(params)),
    ])
  },
  component: BodyCompositionPage,
})

// ── Page component ─────────────────────────────────────────────────────────

function BodyCompositionPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  const params = useMemo<SummaryParams>(() => resolveWindow(search), [search])

  const handlePresetChange = useCallback(
    (preset: WindowPreset) => {
      void navigate({
        to: '/body-composition',
        search: { window: preset, from: undefined, to: undefined },
      })
    },
    [navigate],
  )

  const handleRangeChange = useCallback(
    (from: string | undefined, to: string | undefined) => {
      void navigate({
        to: '/body-composition',
        search: { window: search.window, from, to },
      })
    },
    [navigate, search.window],
  )

  return (
    <>
      {/* Page controls live in the shared top-bar slot; the breadcrumb names the page. */}
      <PageActions>
        <Group gap="sm" wrap="nowrap">
          <WindowSelector
            preset={search.window}
            from={search.from}
            to={search.to}
            onPresetChange={handlePresetChange}
            onRangeChange={handleRangeChange}
          />
        </Group>
      </PageActions>

      <Stack gap="md">
        <Section title="Body Weight" subtitle="Am I trending toward my goal?">
          <Suspense fallback={<ChartSkeleton height={420} />}>
            <WeightPanel params={params} />
          </Suspense>
        </Section>

        <Section title="Skinfold / Belly Fat" subtitle="Am I trending leaner?">
          <Suspense fallback={<ChartSkeleton height={420} />}>
            <SkinfoldPanel params={params} />
          </Suspense>
        </Section>
      </Stack>
    </>
  )
}
