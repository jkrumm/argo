/** The selected node's detail, by kind: the router's and a demand workflow's. */
import type { Range } from '../../lib/queries/usage'
import type { FlowNode } from './flow-node'
import { RouterDetail } from './router-detail'
import { WorkflowDetail } from './workflow-detail'

export function NodeDetail({ node, range }: { node: FlowNode; range: Range }) {
  switch (node.kind) {
    case 'router':
      return <RouterDetail range={range} />
    case 'demand':
      return <WorkflowDetail workflow={node.workflow} range={range} />
  }
}
