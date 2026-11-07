/**
 * The Quotas tab's selected node (inside "Routing and demand"), as the `?node=` search value reads it:
 * `router`, `demand:review`, or empty for none. The retired `pool:`, `sub:` and `key:` values (the old
 * Supply column) read as no node. A dependency-free leaf (the search store imports it), so the string
 * form and its parser live in one place.
 */
export type FlowNode = { kind: 'router' } | { kind: 'demand'; workflow: string }

export const NO_NODE = ''

export const ROUTER_NODE = 'router'
export const demandNode = (workflow: string): string => `demand:${workflow}`

/** A search value as a node; anything malformed or retired reads as no node. */
export function parseNode(raw: string): FlowNode | null {
  if (raw === ROUTER_NODE) return { kind: 'router' }
  const at = raw.indexOf(':')
  if (at < 0) return null
  const head = raw.slice(0, at)
  const rest = raw.slice(at + 1)
  if (rest === '') return null
  if (head === 'demand') return { kind: 'demand', workflow: rest }
  return null
}

/** The value a node writes to `?node=`. */
export function nodeValue(node: FlowNode): string {
  switch (node.kind) {
    case 'router':
      return ROUTER_NODE
    case 'demand':
      return demandNode(node.workflow)
  }
}

/** Clicking the selected node again closes its detail. */
export const toggleNode = (current: string, next: string): string =>
  current === next ? NO_NODE : next

/** The retired tab values (v6): still accepted from an old URL, then folded into Flow without a node. */
export type LegacyView = 'overview' | 'claude' | 'iu-api' | 'credits' | 'iu-sub' | 'me-sub'
