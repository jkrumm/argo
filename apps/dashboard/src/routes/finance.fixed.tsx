import { createFileRoute } from '@tanstack/react-router'
import { FixedPage } from '../features/finance/pages/fixed'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/fixed')({
  validateSearch: finStore.validateSearch,
  component: FixedPage,
})
