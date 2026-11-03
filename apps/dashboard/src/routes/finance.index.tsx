import { createFileRoute } from '@tanstack/react-router'
import { ThisMonthPage } from '../features/finance/pages/this-month'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/')({
  validateSearch: finStore.validateSearch,
  component: ThisMonthPage,
})
