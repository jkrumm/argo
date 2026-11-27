import { createFileRoute } from '@tanstack/react-router'
import { ReviewPage } from '../features/documents/review/review-page'

export const Route = createFileRoute('/documents/review')({ component: ReviewPage })
