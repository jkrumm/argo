import { createFileRoute } from '@tanstack/react-router'
import { DepotPage } from '../features/finance/pages/depot'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/depot')({
  validateSearch: finStore.validateSearch,
  component: DepotPage,
})
