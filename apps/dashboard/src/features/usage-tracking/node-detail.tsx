/** The selected node's detail, by kind: the three Flow details of this tab and the two seam components. */
import type { Range } from '../../lib/queries/usage'
import type { FlowNode } from './flow-node'
import { IuKeyDetail } from './iu-key-detail'
import { PoolDetail } from './pool-detail'
import { RouterDetail } from './router-detail'
import { SubscriptionDetail } from './subscription-detail'
import { WorkflowDetail } from './workflow-detail'

export function NodeDetail({ node, range }: { node: FlowNode; range: Range }) {
  switch (node.kind) {
    case 'pool':
      return <PoolDetail account={node.account} range={range} />
    case 'sub':
      return <SubscriptionDetail account={node.account} range={range} />
    case 'key':
      return <IuKeyDetail iuKey={node.iuKey} range={range} />
    case 'router':
      return <RouterDetail range={range} />
    case 'demand':
      return <WorkflowDetail workflow={node.workflow} range={range} />
  }
}
