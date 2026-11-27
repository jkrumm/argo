import { createFileRoute } from '@tanstack/react-router'
import { DocumentPage } from '../features/documents/library/document-page'

export const Route = createFileRoute('/documents/$id')({ component: DocumentRoute })

function DocumentRoute() {
  const { id } = Route.useParams()
  return <DocumentPage id={id} />
}
