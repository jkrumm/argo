import { createFileRoute } from '@tanstack/react-router'
import { ScanPage } from '../features/documents/scan/scan-page'

export const Route = createFileRoute('/documents/scan')({ component: ScanPage })
