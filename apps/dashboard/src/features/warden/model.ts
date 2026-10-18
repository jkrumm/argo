import { authoredQuestion } from '../../lib/text'
import { NBSP, formatRelative, withUnit } from '../../lib/format'
import type {
  WardenActionVerb,
  WardenBoardItem,
  WardenIssueInfo,
  WardenItems,
  WardenRaw,
} from '../../lib/queries/warden'

export type { WardenActionVerb, WardenIssueInfo }

// Pure derivations for the Warden board. Argo derives nothing warden itself didn't already
// compute — these functions only bucket, format and stale-check what the snapshot already carries.

/** A snapshot older than this is a stopped loop, not a quiet control plane (`docs/api.md`'s 10-minute
 * push cadence gives a wide margin before this reads as suspicious). */
const STALE_AFTER_MS = 30 * 60 * 1000

export function isStale(receivedAt: string | null | undefined, now = Date.now()): boolean {
  if (!receivedAt) return true
  const receivedMs = Date.parse(receivedAt)
  if (!Number.isFinite(receivedMs)) return true
  return now - receivedMs > STALE_AFTER_MS
}

/** Warden's terminal states — an item here is finished and never belongs on the open board. */
export const TERMINAL_STATES: ReadonlySet<string> = new Set(['fixed', 'quiet', 'closed'])

// ── State presentation ───────────────────────────────────────────────────────
// Warden's state vocabulary: non-terminal `new, triaged, working, merging, verifying,
// needs_decision, failed`; terminal `fixed, quiet, closed`. `closed` always carries a
// `close_reason` (duplicate | fixed_by | ignored | resolved). The board only lists non-terminal
// items, but the colors/labels cover the whole vocabulary.

const STATE_COLOR: Record<string, string> = {
  needs_decision: 'orange',
  failed: 'red',
  new: 'gray',
  triaged: 'gray',
  working: 'blue',
  merging: 'violet',
  verifying: 'teal',
  fixed: 'green',
  quiet: 'gray',
  closed: 'gray',
}

/** Mantine color name for a state badge — an unknown state falls back to gray, never throws. */
export function stateColor(state: string): string {
  return STATE_COLOR[state] ?? 'gray'
}

/** `"closed · duplicate"` for a closed item that carries its reason, the bare state otherwise. */
export function stateLabel(state: string, closeReason?: string | null): string {
  return state === 'closed' && closeReason ? `${state} · ${closeReason}` : state
}

/** A `working` item deferred by the daily budget — warden marks it with a `note` starting
 * `"deferred: …"`. It must never render as a plain `working` item: the note IS the finding
 * (what budget was hit), not incidental detail. */
export function isDeferredItem(item: WardenBoardItem): boolean {
  return (
    item.state === 'working' && typeof item.note === 'string' && item.note.startsWith('deferred:')
  )
}

// ── Needs you / Failed ───────────────────────────────────────────────────────
// `board.awaiting_owner` is warden's own list of everything it cannot finish without the owner:
// every `needs_decision` item (the decision question is the item note, `reason` here) and every
// `failed` one. Rendered first on the page (`decision-queues.tsx`) so nothing here rots
// invisibly — `needs_decision` as the one "needs you" list, `failed` as a separate, quieter one,
// and any entry in a state neither knows as a visible `other` list (mirrors the board's Other column in `page-model.ts`).

/** An entry reads as stale once it has waited this many days or longer — the point past which
 * "waiting on you" stops being a normal queue depth and starts being neglect. */
export const AWAITING_OWNER_STALE_DAYS = 3

export type AwaitingOwnerRow = {
  eventId: number
  repo: string | null
  title: string | null
  /** The board item's `origin` (`alert`, …); `null` when the item is past the board cap. */
  origin: string | null
  /** For a `failed` row: the state it failed out of (`verifying`), from its own timeline; `null` when unknown. */
  failedFrom: string | null
  /** The entry's raw state — the badge of the `other` list, which holds states outside the vocabulary. */
  state: string | null
  prUrl: string | null
  ageDays: number | null
  ageLabel: string
  stale: boolean
  /** The decision question for `needs_decision`, the failure note for `failed`. */
  reason: string | null
  strikes: number
  revisionCount: number
  /** `failed` rows only (null otherwise, or on an older warden): infra | policy | work. */
  failureClass: string | null
  /** Automatic re-drives warden has done; 0 when unreported. */
  redrives: number
  availableActions: string[]
  /** The question warden authored for this item; `null` until the producer sends one. */
  question: string | null
}

export type AwaitingOwnerView = {
  needsDecision: AwaitingOwnerRow[]
  failed: AwaitingOwnerRow[]
  /** Entries in neither `needs_decision` nor `failed` — never dropped silently. */
  other: AwaitingOwnerRow[]
}

/** `"5.1 d"` / `"< 1 d"` / `"—"` for an unreported age — never a bare number with no unit. */
export function formatAgeDays(ageDays: number | null): string {
  if (ageDays === null) return '—'
  if (ageDays < 1) return `< 1${NBSP}d`
  return withUnit(ageDays.toFixed(1), 'd')
}

/**
 * Everything that cannot finish without the owner, in one list: decisions, entries in states this
 * page does not know, then failed items. The summary, the board and Home all count from this, so
 * they cannot disagree.
 */
export const waitingOnOwner = (view: AwaitingOwnerView): AwaitingOwnerRow[] => [
  ...view.needsDecision,
  ...view.other,
  ...view.failed,
]

const EMPTY_AWAITING_OWNER: AwaitingOwnerView = { needsDecision: [], failed: [], other: [] }

/** The state an item's latest move into `failed` came from, read off its transition timeline. */
function failedFromOf(timeline: unknown): string | null {
  const rows = (timeline as { transitions?: unknown } | null | undefined)?.transitions
  if (!Array.isArray(rows)) return null
  for (const row of rows.toReversed()) {
    const move = row as { from_state?: unknown; to_state?: unknown } | null
    if (move?.to_state !== 'failed') continue
    return typeof move.from_state === 'string' ? move.from_state : null
  }
  return null
}

/**
 * Splits `board.awaiting_owner` into the `needs_decision`, `failed` and `other` lists, preserving
 * warden's own oldest-first order — this never re-sorts. Missing on an older snapshot reads as
 * empty lists, never a crash; an entry in any other state lands in `other`, and only an entry with
 * no event id to act on is dropped.
 * `strikes` is not on the awaiting entry itself, so it is looked up from the same item on
 * `board.items` (0 when the item is past the board cap); `failure_class`/`redrives` prefer the
 * entry and fall back to that item the same way. `stale` flags an entry that has waited
 * `AWAITING_OWNER_STALE_DAYS` or longer; an unreported age never counts as stale (no fabricated
 * urgency out of a missing number).
 */
export function deriveAwaitingOwner(
  board: WardenRaw['board'] | undefined,
  items?: WardenRaw['items'],
): AwaitingOwnerView {
  const entries = board?.awaiting_owner
  if (!entries || entries.length === 0) return EMPTY_AWAITING_OWNER
  const itemsById = new Map((board?.items ?? []).map((item) => [item.event_id, item]))
  const view: AwaitingOwnerView = { needsDecision: [], failed: [], other: [] }
  for (const entry of entries) {
    if (entry.event_id === null) continue
    const boardItem = itemsById.get(entry.event_id)
    const row: AwaitingOwnerRow = {
      eventId: entry.event_id,
      repo: entry.repo,
      title: entry.title,
      origin: boardItem?.origin ?? null,
      state: entry.state,
      prUrl: entry.pr_url,
      ageDays: entry.age_days,
      ageLabel: formatAgeDays(entry.age_days),
      stale: entry.age_days !== null && entry.age_days >= AWAITING_OWNER_STALE_DAYS,
      reason: entry.reason,
      strikes: boardItem?.strikes ?? 0,
      revisionCount: entry.revision_count,
      failureClass: entry.failure_class ?? boardItem?.failure_class ?? null,
      redrives: entry.redrives ?? boardItem?.redrives ?? 0,
      failedFrom: entry.state === 'failed' ? failedFromOf(items?.[String(entry.event_id)]) : null,
      availableActions: entry.availableActions ?? [],
      question: authoredQuestion(entry['question']) ?? authoredQuestion(boardItem?.['question']),
    }
    if (entry.state === 'needs_decision') view.needsDecision.push(row)
    else if (entry.state === 'failed') view.failed.push(row)
    else view.other.push(row)
  }
  return view
}

/** `"repo#number"` — the compact reference a GitHub-issue-origin row links out with. */
export function issueRefLabel(issue: WardenIssueInfo): string {
  return `${issue.repo}#${issue.number}`
}

/** Guards `issue.url` before it is used as an `href` — a `github_issue`-origin item's payload can
 * originate from a third-party (untrusted) author, so a non-http(s) scheme (`javascript:`,
 * `data:`, …) must never render as a clickable link. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

// ── Pending owner actions ────────────────────────────────────────────────────
// A queued action (`POST /warden/items/:eventId/actions`) doesn't take effect until warden's own
// loop pulls it and pushes a fresher snapshot — this tracks "queued" client-side in the meantime so
// a click doesn't look like a no-op.

export type PendingAction = { verb: WardenActionVerb; queuedAt: number }
export type PendingActions = Record<number, PendingAction>

export function withPendingAction(
  pending: PendingActions,
  eventId: number,
  verb: WardenActionVerb,
  now = Date.now(),
): PendingActions {
  return { ...pending, [eventId]: { verb, queuedAt: now } }
}

// warden polls its action queue roughly every 10 minutes (see warden/docs/api.md) — one poll of
// margin before a queued action that never got applied is treated as failed, not pending forever.
export const PENDING_ACTION_TIMEOUT_MS = 15 * 60 * 1000

/** Drops a pending entry once the item's own `updated_at` has moved past the moment the action was
 * queued (warden applied it and pushed a fresher snapshot), or once it has been pending longer than
 * `PENDING_ACTION_TIMEOUT_MS`. An item absent from the latest snapshot's items only ages out on the
 * timeout — it never resolves as "applied" on absence alone. */
export function reconcilePendingActions(
  pending: PendingActions,
  items: WardenBoardItem[],
  now = Date.now(),
): PendingActions {
  const itemsById = new Map(items.map((item) => [item.event_id, item]))
  const next: PendingActions = {}
  let changed = false
  for (const [key, action] of Object.entries(pending)) {
    const eventId = Number(key)
    const updatedAtMs = Date.parse(itemsById.get(eventId)?.updated_at ?? '')
    const appliedSincePush = Number.isFinite(updatedAtMs) && updatedAtMs > action.queuedAt
    const timedOut = now - action.queuedAt > PENDING_ACTION_TIMEOUT_MS
    if (appliedSincePush || timedOut) {
      changed = true
      continue
    }
    next[eventId] = action
  }
  // Returns the same reference when nothing was dropped — the 30s reconciliation timer
  // (`use-warden-actions.ts`) calls this unconditionally, and a fresh object every tick with no
  // actual change would re-render the page's whole subtree for no reason.
  return changed ? next : pending
}

// ── Item timeline ────────────────────────────────────────────────────────────
// `item-timeline.tsx` renders one item/event pair plus its transitions, dispatches, and operations.
// Every read here is defensive — field names vary slightly between warden's producers —
// so the derivations live here, pure and unit-tested, rather than inline in JSX where a dozen small
// branches add up to one unreadable, untestable function.

/** The item/event/dispatch/operation/transition rows all arrive as loosely-validated
 * jsonb — a generic key/value bag rather than one exact shape. */
export type Row = Record<string, unknown>

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Counts and totals arrive as real numbers when warden computes them; an absent field — several
 * (the reminder counts, the `*_total` caps) are only now being added warden-side — reads as null
 * rather than 0, so a reminder line never renders for a count that was never reported. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Matches by name, not an exact list — `secret`/`token` alone missed `password`, `nonce`,
 * `signature` and any `*_key` field a producer might add later. */
const SENSITIVE_KEY_PATTERN = /secret|token|password|nonce|signature|key$/i

/** A compact `"key: value"` line over every field but the ones already rendered explicitly and
 * any field whose name looks sensitive — defensive against field names varying slightly between
 * warden's producers. */
function summarizeRow(row: Row, skip: string[]): string {
  const skipSet = new Set(skip)
  return Object.entries(row)
    .filter(
      ([key, value]) =>
        !skipSet.has(key) &&
        !SENSITIVE_KEY_PATTERN.test(key) &&
        value !== null &&
        value !== undefined,
    )
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    )
    .join(' · ')
}

export function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function externalIdOf(event: Row | null): string | null {
  const raw = event?.['external_id']
  return str(raw) ?? (typeof raw === 'number' ? String(raw) : null)
}

function seenParts(item: Row | null, now: number): string[] {
  const firstSeen = str(item?.['first_seen'])
  const lastSeen = str(item?.['last_seen'])
  return [
    firstSeen ? `first seen ${formatRelative(firstSeen, now)}` : null,
    lastSeen ? `last seen ${formatRelative(lastSeen, now)}` : null,
  ].filter((part): part is string => part !== null)
}

/** "first seen … · last seen … · N occurrences" — any of the three parts may be absent; `null`
 * only when none of them are present. */
function seenAndOccurrencesLine(item: Row | null, now: number): string | null {
  const occurrences = num(item?.['occurrences'])
  const occurrenceText = occurrences !== null ? pluralize(occurrences, 'occurrence') : null
  const parts = [...seenParts(item, now), occurrenceText].filter(
    (part): part is string => part !== null,
  )
  return parts.length > 0 ? parts.join(' · ') : null
}

function resolvedLine(event: Row | null, now: number): string | null {
  const resolvedAt = str(event?.['resolved_at'])
  return resolvedAt ? `resolved ${formatRelative(resolvedAt, now)}` : null
}

function alertReminderLine(event: Row | null, now: number): string | null {
  const count = num(event?.['reminder_count'])
  if (count === null || count <= 0) return null
  const last = str(event?.['last_reminder_at'])
  return `Alert reminders: ${count}${last ? ` (last ${formatRelative(last, now)})` : ''}`
}

/** Strikes and the retry gate — warden's one retry rule: three consecutive infrastructure failures
 * of a step park the item in `failed`; a submitting poller skips the row until `retry_at`. */
function retryLines(item: Row | null, now: number): string[] {
  const strikes = num(item?.['strikes'])
  const retryAt = str(item?.['retry_at'])
  return [
    strikes !== null && strikes > 0 ? `${pluralize(strikes, 'strike')}` : null,
    retryAt ? `retry ${formatRelative(retryAt, now)}` : null,
  ].filter((line): line is string => line !== null)
}

/** The tracking-facts lines below the identity header, in fixed order — only the ones with
 * something to say. */
function buildFactLines(item: Row | null, event: Row | null, now: number): string[] {
  return [
    seenAndOccurrencesLine(item, now),
    resolvedLine(event, now),
    alertReminderLine(event, now),
    ...retryLines(item, now),
  ].filter((line): line is string => line !== null)
}

function isPlainRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object'
}

/** An alert-origin item's raw event payload, shown only when warden gave the item no `brief` of
 * its own — a brief always wins because it is written for a human, the payload is not. */
function payloadSummary(
  event: Row | null,
  origin: string | null,
  brief: string | null,
): string | null {
  if (origin !== 'alert' || brief) return null
  return isPlainRow(event?.['payload']) ? summarizeRow(event['payload'] as Row, []) : null
}

/** An alert signature neither repo nor verb maps to — the owner should know warden is only
 * tracking it, not routing it. */
function isUnmapped(item: Row | null, origin: string | null): boolean {
  return origin === 'alert' && !str(item?.['repo']) && !str(item?.['verb'])
}

export type ItemFacts = {
  title: string | null
  source: string | null
  externalId: string | null
  state: string | null
  origin: string | null
  signature: string | null
  lines: string[]
  note: string | null
  brief: string | null
  payloadSummary: string | null
  unmapped: boolean
}

/**
 * Every derived value `ItemSummary` renders: identity (title, `source:external_id`, state/origin,
 * signature), the tracking-fact lines (seen/occurrences, resolved, alert reminders, strikes/retry)
 * and the prose (note, brief, or — for a brief-less alert — the event payload). A closed item's
 * `state` carries its `close_reason`. Fields vary between warden's producers, so every read is
 * defensive.
 */
export function buildItemFacts(item: Row | null, event: Row | null, now: number): ItemFacts {
  const origin = str(item?.['origin'])
  const brief = str(item?.['brief'])
  const state = str(item?.['state'])
  return {
    title: str(event?.['title']) ?? str(item?.['title']),
    source: str(event?.['source']),
    externalId: externalIdOf(event),
    state: state ? stateLabel(state, str(item?.['close_reason'])) : null,
    origin,
    signature: str(item?.['signature']),
    lines: buildFactLines(item, event, now),
    note: str(item?.['note']),
    brief,
    payloadSummary: payloadSummary(event, origin, brief),
    unmapped: isUnmapped(item, origin),
  }
}

export type TimelineView = {
  item: Row | null
  event: Row | null
  transitions: Row[]
  transitionsTotal: number | undefined
  dispatches: Row[]
  operations: Row[]
  operationsTotal: number | undefined
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : []
}

function asRow(value: unknown): Row | null {
  return isPlainRow(value) ? value : null
}

function resolveTimelineView(timeline: Row | undefined): TimelineView {
  const source = timeline ?? {}
  return {
    item: asRow(source['item']),
    event: asRow(source['event']),
    transitions: asRows(source['transitions']),
    transitionsTotal: num(source['transitions_total']) ?? undefined,
    dispatches: asRows(source['dispatches']),
    operations: asRows(source['operations']),
    operationsTotal: num(source['operations_total']) ?? undefined,
  }
}

export type ItemModalView = {
  opened: boolean
  title: string
  timeline: Row | undefined
  facts: TimelineView
}

/**
 * Everything `ItemTimeline` needs to render, resolved once from `eventId` + the snapshot's `items`
 * map. When the id is absent from the map (the snapshot truncates per-item timelines past a cap)
 * `timeline` is `undefined` — the modal says so rather than rendering an empty, misleadingly-
 * complete block.
 */
export function resolveItemModal(
  eventId: number | null,
  items: WardenItems | undefined,
): ItemModalView {
  const timeline = eventId !== null ? items?.[String(eventId)] : undefined
  return {
    opened: eventId !== null,
    title: eventId !== null ? `Item #${eventId}` : '',
    timeline: timeline as Row | undefined,
    facts: resolveTimelineView(timeline as Row | undefined),
  }
}

/** A dispatch's verdict, one line: the summary, then whichever of next-action/confidence/outcome
 * the verdict carries. */
function verdictDetailParts(verdict: Row): string[] {
  return [
    str(verdict['nextAction']) ? `next: ${str(verdict['nextAction'])}` : null,
    str(verdict['confidence']) ? `confidence: ${str(verdict['confidence'])}` : null,
    str(verdict['outcome']) ? `outcome: ${str(verdict['outcome'])}` : null,
  ].filter((part): part is string => part !== null)
}

export function formatVerdictLine(verdict: Row): string {
  const summary = str(verdict['summary']) ?? '—'
  return [summary, ...verdictDetailParts(verdict)].join(' · ')
}

/** `"source:external_id"` — `—` when `source` is absent, the id suffixed on only when present. */
export function formatSourceLine(source: string | null, externalId: string | null): string {
  return `${source ?? '—'}${externalId ? `:${externalId}` : ''}`
}
