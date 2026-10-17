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
  poller: { oldestMin: number | null; unavailable: string | null }
  reverts: {
    reverts: number | null
    reopens: number | null
    windowDays: number
    unavailable: string | null
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
    const stale = e?.['stale'] === true || e?.['ok'] === false
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
  const fixedShare =
    fixesReading.value ??
    (fixed !== null && quiet !== null && fixed + quiet > 0 ? fixed / (fixed + quiet) : null)

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
      unavailable: fixedShare === null ? (fixesReading.unavailable ?? 'not reported') : null,
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
      windowDays:
        numberOf(unattended?.['window_days']) ??
        numberOf(metrics?.window_days) ??
        DEFAULT_WINDOW_DAYS,
      unavailable: unattendedReading.unavailable,
    },
    poller: {
      oldestMin: pollers[0]?.ageMin ?? pollerReading.value,
      unavailable: pollers[0] || pollerReading.value !== null ? null : pollerReading.unavailable,
    },
    reverts: {
      reverts: revertsReading.value,
      reopens: reopensReading.value,
      windowDays:
        numberOf(bag(revertsMetric?.['reverts'])?.['window_days']) ??
        numberOf(metrics?.window_days) ??
        DEFAULT_WINDOW_DAYS,
      unavailable:
        revertsReading.value === null && reopensReading.value === null
          ? (revertsReading.unavailable ?? 'not reported')
          : null,
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
export const BUDGET_WARN_SHARE = 0.9

export type BudgetMeter = {
  key: 'dispatch' | 'implement'
  caption: string
  used: number | null
  max: number | null
  warn: boolean
}

export function deriveBudget(budget: WardenBudget | undefined): BudgetMeter[] {
  const build = (
    key: BudgetMeter['key'],
    caption: string,
    used: number | undefined,
    max: number | undefined,
  ): BudgetMeter => {
    const u = numberOf(used)
    const m = numberOf(max)
    return {
      key,
      caption,
      used: u,
      max: m,
      warn: u !== null && m !== null && m > 0 && u / m >= BUDGET_WARN_SHARE,
    }
  }
  return [
    build('dispatch', 'DISPATCH · today', budget?.usedToday, budget?.max),
    build('implement', 'IMPLEMENT · today', budget?.implementToday, budget?.implementMax),
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
  now?: number
}

export function deriveSummary(input: SummaryInput): string {
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
    return `${needs}. Loop stalled${age}.`
  }
  if (input.stalePoller !== null) {
    return `${needs}. Loop degraded: ${input.stalePoller.name} is ${formatNumber(input.stalePoller.ageMin)} min old.`
  }
  const parts = [
    input.oldestPollerMin === null ? null : `poller ${formatNumber(input.oldestPollerMin)} min old`,
    input.unattendedFixes === null
      ? null
      : `${input.unattendedFixes === 1 ? '1 fix' : `${formatNumber(input.unattendedFixes)} fixes`} in ${input.windowDays} d`,
  ].filter((part): part is string => part !== null)
  return parts.length === 0
    ? `${needs}. Loop healthy.`
    : `${needs}. Loop healthy: ${parts.join(', ')}.`
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

const TAG_TONE: Record<string, ChipTone> = { blocker: 'bad', data_loss: 'bad', security: 'warn' }

/** A leading `[tag]` as a chip: known tags take a tone, any other renders neutral with its raw label. */
export function tagChip(tag: string): { tone: ChipTone; label: string } {
  const key = tag.trim().toLowerCase().replaceAll(' ', '_')
  return { tone: TAG_TONE[key] ?? 'neutral', label: tag.trim() }
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
export const WAIT_WARN_DAYS = 2

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

// ── Failure class ───────────────────────────────────────────────────────────

export type ChipTone = 'work' | 'infra' | 'policy' | 'bad' | 'warn' | 'neutral'

/** `failure_class` is an open string: the three known classes get a fixed tone, any other value is
 * a neutral chip with its raw label, `null` renders no chip at all. */
export function failureChip(failureClass: string | null): { tone: ChipTone; label: string } | null {
  if (failureClass === null || failureClass === '') return null
  if (failureClass === 'work' || failureClass === 'infra' || failureClass === 'policy') {
    return { tone: failureClass, label: failureClass }
  }
  return { tone: 'neutral', label: failureClass }
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

export const BOARD_COLUMN_LABEL: Record<BoardColumnKey, string> = {
  new: 'New',
  triaged: 'Triaged',
  working: 'Working',
  merging: 'Merging',
  verifying: 'Verifying',
  other: 'Other',
}

export type BoardColumn = { key: BoardColumnKey; label: string; items: WardenBoardItem[] }

/** `needs_decision` and `failed` live in the decision cards, never as board columns. */
const QUEUE_STATES = new Set(['needs_decision', 'failed'])

/**
 * Each open item exactly once. Items already on a decision card (by state, or by an
 * `awaiting_owner` entry) are left out; a state outside the known columns lands in `other`;
 * `other` is dropped entirely when empty. Deferred items stay in Working (flagged by the card).
 */
export function deriveBoardColumns(board: WardenBoard | undefined): BoardColumn[] {
  const claimed = new Set(
    (board?.awaiting_owner ?? [])
      .map((entry) => entry.event_id)
      .filter((id): id is number => id !== null),
  )
  const known = new Set<string>(BOARD_COLUMN_KEYS)
  const columns = new Map<BoardColumnKey, WardenBoardItem[]>(
    BOARD_COLUMN_KEYS.map((key) => [key, []]),
  )
  for (const item of board?.items ?? []) {
    if (QUEUE_STATES.has(item.state) || claimed.has(item.event_id)) continue
    const key =
      known.has(item.state) && item.state !== 'other' ? (item.state as BoardColumnKey) : 'other'
    columns.get(key)?.push(item)
  }
  return BOARD_COLUMN_KEYS.filter(
    (key) => key !== 'other' || (columns.get(key)?.length ?? 0) > 0,
  ).map((key) => ({ key, label: BOARD_COLUMN_LABEL[key], items: columns.get(key) ?? [] }))
}

export function openCount(columns: readonly BoardColumn[]): number {
  return columns.reduce((sum, column) => sum + column.items.length, 0)
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
