import { createFileRoute } from '@tanstack/react-router'
import { LinePage } from '../features/line/line-page'
import { lineStore } from '../lib/window-stores'

export const Route = createFileRoute('/line')({
  validateSearch: lineStore.validateSearch,
  component: LinePage,
})
