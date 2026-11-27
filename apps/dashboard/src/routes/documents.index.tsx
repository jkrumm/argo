import { createFileRoute } from '@tanstack/react-router'
import { DocumentsIndexPage } from '../features/documents/library/index-page'
import { documentsStore } from '../lib/window-stores'

export const Route = createFileRoute('/documents/')({
  validateSearch: documentsStore.validateSearch,
  component: DocumentsIndexPage,
})
