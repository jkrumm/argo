import { createFileRoute } from '@tanstack/react-router'
import { EventsPage } from '../features/finance/pages/events'
import { finStore } from '../lib/window-stores'

export const Route = createFileRoute('/finance/events')({
  validateSearch: finStore.validateSearch,
  component: EventsPage,
})
