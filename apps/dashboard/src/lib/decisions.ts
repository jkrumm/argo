import { capFacts, type DecisionCardFact } from '../components/upstream/decision-card-model'
import {
  AWAITING_OWNER_STALE_DAYS,
  deriveAwaitingOwner,
  isSafeHttpUrl,
  waitingOnOwner,
  type AwaitingOwnerRow,
} from '../features/warden/model'
import {
  recentTransitions,
  wardenAsk,
  type AskSource,
  type QueueKind,
  type TransitionHistory,
} from '../features/warden/page-model'
import {
  agentCopy,
  blockerEvidence,
  clockMs,
  evidenceSource,
  flattenAgents,
  humanQueueCopy,
  isAbandonedWait,
  type AgentRow,
} from '../features/agents/model'
import { resolveCopies, type CardCopy, type Disambiguation } from './question-copy'
import { formatAgo, formatDuration, withUnit } from './format'
import { asText } from './text'
import type { HumanQueueItem, OverviewSnapshot } from './queries/agents'
import type { WardenRaw } from './queries/warden'

// The ONE merged inbox: everything that waits on the owner, from Warden and from the agent fleet.
// The Home heading count, the summary sentence and the cards all read `decisions.length` of one
// `deriveDecisions` call, so they cannot disagree. Pure and React-free; the pages do not consume it
// yet (they keep their own lists and filter by `source` once they migrate).

const DAY_MS = 86_400_000

export type DecisionSource = 'warden' | 'queue' | 'agent'

export type Decision = {
  source: DecisionSource
  /** Unique across sources (`warden-12`, `queue-abc`, `agent-xyz`). */
  id: string
  /** The question the owner answers: short (a long ask becomes `Approve <title>?`). */
  headline: string
  /** The item the question is about, when the headline does not already name it. */
  entity: string | null
  /** `warden · <repo>` / `queue · <host>` / `agent · <project>` first, then the age: at most 3. */
  facts: DecisionCardFact[]
  /** One line of evidence, the lead of the reason or command; `null` when there is none. */
  evidenceLine: string | null
  /** The whole ask/reason, only when `evidenceLine` had to shorten it. */
  detail: string | null
  /** How long it has waited, by the source's own clock; `null` when the source reports none. */
  ageMs: number | null
  /** The page that owns the full item. */
  href: '/warden' | '/agents'
  /** The command, blocker or PR link behind the question, when the source carries one. */
  evidence: string | null
  /** Where a Warden item has been, newest last; empty for every other source. */
  history: TransitionHistory
  /** Past 7 days an agent wait is abandoned rather than live. */
  abandoned: boolean
}

export type DecisionInput = {
  warden: WardenRaw | null | undefined
  agents: OverviewSnapshot | null | undefined
  /** When the Warden snapshot reached Argo: its `age_days` is as of the push, so the age since then is added. */
  wardenReceivedAt?: string | null | undefined
  now: number
}

const parseMs = (iso: unknown): number | null => {
  if (typeof iso !== 'string' || iso === '') return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

type Entry =
  | { source: 'warden'; row: AwaitingOwnerRow; kind: QueueKind }
  | { source: 'queue'; item: HumanQueueItem }
  | { source: 'agent'; agent: AgentRow }

type Derived = {
  copy: CardCopy
  repo?: string
  repoNamed?: boolean
}

function idOf(entry: Entry): string {
  switch (entry.source) {
    case 'warden':
      return `warden-${entry.row.eventId}`
    case 'queue':
      return `queue-${asText(entry.item.id)}`
    case 'agent':
      return `agent-${asText(entry.agent.id)}`
  }
}

function entriesOf(
  raw: WardenRaw | null | undefined,
  snapshot: OverviewSnapshot | null | undefined,
): Entry[] {
  // One list, the one the Warden page counts from: decisions, unknown states, then failed items.
  const warden = raw?.board
    ? waitingOnOwner(deriveAwaitingOwner(raw.board, raw.items)).map((row): Entry => ({
        source: 'warden',
        row,
        kind: row.state === 'failed' ? 'failed' : 'decision',
      }))
    : []
  if (!snapshot) return warden
  const asks = (snapshot.humanQueue ?? []).map((item): Entry => ({ source: 'queue', item }))
  const agents = flattenAgents(snapshot)
    .filter((a) => a.state === 'needs_you')
    .map((agent): Entry => ({ source: 'agent', agent }))
  return [...warden, ...asks, ...agents]
}

function derive(entry: Entry, options: { handle: Disambiguation | null }): Derived {
  if (entry.source === 'warden') {
    const { row, kind } = entry
    const { copy, repo, repoNamed } = wardenAsk(row as AskSource, kind, options)
    return { copy, repo, repoNamed }
  }
  if (entry.source === 'queue') return { copy: humanQueueCopy(entry.item, options).copy }
  return { copy: agentCopy(entry.agent, blockerEvidence(entry.agent), options) }
}

function toDecision(
  entry: Entry,
  { copy, repo = '', repoNamed = false }: Derived,
  { raw, now, sincePush }: { raw: WardenRaw | null | undefined; now: number; sincePush: number },
): Decision {
  const base = {
    id: idOf(entry),
    headline: copy.question,
    entity: copy.entity,
    evidenceLine: copy.evidenceLine,
    detail: copy.detail,
  }
  if (entry.source === 'warden') {
    const { row } = entry
    const ageMs = row.ageDays === null ? null : row.ageDays * DAY_MS + sincePush
    const waiting =
      ageMs === null
        ? ''
        : ageMs >= AWAITING_OWNER_STALE_DAYS * DAY_MS
          ? {
              text: `waiting ${formatDuration(ageMs)} · stale at ${withUnit(AWAITING_OWNER_STALE_DAYS, 'd')}`,
              tone: 'warn' as const,
            }
          : `waiting ${formatDuration(ageMs)}`
    const pr = asText(row.prUrl)
    return {
      ...base,
      source: 'warden',
      facts: capFacts([`warden${repo && !repoNamed ? ` · ${repo}` : ''}`, waiting]),
      ageMs,
      href: '/warden',
      evidence: pr !== '' && isSafeHttpUrl(pr) ? pr : null,
      history: recentTransitions(raw?.items?.[String(row.eventId)]),
      abandoned: false,
    }
  }
  if (entry.source === 'queue') {
    const { item } = entry
    const askedMs = parseMs(item.askedAt)
    const ageMs = askedMs === null ? null : Math.max(0, now - askedMs)
    const host = asText(item['host'])
    return {
      ...base,
      source: 'queue',
      facts: capFacts([
        `queue${host ? ` · ${host}` : ''}`,
        ageMs === null ? '' : `asked ${formatAgo(ageMs)}`,
      ]),
      ageMs,
      href: '/agents',
      evidence: asText(item.cmd).trim() || null,
      history: [],
      abandoned: false,
    }
  }
  const { agent: a } = entry
  const activeAt = clockMs(a.lastActivityAt)
  const ageMs = activeAt === null ? null : Math.max(0, now - activeAt)
  return {
    ...base,
    source: 'agent',
    facts: capFacts([
      `agent · ${asText(a.project)}`,
      ageMs === null ? '' : `waiting ${formatDuration(ageMs)}`,
    ]),
    ageMs,
    href: '/agents',
    evidence: evidenceSource(a),
    history: [],
    abandoned: isAbandonedWait(a, now),
  }
}

/**
 * Everything waiting on the owner, longest wait first; an item with no clock sorts last. The inbox
 * is one surface: its plain questions are told apart together (`resolveCopies`), across sources.
 */
export function deriveDecisions({
  warden,
  agents,
  wardenReceivedAt,
  now,
}: DecisionInput): Decision[] {
  const receivedMs = parseMs(wardenReceivedAt)
  const sincePush = receivedMs === null ? 0 : Math.max(0, now - receivedMs)
  const entries = entriesOf(warden, agents)
  const derived = resolveCopies(entries, { derive, key: idOf })
  return entries
    .map((entry, i) => toDecision(entry, derived[i]!, { raw: warden, now, sincePush }))
    .toSorted((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1))
}
