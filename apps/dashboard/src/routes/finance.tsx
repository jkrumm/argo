import { createFileRoute } from '@tanstack/react-router'
import { FinanceLayout } from '../features/finance/finance-layout'

// Layout route of the finance section: the lock gate and the status polling wrap every child page.
export const Route = createFileRoute('/finance')({ component: FinanceLayout })
