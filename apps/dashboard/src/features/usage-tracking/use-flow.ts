import { useSuspenseQuery } from '@tanstack/react-query'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type FlowResponse, type Range } from '../../lib/queries/usage'
import type { UsageLens } from '../../lib/window-stores'
import type { WorkspaceValue } from './types'

const EMPTY_FLOW: FlowResponse = { total: 0, rows: [] }

/** The IU API's flow response one lens reads: shared by both IU API detail lists through one query key. */
export function useFlow(input: {
  range: Range
  lens: UsageLens
  workspace: WorkspaceValue[] | undefined
}) {
  const query = useSuspenseQuery(
    usageQueries.flow({
      range: input.range,
      lens: input.lens,
      payer: ['iu-api'],
      workspace: input.workspace,
    }),
  )
  return shotState() === 'empty' ? EMPTY_FLOW : query.data
}
