import { capFacts, type DecisionCardFact } from '../components/upstream/decision-card-model'
import {
  agentInput,
  blockerEvidence,
  clockMs,
  evidenceSource,
  flattenAgents,
  humanQueueInput,
  isAbandonedWait,
  type AgentRow,
} from '../features/agents/model'
import { surfaceCopies, type CardCopy, type CardInput } from './question-copy'
import { NBSP, formatAgo, formatDuration } from './format'
import { asText } from './text'
import type { HumanQueueItem, OverviewSnapshot } from './queries/agents'

// The ONE merged inbox: everything that waits on the owner, from the human queue and the agent
// fleet. The Home heading count, the summary sentence and the cards all read `decisions.length` of
// one `deriveDecisions` call, so they cannot disagree. Pure and React-free.

const MINUTE_MS = 60_000
const WAITING_UNDER_A_MINUTE = `waiting${NBSP}<${NBSP}1${NBSP}min`

/** The one wording of a wait: `waiting <1 min` under a minute, else `waiting {d} d {h} h`. */
const waitingText = (ms: number): string =>
  ms < MINUTE_MS ? WAITING_UNDER_A_MINUTE : `waiting${NBSP}${formatDuration(ms)}`

export type DecisionSource = 'queue' | 'agent'

export type Decision = {
  source: DecisionSource
  /** Unique across sources (`queue-abc`, `agent-xyz`). */
  id: string
  /** The question the owner answers: short (a long ask becomes `Approve <title>?`). */
  headline: string
  /** The item the question is about, when the headline does not already name it. */
  entity: string | null
  /** `queue · <host>` / `agent · <project>` first, then the age: at most 3. */
  facts: DecisionCardFact[]
  /** One line of evidence, the lead of the reason or command; `null` when there is none. */
  evidenceLine: string | null
  /** The whole ask/reason, only when `evidenceLine` had to shorten it. */
  detail: string | null
  /** How long it has waited, by the source's own clock; `null` when the source reports none. */
  ageMs: number | null
  /** The page that owns the full item. */
  href: '/agents'
  /** The command or blocker behind the question, when the source carries one. */
  evidence: string | null
  /** Past 7 days an agent wait is abandoned rather than live. */
  abandoned: boolean
}

export type DecisionInput = {
  agents: OverviewSnapshot | null | undefined
  now: number
}

const parseMs = (iso: unknown): number | null => {
  if (typeof iso !== 'string' || iso === '') return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

type Entry = { source: 'queue'; item: HumanQueueItem } | { source: 'agent'; agent: AgentRow }

function idOf(entry: Entry): string {
  switch (entry.source) {
    case 'queue':
      return `queue-${asText(entry.item.id)}`
    case 'agent':
      return `agent-${asText(entry.agent.id)}`
  }
}

function entriesOf(snapshot: OverviewSnapshot | null | undefined): Entry[] {
  if (!snapshot) return []
  const asks = (snapshot.humanQueue ?? []).map((item): Entry => ({ source: 'queue', item }))
  const agents = flattenAgents(snapshot)
    .filter((a) => a.state === 'needs_you')
    .map((agent): Entry => ({ source: 'agent', agent }))
  return [...asks, ...agents]
}

/** The card input of one entry, asked as Home asks: `Decide on …`, its only button opens the owning page. */
function inputOf(entry: Entry): CardInput {
  if (entry.source === 'queue') return humanQueueInput(entry.item, 'home').input
  return agentInput(entry.agent, blockerEvidence(entry.agent), 'home')
}

function toDecision(entry: Entry, copy: CardCopy, now: number): Decision {
  const base = {
    id: idOf(entry),
    headline: copy.question,
    entity: copy.entity,
    evidenceLine: copy.evidenceLine,
    detail: copy.detail,
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
      abandoned: false,
    }
  }
  const { agent: a } = entry
  const activeAt = clockMs(a.lastActivityAt)
  const ageMs = activeAt === null ? null : Math.max(0, now - activeAt)
  return {
    ...base,
    source: 'agent',
    facts: capFacts([`agent · ${asText(a.project)}`, ageMs === null ? '' : waitingText(ageMs)]),
    ageMs,
    href: '/agents',
    evidence: evidenceSource(a),
    abandoned: isAbandonedWait(a, now),
  }
}

/**
 * Everything waiting on the owner, longest wait first; an item with no clock sorts last. The inbox
 * is one surface: its questions are told apart together (`surfaceCopies`), across sources.
 */
export function deriveDecisions({ agents, now }: DecisionInput): Decision[] {
  const entries = entriesOf(agents)
  const copies = surfaceCopies(entries.map(inputOf))
  return entries
    .map((entry, i) => toDecision(entry, copies[i]!, now))
    .toSorted((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1))
}
