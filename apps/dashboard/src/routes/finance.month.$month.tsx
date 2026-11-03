import { createFileRoute } from '@tanstack/react-router'
import { MonthPage } from '../features/finance/pages/month'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/month/$month')({
  validateSearch: finStore.validateSearch,
  component: function FinanceMonthRoute() {
    const { month } = Route.useParams()
    return <MonthPage month={month} />
  },
})
