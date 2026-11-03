import { createFileRoute } from '@tanstack/react-router'
import { ReportPage } from '../features/finance/pages/report'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/')({
  validateSearch: finStore.validateSearch,
  component: ReportPage,
})
