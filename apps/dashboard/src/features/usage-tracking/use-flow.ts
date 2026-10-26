import { useSuspenseQuery } from '@tanstack/react-query'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type FlowResponse, type Range } from '../../lib/queries/usage'
import type { UsageLens, UsageScope } from '../../lib/window-stores'
import { flowLensOf, scopePayers } from './budget-model'
import type { WorkspaceValue } from './types'

const EMPTY_FLOW: FlowResponse = { total: 0, rows: [] }

/** The flow response one lens reads: shared by section B and C through one query key. */
export function useFlow(input: {
  range: Range
  lens: UsageLens
  scope: UsageScope
  workspace: WorkspaceValue[] | undefined
}) {
  const query = useSuspenseQuery(
    usageQueries.flow({
      range: input.range,
      lens: flowLensOf(input.lens),
      payer: scopePayers(input.scope),
      workspace: input.workspace,
    }),
  )
  return shotState() === 'empty' ? EMPTY_FLOW : query.data
}
