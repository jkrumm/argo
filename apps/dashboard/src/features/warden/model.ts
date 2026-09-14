import { relativeTime } from 'basalt-ui/format'
import type {
  WardenBoardItem,
  WardenIntents,
  WardenItems,
  WardenMetrics,
  WardenRaw,
} from '../../lib/queries/warden'

// Pure derivations for the Warden board. Argo derives nothing warden itself didn't already
// compute — these functions only bucket, format and stale-check what the snapshot already carries.

/** A snapshot older than this is a stopped loop, not a quiet control plane (`docs/api.md`'s 10-minute
 * push cadence gives a wide margin before this reads as suspicious). */
export const STALE_AFTER_MS = 30 * 60 * 1000

export function isStale(receivedAt: string | null | undefined, now = Date.now()): boolean {
  if (!receivedAt) return true
  const receivedMs = Date.parse(receivedAt)
  if (!Number.isFinite(receivedMs)) return true
  return now - receivedMs > STALE_AFTER_MS
}

// ── Board buckets ────────────────────────────────────────────────────────────

export const BUCKET_ORDER = [
  'needs_human',
  'deferred',
  'merge_blocked',
  'new',
  'investigating',
  'verdict',
  'implementing',
  'validating',
  'merged',
  'liveness_pending',
  'split',
  'unknown',
] as const

export type BucketKey = (typeof BUCKET_ORDER)[number]

export const BUCKET_LABEL: Record<BucketKey, string> = {
  needs_human: 'Needs human',
  deferred: 'Deferred — budget',
  merge_blocked: 'Merge blocked',
  new: 'New',
  investigating: 'Investigating',
  verdict: 'Verdict',
  implementing: 'Implementing',
  validating: 'Validating',
  merged: 'Merged',
  liveness_pending: 'Liveness pending',
  split: 'Split',
  unknown: "Unknown state — not in the board's vocabulary",
}

export type Bucket = { key: BucketKey; label: string; items: WardenBoardItem[] }

/** A `verdict` item deferred by the daily budget — warden marks it with a `note` starting
 * `"deferred: …"`. It must never render as a plain `verdict` item: the note IS the finding
 * (what budget was hit), not incidental detail. */
export function isDeferredItem(item: WardenBoardItem): boolean {
  return (
    item.state === 'verdict' && typeof item.note === 'string' && item.note.startsWith('deferred:')
  )
}

/**
 * Buckets every board item into the fixed order above. `deferred` is carved out of `verdict`
 * items whose note marks a budget deferral — it is not one of warden's own `board.state` values.
 * Every key is present, even with an empty `items` array; the caller (`board-section.tsx`) decides
 * whether an empty bucket renders a `Section` at all.
 */
export function deriveBoard(board: WardenRaw['board'] | undefined): Bucket[] {
  const buckets = new Map<BucketKey, WardenBoardItem[]>(BUCKET_ORDER.map((key) => [key, []]))
  const knownStates = new Set<string>(BUCKET_ORDER)
  for (const item of board?.items ?? []) {
    const key: BucketKey = isDeferredItem(item)
      ? 'deferred'
      : knownStates.has(item.state)
        ? (item.state as BucketKey)
        : 'unknown'
    buckets.get(key)?.push(item)
  }
  return BUCKET_ORDER.map((key) => ({ key, label: BUCKET_LABEL[key], items: buckets.get(key)! }))
}

// ── Funnel metrics ───────────────────────────────────────────────────────────

export type FunnelTile = {
  key: string
  label: string
  /** The long, descriptive form of `label` — kept off the tile itself (short labels fit a 390px
   * two-column mobile grid) and surfaced instead through the tile's `info` tooltip. */
  description: string
  value: number | null
  unavailable: string | null
  detail: string
}

const FUNNEL_DEFS: { key: keyof WardenMetrics; label: string; description: string }[] = [
  {
    key: 'verdicts_recorded_disposition',
    label: 'Verdicts recorded',
    description: 'Verdicts recorded',
  },
  {
    key: 'verified_fixes_vs_silence',
    label: 'Fixes vs silence',
    description: 'Verified fixes vs silence',
  },
  {
    key: 'median_needs_human_to_decision_hours',
    label: 'Human → decision (h)',
    description: 'Needs-human → decision (median h)',
  },
  {
    key: 'verified_unattended_fixes_per_week',
    label: 'Unattended fixes / wk',
    description: 'Verified unattended fixes / week',
  },
  { key: 'poller_ages', label: 'Poller age (min)', description: 'Poller ages' },
  { key: 'reverts_and_reopens', label: 'Reverts & reopens', description: 'Reverts & reopens' },
]

/** A scalar the detail lines are allowed to render directly — anything else (an array, a nested
 * object) needs its own handling rather than a bare `String()`/`JSON.stringify()`. */
type Scalar = number | string | boolean | null

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Detail lines never exceed this — past it the full metric is not worth cramming into a tile;
 * it stays reachable through the tile's `info` tooltip instead. */
const MAX_DETAIL_LINES = 4

/**
 * Renders every field beside `value`/`unavailable` as a compact `"key: value"` line — the extra
 * fields differ per metric (numerator/denominator, fixed/quiet/closed/dismissed, pairs, …) and this
 * stays generic rather than hardcoding each metric's shape.
 *
 * A key ending in `_note` is dropped — it is prose written for the API doc, not a number the tile
 * should surface. A nested object (e.g. `item_states`) never stringifies to JSON: it collapses into
 * ONE line naming its own scalar children (`item_states · closed 4 · fixed 1 · …`). Capped at
 * `MAX_DETAIL_LINES` lines total.
 */
function detailFromMetric(metric: Record<string, unknown> | undefined): string {
  if (!metric) return ''
  const skip = new Set(['value', 'unavailable'])
  const lines: string[] = []
  for (const [key, value] of Object.entries(metric)) {
    if (skip.has(key) || key.endsWith('_note')) continue
    if (isScalar(value)) {
      lines.push(`${key}: ${String(value)}`)
      continue
    }
    if (isPlainObject(value)) {
      const children = Object.entries(value)
        .filter(([childKey, childValue]) => !childKey.endsWith('_note') && isScalar(childValue))
        .map(([childKey, childValue]) => `${childKey} ${String(childValue)}`)
      if (children.length > 0) lines.push([key, ...children].join(' · '))
    }
  }
  return lines.slice(0, MAX_DETAIL_LINES).join(' · ')
}

/** A metric with no top-level `value` key at all (only `reverts_and_reopens` today) is a
 * composite — its children are themselves `{value, unavailable}` pairs, not siblings of a leaf. */
function isCompositeMetric(
  metric: Record<string, unknown> | undefined,
): metric is Record<string, Record<string, unknown>> {
  return metric !== undefined && !('value' in metric)
}

/** Renders one composite child as `key: n/a — reason` or `key: value` — a real `0` prints as `0`,
 * never as "n/a", per the same never-fabricate-zero rule as a leaf metric. */
function formatCompositeChild(child: Record<string, unknown> | undefined): string {
  const value = child?.['value']
  if (typeof value === 'number') return String(value)
  const reason = typeof child?.['unavailable'] === 'string' ? child['unavailable'] : 'not reported'
  return `n/a — ${reason}`
}

function detailFromComposite(metric: Record<string, Record<string, unknown>>): string {
  return Object.entries(metric)
    .map(([key, child]) => `${key}: ${formatCompositeChild(child)}`)
    .join(' · ')
}

/**
 * The six funnel tiles, fixed order. A `null` value ALWAYS pairs with a non-empty `unavailable`
 * reason — including when warden omitted the metric entirely, which reads as "not reported" rather
 * than a silent zero. `reverts_and_reopens` is a composite (see `isCompositeMetric`): its headline
 * is the first child with a non-null `value` — a real measurement like `reverts: 0`, not a
 * fabricated zero — falling back to "n/a" with the first child's reason when every child is null.
 */
export function deriveFunnel(metrics: WardenMetrics | undefined): FunnelTile[] {
  return FUNNEL_DEFS.map(({ key, label, description }) => {
    const metric = metrics?.[key] as Record<string, unknown> | undefined

    if (isCompositeMetric(metric)) {
      const children = Object.values(metric)
      const headline = children.find((child) => typeof child['value'] === 'number')
      const value = typeof headline?.['value'] === 'number' ? (headline['value'] as number) : null
      const unavailable =
        value === null
          ? typeof children[0]?.['unavailable'] === 'string'
            ? (children[0]['unavailable'] as string)
            : 'not reported'
          : null
      return { key, label, description, value, unavailable, detail: detailFromComposite(metric) }
    }

    const rawValue = metric?.['value']
    const value = typeof rawValue === 'number' ? rawValue : null
    const rawUnavailable = metric?.['unavailable']
    const unavailable =
      typeof rawUnavailable === 'string' ? rawUnavailable : value === null ? 'not reported' : null
    return { key, label, description, value, unavailable, detail: detailFromMetric(metric) }
  })
}

// ── Tile formatting ──────────────────────────────────────────────────────────

/** The two ratio-shaped metrics (already fractions 0..1) — everything else on the board is a plain
 * measurement (hours, minutes, a count), never a percentage. */
const PERCENT_KEYS = new Set(['verdicts_recorded_disposition', 'verified_fixes_vs_silence'])

/** Rounds to at most one decimal place and drops a trailing `.0` — `4.695051216666667` reads as
 * `4.7`, a whole number like `0` or `5` stays an integer, never `"5.0"`. */
export function formatTileNumber(value: number): string {
  const fixed = value.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

/**
 * The tile headline. `null` reads as `"n/a"` (paired with `tile.unavailable`'s reason, surfaced
 * separately). The two ratio keys render as a whole percent; every other tile — hours, minutes,
 * counts — renders through `formatTileNumber`, never the raw float a metric was measured at.
 */
export function formatTileValue(tile: FunnelTile): string {
  if (tile.value === null) return 'n/a'
  if (PERCENT_KEYS.has(tile.key)) return `${Math.round(tile.value * 100)}%`
  return formatTileNumber(tile.value)
}

// ── Intents ──────────────────────────────────────────────────────────────────

export type IntentSummary = {
  pending: number
  rejected: number
  entries: NonNullable<WardenIntents['entries']>
}

/** A recorded intent is a wish, never an authorization — see `intents-section.tsx`. This only
 * normalizes the counts and entry list so a missing `intents` block reads as "none recorded". */
export function intentSummary(intents: WardenIntents | undefined): IntentSummary {
  return {
    pending: intents?.pending ?? 0,
    rejected: intents?.rejected ?? 0,
    entries: intents?.entries ?? [],
  }
}

// ── Item timeline ────────────────────────────────────────────────────────────
// `item-timeline.tsx` renders one item/event pair plus its transitions, dispatches, operations and
// approvals. Every read here is defensive — field names vary slightly between warden's producers —
// so the derivations live here, pure and unit-tested, rather than inline in JSX where a dozen small
// branches add up to one unreadable, untestable function.

/** The item/event/dispatch/operation/transition/approval rows all arrive as loosely-validated
 * jsonb — a generic key/value bag rather than one exact shape. */
export type Row = Record<string, unknown>

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Counts and totals arrive as real numbers when warden computes them; an absent field — several
 * (the reminder counts, the `*_total` caps) are only now being added warden-side — reads as null
 * rather than 0, so a reminder line never renders for a count that was never reported. */
export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Matches by name, not an exact list — `secret`/`token` alone missed `password`, `nonce`,
 * `signature` and any `*_key` field a producer might add later. */
const SENSITIVE_KEY_PATTERN = /secret|token|password|nonce|signature|key$/i

/** A compact `"key: value"` line over every field but the ones already rendered explicitly and
 * any field whose name looks sensitive — defensive against field names varying slightly between
 * warden's producers. */
export function summarizeRow(row: Row, skip: string[]): string {
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

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function externalIdOf(event: Row | null): string | null {
  const raw = event?.['external_id']
  return str(raw) ?? (typeof raw === 'number' ? String(raw) : null)
}

function seenParts(item: Row | null): string[] {
  const firstSeen = str(item?.['first_seen'])
  const lastSeen = str(item?.['last_seen'])
  return [
    firstSeen ? `first seen ${relativeTime(firstSeen)}` : null,
    lastSeen ? `last seen ${relativeTime(lastSeen)}` : null,
  ].filter((part): part is string => part !== null)
}

/** "first seen … · last seen … · N occurrences" — any of the three parts may be absent; `null`
 * only when none of them are present. */
function seenAndOccurrencesLine(item: Row | null): string | null {
  const occurrences = num(item?.['occurrences'])
  const occurrenceText = occurrences !== null ? pluralize(occurrences, 'occurrence') : null
  const parts = [...seenParts(item), occurrenceText].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

function resolvedLine(event: Row | null): string | null {
  const resolvedAt = str(event?.['resolved_at'])
  return resolvedAt ? `resolved ${relativeTime(resolvedAt)}` : null
}

function deadlineLine(item: Row | null): string | null {
  const deadline = str(item?.['state_deadline'])
  return deadline ? `deadline ${relativeTime(deadline)}` : null
}

function alertReminderLine(event: Row | null): string | null {
  const count = num(event?.['reminder_count'])
  if (count === null || count <= 0) return null
  const last = str(event?.['last_reminder_at'])
  return `Alert reminders: ${count}${last ? ` (last ${relativeTime(last)})` : ''}`
}

function needsHumanReminderLine(item: Row | null): string | null {
  const count = num(item?.['reminder_count'])
  return count !== null && count > 0 ? `Needs-human reminders: ${count}` : null
}

/** The tracking-facts lines below the identity header, in fixed order — only the ones with
 * something to say. */
function buildFactLines(item: Row | null, event: Row | null): string[] {
  return [
    seenAndOccurrencesLine(item),
    resolvedLine(event),
    deadlineLine(item),
    alertReminderLine(event),
    needsHumanReminderLine(item),
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
 * signature), the tracking-fact lines (seen/occurrences, resolved, deadline, the two reminder
 * counts) and the prose (note, brief, or — for a brief-less alert — the event payload). Fields vary
 * between warden's producers, so every read is defensive.
 */
export function buildItemFacts(item: Row | null, event: Row | null): ItemFacts {
  const origin = str(item?.['origin'])
  const brief = str(item?.['brief'])
  return {
    title: str(event?.['title']) ?? str(item?.['title']),
    source: str(event?.['source']),
    externalId: externalIdOf(event),
    state: str(item?.['state']),
    origin,
    signature: str(item?.['signature']),
    lines: buildFactLines(item, event),
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
  approvals: Row[]
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
    approvals: asRows(source['approvals']),
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
