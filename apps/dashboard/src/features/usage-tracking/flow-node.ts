/**
 * The Flow tab's selected node, as the `?node=` search value reads it: `pool:iu`, `sub:me`,
 * `key:personal`, `router`, `demand:review`, or empty for none. A dependency-free leaf (the search
 * store imports it), so the string form, its parser and the retired-tab migration live in one place.
 */
import { ACCOUNT_IDS, IU_KEY_IDS, type AccountId, type IuKeyId } from './accounts'

export type FlowNode =
  | { kind: 'pool'; account: AccountId }
  | { kind: 'sub'; account: AccountId }
  | { kind: 'key'; iuKey: IuKeyId }
  | { kind: 'router' }
  | { kind: 'demand'; workflow: string }

export const NO_NODE = ''

export const poolNode = (account: AccountId): string => `pool:${account}`
export const subNode = (account: AccountId): string => `sub:${account}`
export const keyNode = (iuKey: IuKeyId): string => `key:${iuKey}`
export const ROUTER_NODE = 'router'
export const demandNode = (workflow: string): string => `demand:${workflow}`

const accountOf = (value: string): AccountId | null =>
  ACCOUNT_IDS.find((id) => id === value) ?? null
const keyOf = (value: string): IuKeyId | null => IU_KEY_IDS.find((id) => id === value) ?? null

/** A search value as a node; anything malformed or no longer in the registry reads as no node. */
export function parseNode(raw: string): FlowNode | null {
  if (raw === ROUTER_NODE) return { kind: 'router' }
  const at = raw.indexOf(':')
  if (at < 0) return null
  const head = raw.slice(0, at)
  const rest = raw.slice(at + 1)
  if (rest === '') return null
  if (head === 'demand') return { kind: 'demand', workflow: rest }
  if (head === 'pool' || head === 'sub') {
    const account = accountOf(rest)
    return account === null ? null : { kind: head, account }
  }
  if (head === 'key') {
    const iuKey = keyOf(rest)
    return iuKey === null ? null : { kind: 'key', iuKey }
  }
  return null
}

/** The value a node writes to `?node=`. */
export function nodeValue(node: FlowNode): string {
  switch (node.kind) {
    case 'pool':
      return poolNode(node.account)
    case 'sub':
      return subNode(node.account)
    case 'key':
      return keyNode(node.iuKey)
    case 'router':
      return ROUTER_NODE
    case 'demand':
      return demandNode(node.workflow)
  }
}

/** Clicking the selected node again closes its detail. */
export const toggleNode = (current: string, next: string): string =>
  current === next ? NO_NODE : next

/** The retired tab values (v6) and the Flow node each one opened. */
export type LegacyView = 'overview' | 'claude' | 'iu-api' | 'credits' | 'iu-sub' | 'me-sub'

/**
 * The node a retired tab selects: Claude Max its subscription (`account` from an old URL, else the
 * first), IU API its key, Credits the IU pool, the per-subscription tabs their account; Overview none.
 */
export function legacyNode(
  view: LegacyView,
  legacy: { account?: unknown; iuKey?: unknown } = {},
): string {
  switch (view) {
    case 'overview':
      return NO_NODE
    case 'credits':
      return poolNode('iu')
    case 'iu-sub':
      return subNode('iu')
    case 'me-sub':
      return subNode('me')
    case 'claude': {
      const account = typeof legacy.account === 'string' ? accountOf(legacy.account) : null
      return subNode(account ?? 'iu')
    }
    case 'iu-api': {
      const iuKey = typeof legacy.iuKey === 'string' ? keyOf(legacy.iuKey) : null
      return keyNode(iuKey ?? 'personal')
    }
  }
}
