import type {
  WardenActionVerb,
  WardenBoard,
  WardenBoardItem,
  WardenBudget,
  WardenHealth,
  WardenMetrics,
} from '../../lib/queries/warden'
import type { DecisionCardFact } from '../../components/upstream/decision-card-model'
import {
  formatAgeDays,
  isDeferredItem,
  isStale,
  TERMINAL_STATES,
  pluralize,
  type AwaitingOwnerRow,
  type AwaitingOwnerView,
} from './model'

// Pure derivations for the redesigned Warden page: the summary sentence, the health strip, the
// budget meters, the poller list, the decision-card copy and the board columns. Argo still derives
// nothing warden did not already compute — this only reads, groups and words it.

// ── Metric reading ──────────────────────────────────────────────────────────

type Bag = Record<string, unknown>

function bag(value: unknown): Bag | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Bag)
    : undefined
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A leaf metric's reading. A `null` value ALWAYS pairs with a reason (warden's own, or "not
 * reported" when the metric is missing altogether) — never a silent zero. */
export type Reading = { value: number | null; unavailable: string | null }

export function readLeaf(metric: unknown): Reading {
  const m = bag(metric)
  const value = numberOf(m?.['value'])
  if (value !== null) return { value, unavailable: null }
  const reason = m?.['unavailable']
  return {
    value: null,
    unavailable: typeof reason === 'string' && reason ? reason : 'not reported',
  }
}

// ── Health strip ────────────────────────────────────────────────────────────

/** The stale mark and the right end of the poller scale (`STALE_AFTER_MS` in minutes). */
export const POLLER_SCALE_MIN = 30

/** The loop's own default window when a metric does not carry one. */
const DEFAULT_WINDOW_DAYS = 7

export type StripModel = {
  verdicts: {
    pct: number | null
    numerator: number | null
    denominator: number | null
    unavailable: string | null
  }
  fixes: {
    pct: number | null
    fixed: number | null
    quiet: number | null
    closed: number | null
    unavailable: string | null
  }
  wait: {
    hours: number | null
    pairs: number | null
    windowDays: number
    unavailable: string | null
  }
  unattended: { fixes: number | null; windowDays: number; unavailable: string | null }
  poller: {
    oldestMin: number | null
    thresholdMin: number
    stale: boolean
    unavailable: string | null
  }
  reverts: {
    reverts: number | null
    revertsUnavailable: string | null
    reopens: number | null
    reopensUnavailable: string | null
    windowDays: number
  }
}

export type PollerRow = {
  name: string
  ageMin: number
  thresholdMin: number | null
  stale: boolean
}

/** Every poller with a reported age, oldest first. `metrics.poller_ages.pollers` wins, with
 * `health.pollers` as the fallback for an older warden. */
export function derivePollers(
  metrics: WardenMetrics | undefined,
  health: WardenHealth | undefined,
): PollerRow[] {
  const fromMetrics = bag(bag(metrics?.poller_ages)?.['pollers'])
  const source = fromMetrics ?? bag(health?.pollers) ?? {}
  const rows: PollerRow[] = []
  for (const [name, entry] of Object.entries(source)) {
    const e = bag(entry)
    const ageMin = numberOf(e?.['age_minutes'])
    if (ageMin === null) continue
    const thresholdMin = numberOf(e?.['threshold_minutes'])
    const stale =
      e?.['stale'] === true || e?.['ok'] === false || ageMin >= (thresholdMin ?? POLLER_SCALE_MIN)
    rows.push({ name, ageMin, thresholdMin, stale })
  }
  return rows.toSorted((a, b) => b.ageMin - a.ageMin)
}

export function deriveStrip(
  metrics: WardenMetrics | undefined,
  health: WardenHealth | undefined,
): StripModel {
  const verdicts = bag(metrics?.verdicts_recorded_disposition)
  const verdictsReading = readLeaf(verdicts)
  const fixes = bag(metrics?.verified_fixes_vs_silence)
  const fixesReading = readLeaf(fixes)
  const fixed = numberOf(fixes?.['fixed'])
  const quiet = numberOf(fixes?.['quiet'])
  const wait = bag(metrics?.median_needs_decision_to_decision_hours)
  const waitReading = readLeaf(wait)
  const unattended = bag(metrics?.verified_unattended_fixes_per_week)
  const unattendedReading = readLeaf(unattended)
  const pollerReading = readLeaf(metrics?.poller_ages)
  const pollers = derivePollers(metrics, health)
  const revertsMetric = bag(metrics?.reverts_and_reopens)
  const revertsReading = readLeaf(revertsMetric?.['reverts'])
  const reopensReading = readLeaf(revertsMetric?.['reopen_after_fixed'])
  // No headline share without the counts it is the share of.
  const countsReported = fixed !== null || quiet !== null
  const fixedShare = !countsReported
    ? null
    : (fixesReading.value ??
      (fixed !== null && quiet !== null && fixed + quiet > 0 ? fixed / (fixed + quiet) : null))

  return {
    verdicts: {
      pct: verdictsReading.value === null ? null : verdictsReading.value * 100,
      numerator: numberOf(verdicts?.['numerator']),
      denominator: numberOf(verdicts?.['denominator']),
      unavailable: verdictsReading.unavailable,
    },
    fixes: {
      pct: fixedShare === null ? null : fixedShare * 100,
      fixed,
      quiet,
      closed: numberOf(fixes?.['closed']),
      unavailable:
        fixedShare === null
          ? countsReported
            ? (fixesReading.unavailable ?? 'not reported')
            : 'counts not reported'
          : null,
    },
    wait: {
      hours: waitReading.value,
      pairs: numberOf(wait?.['pairs']),
      windowDays:
        numberOf(wait?.['window_days']) ?? numberOf(metrics?.window_days) ?? DEFAULT_WINDOW_DAYS,
      unavailable: waitReading.unavailable,
    },
    unattended: {
      fixes: unattendedReading.value,
      windowDays: numberOf(unattended?.['window_days']) ?? DEFAULT_WINDOW_DAYS,
      unavailable: unattendedReading.unavailable,
    },
    poller: {
      oldestMin: pollers[0]?.ageMin ?? pollerReading.value,
      thresholdMin: pollers[0]?.thresholdMin ?? POLLER_SCALE_MIN,
      stale: pollers[0]?.stale ?? (pollerReading.value ?? 0) >= POLLER_SCALE_MIN,
      unavailable: pollers[0] || pollerReading.value !== null ? null : pollerReading.unavailable,
    },
    reverts: {
      reverts: revertsReading.value,
      revertsUnavailable: revertsReading.unavailable,
      reopens: reopensReading.value,
      reopensUnavailable: reopensReading.unavailable,
      windowDays:
        numberOf(bag(revertsMetric?.['reverts'])?.['window_days']) ??
        numberOf(metrics?.window_days) ??
        DEFAULT_WINDOW_DAYS,
    },
  }
}

/** One decimal at most, no trailing `.0`: `4.695` → `4.7`, `5` → `5`. */
export function formatNumber(value: number): string {
  const fixed = value.toFixed(1)
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed
}

// ── Budget ──────────────────────────────────────────────────────────────────

/** Past this share of the daily cap the meter reads as a warning. */
const BUDGET_WARN_SHARE = 0.9

export type BudgetMeter = {
  key: 'dispatch' | 'implement'
  /** The meter's own name for per-meter wording (`Dispatch`, `Implement`). */
  name: string
  caption: string
  used: number | null
  max: number | null
  warn: boolean
}

export function deriveBudget(budget: WardenBudget | undefined): BudgetMeter[] {
  const build = (
    key: BudgetMeter['key'],
    name: string,
    caption: string,
    used: number | undefined,
    max: number | undefined,
  ): BudgetMeter => {
    const u = numberOf(used)
    const m = numberOf(max)
    return {
      key,
      name,
      caption,
      used: u,
      max: m,
      warn: u !== null && m !== null && m > 0 && u / m >= BUDGET_WARN_SHARE,
    }
  }
  return [
    build('dispatch', 'Dispatch', 'DISPATCH · today', budget?.usedToday, budget?.max),
    build(
      'implement',
      'Implement',
      'IMPLEMENT · today',
      budget?.implementToday,
      budget?.implementMax,
    ),
  ]
}

/** Both meters missing means warden reports no budget at all: one muted line, not two empty boxes. */
export type BudgetFooter = { kind: 'not-reported' } | { kind: 'meters'; meters: BudgetMeter[] }

export function deriveBudgetFooter(budget: WardenBudget | undefined): BudgetFooter {
  const meters = deriveBudget(budget)
  const reported = meters.some((meter) => meter.used !== null && meter.max !== null)
  return reported ? { kind: 'meters', meters } : { kind: 'not-reported' }
}

// ── Summary sentence ────────────────────────────────────────────────────────

/** `"42 min"` / `"3.2 h"` / `"2.1 d"` — a span with a unit, never a bare number. */
export function formatSpan(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`
  const hours = minutes / 60
  if (hours < 48) return `${formatNumber(hours)} h`
  return `${formatNumber(hours / 24)} d`
}

export type SummaryInput = {
  needsCount: number
  oldestAgeDays: number | null
  receivedAt: string | null
  oldestPollerMin: number | null
  unattendedFixes: number | null
  windowDays: number
  stalePoller: PollerRow | null
  /** `health.ok` from the snapshot; `false` is never read as a healthy loop. */
  healthOk?: boolean | undefined
  now?: number
}

/** `stalled` (no fresh snapshot) and `degraded` (a stale poller) are loud; `ok` is plain text. */
export type SummaryStatus = 'ok' | 'degraded' | 'stalled'

export function deriveSummary(input: SummaryInput): { text: string; status: SummaryStatus } {
  const { needsCount, oldestAgeDays, receivedAt, now = Date.now() } = input
  const needs =
    needsCount === 0
      ? 'Nothing needs you'
      : `${pluralize(needsCount, 'item')} ${needsCount === 1 ? 'needs' : 'need'} you${
          oldestAgeDays === null ? '' : `, oldest ${formatAgeDays(oldestAgeDays)}`
        }`
  if (isStale(receivedAt, now)) {
    const parsed = receivedAt === null ? Number.NaN : Date.parse(receivedAt)
    const age = Number.isFinite(parsed)
      ? ` — snapshot ${formatSpan(now - parsed)} old`
      : ' — no snapshot yet'
    return { text: `${needs}. Loop stalled${age}.`, status: 'stalled' }
  }
  if (input.stalePoller !== null) {
    return {
      text: `${needs}. Loop degraded: ${input.stalePoller.name} is ${formatNumber(input.stalePoller.ageMin)} min old.`,
      status: 'degraded',
    }
  }
  if (input.healthOk === false) {
    return {
      text: `${needs}. Loop degraded: warden's own health check is failing.`,
      status: 'degraded',
    }
  }
  const parts = [
    input.oldestPollerMin === null ? null : `poller ${formatNumber(input.oldestPollerMin)} min old`,
    input.unattendedFixes === null
      ? null
      : `${input.unattendedFixes === 1 ? '1 fix' : `${formatNumber(input.unattendedFixes)} fixes`} in ${input.windowDays} d`,
  ].filter((part): part is string => part !== null)
  return {
    text:
      parts.length === 0
        ? `${needs}. Loop healthy.`
        : `${needs}. Loop healthy: ${parts.join(', ')}.`,
    status: 'ok',
  }
}

// ── Decision cards ──────────────────────────────────────────────────────────

// Mirrors `isKnownActionVerb` (lib/queries/warden) without importing it: that module builds the
// API client at load, which would make this file untestable without a DOM. The record keeps the
// list exhaustive against `WardenActionVerb`.
const KNOWN_VERBS = {
  implement: true,
  merge: true,
  dismiss: true,
  reinvestigate: true,
  retry: true,
  note: true,
} satisfies Record<WardenActionVerb, true>

function isKnownVerb(verb: string): verb is WardenActionVerb {
  return Object.hasOwn(KNOWN_VERBS, verb)
}

export type QueueKind = 'decision' | 'failed'

const PRIMARY_ORDER: Record<QueueKind, readonly WardenActionVerb[]> = {
  decision: ['implement', 'merge', 'retry', 'reinvestigate', 'dismiss', 'note'],
  failed: ['retry', 'merge', 'implement', 'reinvestigate', 'dismiss', 'note'],
}

const SECONDARY_ORDER: Record<QueueKind, readonly WardenActionVerb[]> = {
  decision: ['dismiss', 'merge'],
  failed: ['merge', 'dismiss'],
}

export type ActionPlan = {
  primary: WardenActionVerb | null
  secondary: WardenActionVerb | null
  menu: WardenActionVerb[]
}

/** One primary, at most one secondary, everything else in the menu — by fixed priority, over the
 * verbs warden offers and this dashboard knows (`isKnownActionVerb`). */
export function planActions(available: readonly string[], kind: QueueKind): ActionPlan {
  const offered = new Set(available.filter(isKnownVerb))
  const order = PRIMARY_ORDER[kind]
  const primary = order.find((verb) => offered.has(verb)) ?? null
  const secondary =
    SECONDARY_ORDER[kind].find((verb) => verb !== primary && offered.has(verb)) ?? null
  const menu = order.filter((verb) => offered.has(verb) && verb !== primary && verb !== secondary)
  return { primary, secondary, menu }
}

/** Warden prefixes some decision text with a bracketed category: `[blocker] Deploy …`. */
const LEADING_TAG = /^\[([^\]]{1,40})\]\s*/

/** `BLOCKER` / `data_loss` → `Blocker` / `Data loss`: a category word reads as a sentence, not an enum. */
export function sentenceCase(raw: string): string {
  const words = raw
    .trim()
    .replaceAll(/[_\s]+/g, ' ')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The first complete sentence of warden's decision text is the question; whatever follows is the
 * evidence. A leading `[tag]` is lifted out as `tag` so the headline starts at the question.
 * Nothing is ever cut mid-sentence — a long first sentence is the headline as written. */
export function splitReason(
  reason: string | null,
  fallback: string,
): { tag: string | null; question: string; rest: string | null } {
  const raw = reason?.trim() ?? ''
  const tagMatch = LEADING_TAG.exec(raw)
  const tag = tagMatch?.[1] ?? null
  const text = tagMatch ? raw.slice(tagMatch[0].length).trim() : raw
  if (text === '') return { tag, question: fallback, rest: null }
  const match = /^(.+?[.?!])(?:\s+|$)/s.exec(text)
  const first = match?.[1]
  if (first === undefined || first.length >= text.length) return { tag, question: text, rest: null }
  const rest = text.slice(match![0].length).trim()
  return { tag, question: first, rest: rest === '' ? null : rest }
}

/** `Retry <title>?` — a title that already ends in punctuation does not get a second mark. */
export function retryQuestion(title: string): string {
  return `Retry ${title.trim().replace(/[.!?…:;,]+$/, '')}?`
}

/** `<repo> · waiting <n> d · revision <n> · <n> redrives` — only the parts warden reported. */
/** A decision waiting longer than this many days gets a warning tone on its age. */
const WAIT_WARN_DAYS = 2

export function cardFacts(row: AwaitingOwnerRow): DecisionCardFact[] {
  const waiting =
    row.ageDays === null
      ? ''
      : row.ageDays > WAIT_WARN_DAYS
        ? { text: `waiting ${formatAgeDays(row.ageDays)}`, tone: 'warn' as const }
        : `waiting ${formatAgeDays(row.ageDays)}`
  return [
    row.repo ?? '',
    waiting,
    `revision ${row.revisionCount}`,
    row.redrives > 0 ? pluralize(row.redrives, 'redrive') : '',
  ].filter((part) => part !== '')
}

/** Cards in one list: needs-decision first, then any awaiting entry in a state this page does not
 * know — every awaiting entry stays visible, none is dropped. */
export function needsCards(view: AwaitingOwnerView): AwaitingOwnerRow[] {
  return [...view.needsDecision, ...view.other]
}

export function oldestAgeDays(rows: readonly AwaitingOwnerRow[]): number | null {
  const ages = rows.map((row) => row.ageDays).filter((age): age is number => age !== null)
  return ages.length === 0 ? null : Math.max(...ages)
}

const ORIGIN_KINDS = { alert: true, github_issue: true, human: true, job: true } as const
export type OriginKind = keyof typeof ORIGIN_KINDS

/** A wire `origin` narrowed to the kinds the board has a glyph for; anything else is `null`. */
export function originKind(origin: string | null | undefined): OriginKind | null {
  return typeof origin === 'string' && Object.hasOwn(ORIGIN_KINDS, origin)
    ? (origin as OriginKind)
    : null
}

// ── Board ───────────────────────────────────────────────────────────────────

export const BOARD_COLUMN_KEYS = [
  'new',
  'triaged',
  'working',
  'merging',
  'verifying',
  'other',
] as const
export type BoardColumnKey = (typeof BOARD_COLUMN_KEYS)[number]

const BOARD_COLUMN_LABEL: Record<BoardColumnKey, string> = {
  new: 'New',
  triaged: 'Triaged',
  working: 'Working',
  merging: 'Merging',
  verifying: 'Verifying',
  other: 'Other',
}

export type BoardColumn = { key: BoardColumnKey; label: string; items: WardenBoardItem[] }

/** `needs_decision` and `failed` are decision-card states: an item in one of them leaves the board
 * only when a card actually claimed it, otherwise it lands in Other with its raw state. */
const QUEUE_STATES = new Set(['needs_decision', 'failed'])

/**
 * Each open item exactly once. An item claimed by a decision card (`claimed` event ids) or in a
 * terminal state is left out; an unclaimed queue-state item and any state outside the known columns
 * land in `other` with their raw state; `other` is dropped entirely when empty. Deferred items stay
 * in Working (flagged by the card).
 */
export function deriveBoardColumns(
  board: WardenBoard | undefined,
  claimed: ReadonlySet<number>,
): BoardColumn[] {
  const columns = new Map<BoardColumnKey, WardenBoardItem[]>(
    BOARD_COLUMN_KEYS.map((key) => [key, []]),
  )
  for (const item of board?.items ?? []) {
    if (claimed.has(item.event_id) || TERMINAL_STATES.has(item.state)) continue
    const known =
      !QUEUE_STATES.has(item.state) &&
      item.state !== 'other' &&
      (BOARD_COLUMN_KEYS as readonly string[]).includes(item.state)
    columns.get(known ? (item.state as BoardColumnKey) : 'other')?.push(item)
  }
  return BOARD_COLUMN_KEYS.filter(
    (key) => key !== 'other' || (columns.get(key)?.length ?? 0) > 0,
  ).map((key) => ({ key, label: BOARD_COLUMN_LABEL[key], items: columns.get(key) ?? [] }))
}

export function openCount(columns: readonly BoardColumn[]): number {
  return columns.reduce((sum, column) => sum + column.items.length, 0)
}

/** The label a stale poller carries: its own threshold, else the 30 minute scale. `null` when fresh. */
export function pollerStaleLabel(poller: PollerRow): string | null {
  return poller.stale ? `stale at ${poller.thresholdMin ?? POLLER_SCALE_MIN} min` : null
}

/** Deferral on the board: the marker follows `isDeferredItem`; the note only supplies the detail. */
export function deferralOf(item: WardenBoardItem): { deferred: boolean; detail: string | null } {
  return { deferred: isDeferredItem(item), detail: deferredNote(item) }
}

/** The deferral note without its `deferred:` prefix — what budget was hit. */
export function deferredNote(item: WardenBoardItem): string | null {
  if (!isDeferredItem(item)) return null
  return item.note?.replace(/^deferred:\s*/, '').trim() || null
}

// ── Item history (decision-card preview) ────────────────────────────────────

export type TransitionLine = { from: string; to: string; at: string | null }

/** The last `limit` state changes of one item, oldest first — the context beside a decision. A
 * synthetic `created` row has no `from`, so it reads `— → new`. */
export function recentTransitions(timeline: unknown, limit = 3): TransitionLine[] {
  const rows = bag(timeline)?.['transitions']
  if (!Array.isArray(rows)) return []
  const lines: TransitionLine[] = []
  for (const row of rows) {
    const r = bag(row)
    const to = typeof r?.['to_state'] === 'string' ? r['to_state'] : null
    if (to === null) continue
    const from = typeof r?.['from_state'] === 'string' ? r['from_state'] : '—'
    const at = typeof r?.['at'] === 'string' ? r['at'] : null
    lines.push({ from, to, at })
  }
  return lines.slice(-limit)
}
