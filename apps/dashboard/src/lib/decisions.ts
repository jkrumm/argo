import { authoredQuestion, firstSentence, restAfterFirstSentence, stripShortcodes } from './text'
import { capFacts, type DecisionCardFact } from '../components/upstream/decision-card-model'
import { cardCopy, plainQuestion } from './question-copy'
import { AWAITING_OWNER_STALE_DAYS, deriveAwaitingOwner } from '../features/warden/model'
import {
  recentTransitions,
  wardenAsk,
  type QueueKind,
  type TransitionHistory,
} from '../features/warden/page-model'
import { flattenAgents, formatWaitDuration, isAbandonedWait } from '../features/agents/model'
import type { OverviewSnapshot } from './queries/agents'
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

  const push = (source: Parameters<typeof wardenAsk>[0], kind: QueueKind, ageMs: number | null) => {
    seen.add(source.eventId)
    const { copy, repoNamed } = wardenAsk(source, kind)
    // Cleaned here, where the item is read, so no view renders a `:name:` shortcode.
    const cleanRepo = repoNamed ? '' : stripShortcodes(source.repo ?? '')
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
      id: `warden-${source.eventId}`,
      headline: copy.question,
      entity: copy.entity,
      facts: capFacts([`warden${cleanRepo ? ` · ${cleanRepo}` : ''}`, waiting]),
      evidenceLine: copy.evidenceLine,
      detail: copy.detail,
      ageMs,
      href: '/warden',
      evidence: null,
      history: recentTransitions(raw?.items?.[String(source.eventId)]),
      abandoned: false,
    })
  }

  for (const row of [...view.needsDecision, ...view.other, ...view.failed]) {
    push(
      row,
      row.state === 'failed' ? 'failed' : 'decision',
      row.ageDays === null ? null : row.ageDays * DAY_MS + sincePush,
    )
  }
  // `awaiting_owner` already lists failed items; a failed board item it missed still waits on the
  // owner, so it joins here — never twice.
  for (const item of board.items ?? []) {
    if (item.state !== 'failed' || seen.has(item.event_id)) continue
    const since = parseMs(item.updated_at ?? item.created_at)
    push(
      {
        eventId: item.event_id,
        repo: item.repo ?? null,
        title: item.title ?? null,
        reason: item.note ?? null,
        question: item['question'],
        availableActions: item.availableActions ?? [],
      },
      'failed',
      since === null ? null : Math.max(0, now - since),
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
    const ask = typeof item.question === 'string' ? item.question : ''
    const copy = cardCopy({
      ask: firstSentence(ask),
      body: restAfterFirstSentence(ask),
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
        authored: authoredQuestion(a['question']),
        body: evidence,
        title: a.title ?? a.lastPrompt ?? a.id,
        plain: plainQuestion('Unblock', a.project === '—' ? 'this agent' : `${a.project} agent`),
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
