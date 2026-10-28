import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { PageBar } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, MultiSelectFilter, SelectFilter, ViewTabs } from 'basalt-ui/controls'
import { usageQueries } from '../lib/queries/usage'
import {
  USAGE_TAB_VALUES,
  migrateUsageSearch,
  usageStore,
  validateUsageSearch,
} from '../lib/window-stores'
import { ClaudeTab } from '../features/usage-tracking/claude-tab'
import { IuApiTab } from '../features/usage-tracking/iu-api-tab'
import { Overview } from '../features/usage-tracking/overview'
import { pickOptions } from '../features/usage-tracking/pick-options'

export const Route = createFileRoute('/usage-tracking')({
  // The store's validator, then the retired per-subscription tabs folded into Claude Max.
  validateSearch: validateUsageSearch,
  // The personal IU cap is the first thing the wallet cards paint; everything below streams behind Suspense.
  loader: ({ context }) => context.queryClient.ensureQueryData(usageQueries.iuBudget('personal')),
  component: UsageTrackingPage,
})

function UsageTrackingPage() {
  // A retired tab value in storage reads as Claude Max with its account, whichever lane supplied it.
  const search = migrateUsageSearch(usageStore.useValues())
  // An EMPTY workspace selection means "no constraint": the API wants the key absent, not `[]`.
  const workspace = search.workspace.length > 0 ? [...search.workspace] : undefined

  return (
    <>
      <PageBar
        tabs={
          <ViewTabs
            field={usageStore.field.view}
            options={pickOptions(usageStore.field.view.options, USAGE_TAB_VALUES)}
            label="View"
          />
        }
        filters={
          <FilterSet>
            <SelectFilter field={usageStore.field.range} label="Range" />
            <SelectFilter field={usageStore.field.lens} label="Measure" />
            {search.view === 'overview' ? null : (
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
        {search.view === 'claude' ? (
          <ClaudeTab
            account={search.account}
            range={search.range}
            grain={search.grain}
            lens={search.lens}
            groupBy={search.groupBy}
            workspace={workspace}
          />
        ) : search.view === 'iu-api' ? (
          <IuApiTab
            iuKey={search.iuKey}
            range={search.range}
            grain={search.grain}
            lens={search.lens}
            groupBy={search.groupBy}
            workspace={workspace}
          />
        ) : (
          <Overview range={search.range} lens={search.lens} workspace={workspace} />
        )}
      </Suspense>
    </>
  )
}
