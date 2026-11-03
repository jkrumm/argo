import { createFileRoute } from '@tanstack/react-router'
import { TaxPage } from '../features/finance/pages/tax'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/tax')({
  validateSearch: finStore.validateSearch,
  component: TaxPage,
})
