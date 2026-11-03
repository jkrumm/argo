import { createFileRoute } from '@tanstack/react-router'
import { RecurringPage } from '../features/finance/pages/recurring'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/recurring')({
  validateSearch: finStore.validateSearch,
  component: RecurringPage,
})
