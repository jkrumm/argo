import { queryOptions } from '@tanstack/react-query'
import { FINANCE_DATA, FinanceApiError, financeGet } from './client'
import type { IngReadDue } from './types'

/** `GET /api/depot/read-due`: whether ING announced Post-Box documents since the last supervised read. 423 while locked; the layout handles that. */
export const readDueOptions = queryOptions({
  queryKey: [...FINANCE_DATA, 'read-due'],
  queryFn: () => financeGet<IngReadDue>('/depot/read-due'),
  staleTime: 60_000,
  retry: (failures, error) => !(error instanceof FinanceApiError) && failures < 2,
})
