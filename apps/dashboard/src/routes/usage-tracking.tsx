import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { PageBar } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, SelectFilter, ViewTabs } from 'basalt-ui/controls'
import { usageQueries } from '../lib/queries/usage'
import { usageStore } from '../lib/window-stores'
import { walletOf } from '../features/usage-tracking/accounts'
import { Overview } from '../features/usage-tracking/overview'
import { WalletTab } from '../features/usage-tracking/wallet-tab'

export const Route = createFileRoute('/usage-tracking')({
  validateSearch: usageStore.validateSearch,
  // The IU cap is the first thing the wallet cards paint; everything below streams behind Suspense.
  loader: ({ context }) => context.queryClient.ensureQueryData(usageQueries.iuBudget()),
  component: UsageTrackingPage,
})

function UsageTrackingPage() {
  const search = usageStore.useValues()
  // An EMPTY workspace selection means "no constraint": the API wants the key absent, not `[]`.
  const workspace = search.workspace.length > 0 ? [...search.workspace] : undefined
  const wallet = walletOf(search.view)

  return (
    <>
      <PageBar
        tabs={<ViewTabs field={usageStore.field.view} label="View" />}
        filters={
          <FilterSet>
            <SelectFilter field={usageStore.field.range} label="Range" />
            <SelectFilter field={usageStore.field.lens} label="Measure" />
            {wallet === undefined ? null : (
              <SelectFilter field={usageStore.field.grain} label="Grain" />
            )}
            <MultiSelectFilter
              field={usageStore.field.workspace}
              label="All workspaces"
              noun="workspaces"
            />
          </FilterSet>
        }
      />

      <Suspense fallback={<ChartCard state={{ pending: true }} placeholderHeight={420} />}>
        {wallet === undefined ? (
          <Overview range={search.range} lens={search.lens} workspace={workspace} />
        ) : (
          <WalletTab
            wallet={wallet}
            range={search.range}
            grain={search.grain}
            lens={search.lens}
            groupBy={search.groupBy}
            workspace={workspace}
          />
        )}
      </Suspense>
    </>
  )
}
