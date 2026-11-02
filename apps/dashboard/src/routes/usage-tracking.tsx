import { createFileRoute } from '@tanstack/react-router'
import { PageBar } from 'basalt-ui'
import { FilterSet, MultiSelectFilter, SelectFilter, ViewTabs } from 'basalt-ui/controls'
import { usageQueries } from '../lib/queries/usage'
import {
  USAGE_TAB_VALUES,
  migrateUsageSearch,
  usageStore,
  validateUsageSearch,
} from '../lib/window-stores'
import { ExploreTab } from '../features/usage-tracking/explore-tab'
import { FlowTab } from '../features/usage-tracking/flow-tab'
import { pickOptions } from '../features/usage-tracking/pick-options'

export const Route = createFileRoute('/usage-tracking')({
  // The store's validator, then the v6 tab values folded into Flow (with their node selected).
  validateSearch: validateUsageSearch,
  // The verdict is the first thing painted; everything below streams behind Suspense.
  loader: ({ context }) => context.queryClient.ensureQueryData(usageQueries.pace()),
  component: UsageTrackingPage,
})

function UsageTrackingPage() {
  // A retired tab value in storage reads as Flow with its node, whichever lane supplied it.
  const search = migrateUsageSearch(usageStore.useValues())
  // An EMPTY workspace selection means "no constraint": the API wants the key absent, not `[]`.
  const workspace = search.workspace.length > 0 ? [...search.workspace] : undefined
  const explore = search.view === 'explore'

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
            {explore ? (
              <>
                <SelectFilter field={usageStore.field.lens} label="Measure" />
                <SelectFilter field={usageStore.field.grain} label="Grain" />
                <MultiSelectFilter
                  field={usageStore.field.workspace}
                  label="All workspaces"
                  noun="workspaces"
                />
                <MultiSelectFilter
                  field={usageStore.field.payer}
                  label="All payers"
                  noun="payers"
                />
              </>
            ) : null}
          </FilterSet>
        }
      />

      {explore ? (
        <ExploreTab
          range={search.range}
          grain={search.grain}
          lens={search.lens}
          groupBy={search.groupBy}
          workspace={workspace}
          payer={search.payer}
        />
      ) : (
        <FlowTab range={search.range} node={search.node} />
      )}
    </>
  )
}
