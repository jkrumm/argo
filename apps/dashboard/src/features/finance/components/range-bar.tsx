import { FilterSet, SelectFilter } from 'basalt-ui/controls'
import { useMeta } from '../api/queries'
import { monthLabel, monthsBetween } from '../lib/months'
import { finStore } from '../../../lib/window-stores'
import { FinanceBar } from './finance-bar'

/** The months the vault has data for, newest first: the options of both range selects. */
export function useMonthOptions() {
  const meta = useMeta()
  const { first_month: first, last_month: last } = meta.data ?? {}
  return first == null || last == null
    ? []
    : monthsBetween(first, last)
        .toReversed()
        .map((value) => ({ value, label: monthLabel(value) }))
}

/** The global month range every page shares; the options are the months the vault has data for. */
export function RangeBar() {
  const options = useMonthOptions()
  return (
    <FinanceBar
      filters={
        <FilterSet>
          <SelectFilter label="From" field={finStore.field.from} options={options} clearable />
          <SelectFilter label="To" field={finStore.field.to} options={options} clearable />
        </FilterSet>
      }
    />
  )
}
