import { capFacts, type DecisionCardFact } from '../components/upstream/decision-card-model'
import {
  AWAITING_OWNER_STALE_DAYS,
  deriveAwaitingOwner,
  isSafeHttpUrl,
  waitingOnOwner,
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
  evidenceSource,
  flattenAgents,
  formatWaitDuration,
  humanQueueCopy,
  isAbandonedWait,
} from '../features/agents/model'
import { collidingCopies, type CardCopySource } from './question-copy'
import type { OverviewSnapshot } from './queries/agents'
import type { WardenRaw } from './queries/warden'

// The ONE merged inbox: everything that waits on the owner, from Warden and from the agent fleet.
// The Home heading count, the summary sentence and the cards all read `decisions.length` of one
// `deriveDecisions` call, so they cannot disagree. Pure and React-free; the pages do not consume it
// yet (they keep their own lists and filter by `source` once they migrate).

const DAY_MS = 86_400_000

/** An agent that reports nothing still gets a line: the absence is the fact. */
const NO_BLOCKER = 'No blocker reported.'

export type DecisionSource = 'warden' | 'queue' | 'agent'

export type Decision = {
  source: DecisionSource
  /** Unique across sources (`warden-12`, `queue-abc`, `agent-xyz`). */
  id: string
  /** The question the owner answers: short (a long ask becomes `Approve <title>?`). */
  headline: string
  /** Which rung of the question rule wrote the headline; only a `plain` one can be told apart by a handle. */
  copySource: CardCopySource
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

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function wardenDecisions(
  raw: WardenRaw | null | undefined,
  receivedAt: string | null | undefined,
  now: number,
  handled: ReadonlySet<string>,
): Decision[] {
  const board = raw?.board
  if (!board) return []
  const view = deriveAwaitingOwner(board)
  const receivedMs = parseMs(receivedAt)
  const sincePush = receivedMs === null ? 0 : Math.max(0, now - receivedMs)

  // One list, the one the Warden page counts from: decisions, unknown states, then failed items.
  return waitingOnOwner(view).map((row): Decision => {
    const kind: QueueKind = row.state === 'failed' ? 'failed' : 'decision'
    const source: AskSource = row
    const { copy, repo, repoNamed } = wardenAsk(source, kind, handled.has(`warden-${row.eventId}`))
    const ageMs = row.ageDays === null ? null : row.ageDays * DAY_MS + sincePush
    const waiting =
      ageMs === null
        ? ''
        : ageMs >= AWAITING_OWNER_STALE_DAYS * DAY_MS
          ? {
              text: `waiting ${formatWaitDuration(ageMs)} · stale at ${AWAITING_OWNER_STALE_DAYS}\u00a0d`,
              tone: 'warn' as const,
            }
          : `waiting ${formatWaitDuration(ageMs)}`
    return {
      source: 'warden',
      id: `warden-${row.eventId}`,
      headline: copy.question,
      copySource: copy.source,
      entity: copy.entity,
      facts: capFacts([`warden${repo && !repoNamed ? ` · ${repo}` : ''}`, waiting]),
      evidenceLine: copy.evidenceLine,
      detail: copy.detail,
      ageMs,
      href: '/warden',
      evidence: row.prUrl !== null && isSafeHttpUrl(row.prUrl) ? row.prUrl : null,
      history: recentTransitions(raw?.items?.[String(row.eventId)]),
      abandoned: false,
    }
  })
}

function agentDecisions(
  snapshot: OverviewSnapshot | null | undefined,
  now: number,
  handled: ReadonlySet<string>,
): Decision[] {
  if (!snapshot) return []
  const asks = (snapshot.humanQueue ?? []).map((item): Decision => {
    const askedMs = parseMs(item.askedAt)
    const ageMs = askedMs === null ? null : Math.max(0, now - askedMs)
    const host = typeof item['host'] === 'string' ? item['host'] : null
    const evidence = item.cmd?.trim() || null
    const { copy } = humanQueueCopy(item, handled.has(`queue-${item.id}`))
    return {
      source: 'queue',
      id: `queue-${item.id}`,
      headline: copy.question,
      copySource: copy.source,
      entity: copy.entity,
      facts: capFacts([
        `queue${host ? ` · ${host}` : ''}`,
        ageMs === null ? '' : `asked ${formatWaitDuration(ageMs)} ago`,
      ]),
      evidenceLine: copy.evidenceLine,
      detail: copy.detail,
      ageMs,
      href: '/agents',
      evidence,
      history: [],
      abandoned: false,
    }
  })
  const waiting = flattenAgents(snapshot)
    .filter((a) => a.state === 'needs_you')
    .map((a): Decision => {
      const ageMs = a.lastActivityAt == null ? null : Math.max(0, now - a.lastActivityAt)
      // The page's own rule: the first of blocker, waiting-for and standing with content in it.
      const evidence = evidenceSource(a)
      const copy = agentCopy(a, evidence ?? NO_BLOCKER, handled.has(`agent-${a.id}`))
      return {
        source: 'agent',
        id: `agent-${a.id}`,
        headline: copy.question,
        copySource: copy.source,
        entity: copy.entity,
        facts: capFacts([
          `agent · ${a.project}`,
          ageMs === null ? '' : `waiting ${formatWaitDuration(ageMs)}`,
        ]),
        evidenceLine: copy.evidenceLine,
        detail: copy.detail,
        ageMs,
        href: '/agents',
        evidence,
        history: [],
        abandoned: isAbandonedWait(a, now),
      }
    })
  return [...asks, ...waiting]
}

/**
 * Everything waiting on the owner, longest wait first; an item with no clock sorts last. One
 * surface: two items whose plain question would read the same are derived again with their handle,
 * a lone item keeps the short form.
 */
export function deriveDecisions({
  warden,
  agents,
  wardenReceivedAt,
  now,
}: DecisionInput): Decision[] {
  const build = (handled: ReadonlySet<string>) => [
    ...wardenDecisions(warden, wardenReceivedAt, now, handled),
    ...agentDecisions(agents, now, handled),
  ]
  const short = build(new Set())
  const clash = collidingCopies(
    short.map(({ headline, copySource }) => ({ question: headline, source: copySource })),
  )
  const handled = new Set(short.filter((_, i) => clash[i]).map(({ id }) => id))
  const all = handled.size === 0 ? short : build(handled)
  return all.toSorted((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1))
}
