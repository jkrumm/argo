import { createFileRoute } from '@tanstack/react-router'
import { ModelsPage } from '../features/models/models-page'
import { modelsStore } from '../lib/window-stores'

export const Route = createFileRoute('/models')({
  validateSearch: modelsStore.validateSearch,
  component: ModelsPage,
})
