import { stripShortcodes } from './text'
import {
  capFacts,
  cardCopy,
  plainQuestion,
  type DecisionCardFact,
} from '../components/upstream/decision-card-model'
import { AWAITING_OWNER_STALE_DAYS, deriveAwaitingOwner } from '../features/warden/model'
import {
  askCopy,
  planActions,
  recentTransitions,
  type TransitionHistory,
} from '../features/warden/page-model'
import {
  firstSentence,
  flattenAgents,
  formatWaitDuration,
  restAfterFirstSentence,
  isAbandonedWait,
} from '../features/agents/model'
import type { OverviewSnapshot } from './queries/agents'
import type { WardenActionVerb, WardenBoardItem, WardenRaw } from './queries/warden'

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
  /** The command or blocker behind the question, when the source carries one. */
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

/** The question a Warden item carries when the producer authored one; blank reads as none. */
const authoredOf = (item: WardenBoardItem): string | null =>
  typeof item.question === 'string' && item.question.trim() !== '' ? item.question : null

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function wardenDecisions(
  raw: WardenRaw | null | undefined,
  receivedAt: string | null | undefined,
  now: number,
): Decision[] {
  const board = raw?.board
  if (!board) return []
  const view = deriveAwaitingOwner(board)
  const receivedMs = parseMs(receivedAt)
  const sincePush = receivedMs === null ? 0 : Math.max(0, now - receivedMs)
  const seen = new Set<number>()
  const out: Decision[] = []

  const push = (
    eventId: number,
    repo: string | null,
    title: string | null,
    reason: string | null,
    failed: boolean,
    ageMs: number | null,
    question: string | null,
    primary: WardenActionVerb | null,
  ) => {
    seen.add(eventId)
    const { copy, entity } = askCopy({ eventId, title, reason, failed, question, repo, primary })
    // Cleaned here, where the item is read, so no view renders a `:name:` shortcode.
    const cleanRepo = stripShortcodes(repo ?? '')
    const waiting =
      ageMs === null
        ? ''
        : ageMs >= AWAITING_OWNER_STALE_DAYS * DAY_MS
          ? {
              text: `waiting ${formatWaitDuration(ageMs)} · stale at ${AWAITING_OWNER_STALE_DAYS} d`,
              tone: 'warn' as const,
            }
          : `waiting ${formatWaitDuration(ageMs)}`
    out.push({
      source: 'warden',
      id: `warden-${eventId}`,
      headline: copy.question,
      entity,
      facts: capFacts([`warden${cleanRepo ? ` · ${cleanRepo}` : ''}`, waiting]),
      evidenceLine: copy.evidenceLine,
      detail: copy.detail,
      ageMs,
      href: '/warden',
      evidence: null,
      history: recentTransitions(raw?.items?.[String(eventId)]),
      abandoned: false,
    })
  }

  for (const row of [...view.needsDecision, ...view.other, ...view.failed]) {
    push(
      row.eventId,
      row.repo,
      row.title,
      row.reason,
      row.state === 'failed',
      row.ageDays === null ? null : row.ageDays * DAY_MS + sincePush,
      row.question,
      planActions(row.availableActions, row.state === 'failed' ? 'failed' : 'decision').primary,
    )
  }
  // `awaiting_owner` already lists failed items; a failed board item it missed still waits on the
  // owner, so it joins here — never twice.
  for (const item of board.items ?? []) {
    if (item.state !== 'failed' || seen.has(item.event_id)) continue
    const since = parseMs(item.updated_at ?? item.created_at)
    push(
      item.event_id,
      item.repo ?? null,
      item.title ?? null,
      item.note ?? null,
      true,
      since === null ? null : Math.max(0, now - since),
      authoredOf(item),
      planActions(item.availableActions ?? [], 'failed').primary,
    )
  }
  return out
}

function agentDecisions(snapshot: OverviewSnapshot | null | undefined, now: number): Decision[] {
  if (!snapshot) return []
  const asks = (snapshot.humanQueue ?? []).map((item): Decision => {
    const askedMs = parseMs(item.askedAt)
    const ageMs = askedMs === null ? null : Math.max(0, now - askedMs)
    const host = typeof item['host'] === 'string' ? item['host'] : null
    const evidence = item.cmd?.trim() || null
    const title = typeof item['title'] === 'string' ? item['title'] : null
    const copy = cardCopy({
      ask: firstSentence(item.question),
      body: restAfterFirstSentence(item.question),
      title,
      plain: plainQuestion('Answer', host ? `${host} request` : 'this request'),
    })
    return {
      source: 'queue',
      id: `queue-${item.id}`,
      headline: copy.question,
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
      const evidence = a.blocker ?? a.waitingFor ?? a.standing ?? null
      const copy = cardCopy({
        authored: a.question ?? null,
        body: evidence,
        title: a.title ?? a.lastPrompt ?? a.id,
        plain: plainQuestion('Unblock', `${a.project} agent`),
      })
      return {
        source: 'agent',
        id: `agent-${a.id}`,
        headline: copy.question,
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

/** Everything waiting on the owner, longest wait first; an item with no clock sorts last. */
export function deriveDecisions({
  warden,
  agents,
  wardenReceivedAt,
  now,
}: DecisionInput): Decision[] {
  return [
    ...wardenDecisions(warden, wardenReceivedAt, now),
    ...agentDecisions(agents, now),
  ].toSorted((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1))
}
