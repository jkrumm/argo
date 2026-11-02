import type { ReactNode } from 'react'
import type { FlowNode } from './flow-node'

export interface NodeSlot {
  /** The selected node, null for none. */
  node: FlowNode | null
  /** On a phone the detail opens under the node's own card: the element to place there, else null. */
  detail: ReactNode | null
}

/** The detail, when it belongs under a card of these kinds. */
export const under = (slot: NodeSlot, kinds: readonly FlowNode['kind'][]): ReactNode =>
  slot.node !== null && slot.detail !== null && kinds.includes(slot.node.kind) ? slot.detail : null
