import type { DecisionCardFact } from '../components/upstream/decision-card-model'
import { AWAITING_OWNER_STALE_DAYS, deriveAwaitingOwner } from '../features/warden/model'
import {
  recentTransitions,
  retryQuestion,
  splitReason,
  type TransitionLine,
} from '../features/warden/page-model'
import {
  flattenAgents,
  formatWaitDuration,
  headlineOf,
  isAbandonedWait,
} from '../features/agents/model'
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
  /** The question the owner answers. */
  headline: string
  /** `warden · <repo>` / `queue · <host>` / `agent · <project>` first, then the age. */
  facts: DecisionCardFact[]
  /** How long it has waited, by the source's own clock; `null` when the source reports none. */
  ageMs: number | null
  /** The page that owns the full item. */
  href: '/warden' | '/agents'
  /** The command or blocker behind the question, when the source carries one. */
  evidence: string | null
  /** Where a Warden item has been, newest last; empty for every other source. */
  history: TransitionLine[]
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

const isText = (v: string | null | undefined): v is string =>
  v !== null && v !== undefined && v !== ''

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
  ) => {
    seen.add(eventId)
    const label = title ?? `Item #${eventId}`
    const headline = failed ? retryQuestion(label) : splitReason(reason, label).question
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
      headline,
      facts: [`warden${repo ? ` · ${repo}` : ''}`, waiting].filter((f) => f !== ''),
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
    return {
      source: 'queue',
      id: `queue-${item.id}`,
      headline: headlineOf(item.question),
      facts: [
        `queue${host ? ` · ${host}` : ''}`,
        ageMs === null ? '' : `asked ${formatWaitDuration(ageMs)} ago`,
      ].filter((f) => f !== ''),
      ageMs,
      href: '/agents',
      evidence: item.cmd?.trim() || null,
      history: [],
      abandoned: false,
    }
  })
  const waiting = flattenAgents(snapshot)
    .filter((a) => a.state === 'needs_you')
    .map((a): Decision => {
      const ageMs = a.lastActivityAt == null ? null : Math.max(0, now - a.lastActivityAt)
      return {
        source: 'agent',
        id: `agent-${a.id}`,
        headline: headlineOf(a.title ?? a.lastPrompt ?? a.id),
        facts: [
          `agent · ${a.project}`,
          ageMs === null ? '' : `waiting ${formatWaitDuration(ageMs)}`,
        ].filter(isText),
        ageMs,
        href: '/agents',
        evidence: a.blocker ?? a.waitingFor ?? a.standing ?? null,
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
