import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { Stack } from '@mantine/core'
import { PageBar, Section } from 'basalt-ui'
import { FilterSet, RangeFilter } from 'basalt-ui/controls'
import { DateRangePicker } from 'basalt-ui/controls-dates'
import { bodyCompStore, toApiWindow } from '../lib/window-stores'
import { SkinfoldPanel, WeightPanel } from '../features/body-composition'
import { ChartSkeleton } from '../features/strength-tracker'
import { skinfoldLogQueries } from '../lib/queries/skinfold-log'
import { weightLogQueries } from '../lib/queries/weight-log'

// ── Route definition ───────────────────────────────────────────────────────

export const Route = createFileRoute('/body-composition')({
  validateSearch: bodyCompStore.validateSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => {
    // `toWindow` is the whole projection: every preset here is one the backend's
    // `WindowQuerySchema` accepts, so the field declares no `window:` resolvers, and `toApiWindow`
    // only folds the unreachable dateless-`custom` branch onto the API's own default.
    const params = toApiWindow(
      bodyCompStore.field.window.toWindow({ preset: deps.window, from: deps.from, to: deps.to }),
      '90d',
    )
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
  const search = bodyCompStore.useValues()
  const params = toApiWindow(
    bodyCompStore.field.window.toWindow({
      preset: search.window,
      from: search.from,
      to: search.to,
    }),
    '90d',
  )

  return (
    <>
      <PageBar
        filters={
          <FilterSet>
            <RangeFilter field={bodyCompStore.field.window} customPicker={DateRangePicker} />
          </FilterSet>
        }
      />

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
