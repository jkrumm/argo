import { createFileRoute } from '@tanstack/react-router'
import { TransactionsPage } from '../features/finance/pages/transactions'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/transactions')({
  validateSearch: finStore.validateSearch,
  component: TransactionsPage,
})
