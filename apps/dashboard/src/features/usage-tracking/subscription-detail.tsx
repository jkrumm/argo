import type { Range } from '../../lib/queries/usage'
import type { AccountId } from './accounts'

// Seam stub for usage v7 (Wave 8): the subscription node's detail (weekly quota, compared row, the
// picker's routing with its own `routingRange` store field), built by its own change. The props are the contract.
export interface SubscriptionDetailProps {
  account: AccountId
  range: Range
}

export function SubscriptionDetail(_props: SubscriptionDetailProps) {
  return null
}
