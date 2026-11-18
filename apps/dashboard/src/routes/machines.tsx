import { createFileRoute } from '@tanstack/react-router'
import { MachinesPage } from '../features/machines/machines-page'
import { machinesStore } from '../lib/window-stores'

export const Route = createFileRoute('/machines')({
  validateSearch: machinesStore.validateSearch,
  component: MachinesPage,
})
