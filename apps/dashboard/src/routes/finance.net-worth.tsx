import { createFileRoute } from '@tanstack/react-router'
import { NetWorthPage } from '../features/finance/pages/net-worth'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/net-worth')({
  validateSearch: finStore.validateSearch,
  component: NetWorthPage,
})
