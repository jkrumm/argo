import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconPlus } from '@tabler/icons-react'
import { PageBar } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { overlays } from 'basalt-ui/commands'
import { FilterSet, RangeFilter } from 'basalt-ui/controls'
import { DateRangePicker } from 'basalt-ui/controls-dates'
import { bodyCompStore, toApiWindow } from '../lib/window-stores'
import { BodyCompositionPage as BodyComposition } from '../features/body-composition'
import { skinfoldLogQueries } from '../lib/queries/skinfold-log'
import { userProfileQueries } from '../lib/queries/user-profile'
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
      context.queryClient.ensureQueryData(userProfileQueries.detail()),
    ])
  },
  component: BodyCompositionRoute,
})

// ── Page component ─────────────────────────────────────────────────────────

function BodyCompositionRoute() {
  const search = bodyCompStore.useValues()
  const params = toApiWindow(
    bodyCompStore.field.window.toWindow({
      preset: search.window,
      from: search.from,
      to: search.to,
    }),
    '90d',
  )

  const { data: summary } = useQuery(weightLogQueries.summary(params))
  const lastWeight = summary?.current ?? null

  return (
    <>
      <PageBar
        actions={[
          {
            key: 'log-weight',
            label: 'Log weight',
            icon: <IconPlus size={14} />,
            primary: true,
            onClick: () => overlays.open('body-comp:log-weight', { lastWeight }),
          },
          {
            key: 'log-skinfold',
            label: 'Log skinfold',
            onClick: () => overlays.open('body-comp:log-skinfold', {}),
          },
        ]}
        filters={
          <FilterSet>
            <RangeFilter field={bodyCompStore.field.window} customPicker={DateRangePicker} />
          </FilterSet>
        }
      />

      <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={280} />}>
        <BodyComposition params={params} />
      </Suspense>
    </>
  )
}
