import { FilterSet, SelectFilter } from 'basalt-ui/controls'
import { finStore } from '../../../lib/window-stores'
import { FinanceBar } from './finance-bar'
import { useMonthOptions } from './range-bar'

type Option = { value: string; label: string }

/** The transactions page bar: the month range plus the category and merchant filters. */
export function TransactionsBar({
  categories,
  merchants,
}: {
  categories: readonly Option[]
  merchants: readonly Option[]
}) {
  const months = useMonthOptions()
  return (
    <FinanceBar
      filters={
        <FilterSet>
          <SelectFilter label="From" field={finStore.field.from} options={months} clearable />
          <SelectFilter label="To" field={finStore.field.to} options={months} clearable />
          <SelectFilter
            label="Category"
            field={finStore.field.category}
            options={[...categories]}
            clearable
          />
          <SelectFilter
            label="Merchant"
            field={finStore.field.merchant}
            options={[...merchants]}
            clearable
          />
        </FilterSet>
      }
    />
  )
}
