import { createFileRoute } from '@tanstack/react-router'
import { SpendingPage } from '../features/finance/pages/spending'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/spending')({
  validateSearch: finStore.validateSearch,
  component: SpendingPage,
})
