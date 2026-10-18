import type {
  WardenActionVerb,
  WardenBoard,
  WardenBoardItem,
  WardenBudget,
  WardenHealth,
  WardenMetrics,
} from '../../lib/queries/warden'
import { authoredQuestion, stripShortcodes } from '../../lib/text'
import {
  ALERT_KIND,
  cardCopy,
  collidingCopies,
  wardenPlainQuestion,
  type CardCopy,
} from '../../lib/question-copy'
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
    /** The oldest poller's own name and how many pollers report; `null` when only the leaf value is known. */
    name: string | null
    count: number
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
      name: pollers[0]?.name ?? null,
      count: pollers.length,
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

/** How often Warden pushes a snapshot to Argo. */
const WARDEN_PUSH_MIN = 10

/** What a missing budget says: the cause is on warden's side, the fix is its next push. */
export const BUDGET_MISSING = {
  both: `Dispatch and implement budget not reported yet. Warden sends it with each push (about every ${WARDEN_PUSH_MIN}\u00a0min).`,
  one: (name: string) =>
    `${name} budget not reported yet. Warden sends it with each push (about every ${WARDEN_PUSH_MIN}\u00a0min).`,
  short: `Not reported yet; Warden sends it with each push, about every ${WARDEN_PUSH_MIN}\u00a0min.`,
} as const

// ── Summary sentence ────────────────────────────────────────────────────────

/** `"42 min"` / `"3.2 h"` / `"2.1 d"` — a span with a unit, never a bare number. */
export function formatSpan(ms: number): string {
  const minutes = ms / 60_000
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}\u00a0min`
  const hours = minutes / 60
  if (hours < 48) return `${formatNumber(hours)}\u00a0h`
  return `${formatNumber(hours / 24)}\u00a0d`
}

export type WardenSummaryInput = {
  needsCount: number
  oldestAgeDays: number | null
  receivedAt: string | null
  stalePoller: PollerRow | null
  /** `health.ok` from the snapshot; `false` is never read as a healthy loop. */
  healthOk?: boolean | undefined
  now?: number
}

/** `stalled` (no fresh snapshot) and `degraded` (a stale poller) are loud; `ok` is plain text. */
export type SummaryStatus = 'ok' | 'degraded' | 'stalled'

/**
 * The headline sentence: how long the queue has waited and the loop's verdict. The health strip
 * under it prints the poller age, the fixes and the budget, the cards' sections print the counts, so
 * no figure here repeats them.
 */
export function deriveSummary(input: WardenSummaryInput): {
  text: string
  status: SummaryStatus
} {
  const { needsCount, oldestAgeDays, receivedAt, now = Date.now() } = input
  // The sections under it print the counts; the headline names the one figure they do not.
  const needs =
    needsCount === 0
      ? 'Nothing needs you'
      : oldestAgeDays === null
        ? 'Items are waiting on you'
        : `Oldest wait on you ${formatAgeDays(oldestAgeDays)}`
  if (isStale(receivedAt, now)) {
    const parsed = receivedAt === null ? Number.NaN : Date.parse(receivedAt)
    const age = Number.isFinite(parsed)
      ? ` — snapshot ${formatSpan(now - parsed)} old`
      : ' — no snapshot yet'
    return { text: `${needs}. Loop stalled${age}.`, status: 'stalled' }
  }
  if (input.stalePoller !== null) {
    return {
      text: `${needs}. Loop degraded: ${input.stalePoller.name} is ${formatNumber(input.stalePoller.ageMin)}\u00a0min old.`,
      status: 'degraded',
    }
  }
  if (input.healthOk === false) {
    return {
      text: `${needs}. Loop degraded: warden's own health check is failing.`,
      status: 'degraded',
    }
  }
  return { text: `${needs}. Loop healthy.`, status: 'ok' }
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

/** Enum-like values the warden API emits (`data_loss`, `BLOCKER`) read as a sentence: `Data loss`,
 * `Blocker`. Only all-lowercase or UPPER_SNAKE values are transformed; a token that mixes cases
 * (`GitHub`, `OOMKilled`) or is a short acronym (`CI`, `HTTP`) is left as written. Blank or
 * underscore-only input is `null`. */
export function sentenceCase(raw: string): string | null {
  const words = raw.split(/[_\s]+/).filter(Boolean)
  const first = words[0]
  if (first === undefined) return null
  const upperEnum =
    words.every((word) => /^[A-Z0-9]+$/.test(word)) && (words.length > 1 || first.length > 4)
  const text = (upperEnum ? words.map((word) => word.toLowerCase()) : words).join(' ')
  // A first token that already carries an uppercase letter (`iOS`, `CI`) is not ours to recase.
  return /[A-Z]/.test(first) && !upperEnum ? text : text.charAt(0).toUpperCase() + text.slice(1)
}

/** A tag that only says there is no category (`[no category]`, `[none]`) is no category at all. */
const PLACEHOLDER_CATEGORY = /^(?:no|none|n\/a|unknown|uncategori[sz]ed)(?:\s+category)?$/i

/** The word a decision/failed card shows before its facts: the failure class, or the lifted `[tag]`.
 * Blank, whitespace-only or placeholder text is `null`, so the caller falls back instead of rendering a bare dot. */
export function cardCategory(
  kind: QueueKind,
  tag: string | null,
  failureClass: string | null,
): string | null {
  const raw = kind === 'failed' ? failureClass : tag
  const trimmed = raw?.trim() ?? ''
  if (trimmed === '') return null
  // Only a lifted decision tag can be a placeholder; a failure class such as `unknown` is a real value.
  return kind === 'decision' && PLACEHOLDER_CATEGORY.test(trimmed) ? null : trimmed
}

/** The first complete sentence of warden's decision text is the question; whatever follows is the
 * evidence. A leading `[tag]` is lifted out as `tag` so the headline starts at the question.
 * Nothing is ever cut mid-sentence — a long first sentence is the headline as written. */
export function splitReason(reason: string | null): {
  tag: string | null
  question: string
  rest: string | null
} {
  const raw = reason?.trim() ?? ''
  const tagMatch = LEADING_TAG.exec(raw)
  const tag = tagMatch?.[1] ?? null
  const text = tagMatch ? raw.slice(tagMatch[0].length).trim() : raw
  if (text === '') return { tag, question: '', rest: null }
  const match = /^(.+?[.?!])(?:\s+|$)/s.exec(text)
  const first = match?.[1]
  if (first === undefined || first.length >= text.length) return { tag, question: text, rest: null }
  const rest = text.slice(match![0].length).trim()
  return { tag, question: first, rest: rest === '' ? null : rest }
}

/** What the Warden ask needs of an item; both `AwaitingOwnerRow` and a failed board item supply it. */
export type AskSource = {
  eventId: number
  repo: string | null
  title: string | null
  /** The wire `origin` (`alert`, `github_issue`, …); an alert is asked about as an alert. */
  origin?: string | null
  reason: string | null
  /** The raw producer `question`; read through `authoredQuestion`, so any junk reads as none. */
  question: unknown
  availableActions: readonly string[]
}

export type WardenAsk = {
  plan: ActionPlan
  /** The repo with shortcodes stripped; `''` when none. */
  repo: string
  /** The lifted `[tag]` of the reason. */
  tag: string | null
  copy: CardCopy
  /** The repo is already named by the question, so a facts line must not repeat it. */
  repoNamed: boolean
}

/** The question says the repo as a whole word (`api` is not named by `rapid`), whichever rung wrote it. */
function namesRepo(question: string, repo: string): boolean {
  if (repo === '') return false
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'i').test(question)
}

/**
 * Plan and copy of one Warden item, derived once: the verbs the card offers decide the plain
 * question, and the same result feeds the Warden card and the Home inbox. The authored question
 * comes first, then the reason's first sentence when it is a question, then the plain question,
 * with the shortcode-stripped title (`Item #<id>` when nothing is left) as the entity, whole.
 * A failed item's reason is all evidence.
 */
export function wardenAsk(source: AskSource, kind: QueueKind, withHandle = false): WardenAsk {
  const failed = kind === 'failed'
  const plan = planActions(source.availableActions, kind)
  const named = stripShortcodes(source.title ?? '')
  const title = named || `Item #${source.eventId}`
  const alert = source.origin === 'alert' || ALERT_KIND.test(named)
  const reason = source.reason === null ? null : stripShortcodes(source.reason)
  const plain = wardenPlainQuestion({ failed, repo: source.repo, primary: plan.primary, alert })
  const authored = authoredQuestion(source.question)
  const split = failed ? null : splitReason(reason)
  const copy = cardCopy({
    authored,
    ask: split?.question ?? '',
    body: split === null ? reason : split.rest,
    title,
    plain,
    handle: withHandle && named !== '' ? named : null,
  })
  const repo = stripShortcodes(source.repo ?? '')
  return { plan, repo, tag: split?.tag ?? null, copy, repoNamed: namesRepo(copy.question, repo) }
}

/**
 * The asks of every card on ONE surface, in input order: the short plain question, unless another
 * card of the surface would read the same — that card then carries its own handle.
 */
export function wardenAsks(
  entries: readonly { source: AskSource; kind: QueueKind }[],
): WardenAsk[] {
  const short = entries.map(({ source, kind }) => wardenAsk(source, kind))
  const clash = collidingCopies(short.map((ask) => ask.copy))
  return entries.map(({ source, kind }, i) =>
    clash[i] ? wardenAsk(source, kind, true) : short[i]!,
  )
}

/** A decision waiting longer than this many days gets a warning tone on its age. */
const WAIT_WARN_DAYS = 2

/** How often the item was retried and revised, as one fact; `''` when neither happened. */
function historyFact(row: AwaitingOwnerRow): string {
  return [
    row.redrives > 0 ? `retried ${pluralize(row.redrives, 'time')}` : '',
    row.revisionCount > 0 ? `revised ${pluralize(row.revisionCount, 'time')}` : '',
  ]
    .filter((part) => part !== '')
    .join(', ')
}

/** The repo (`''` when the question already names it) plus `waiting <n> d` and the item's history. */
export function cardFacts(
  row: AwaitingOwnerRow,
  repo = stripShortcodes(row.repo ?? ''),
): DecisionCardFact[] {
  const waiting =
    row.ageDays === null
      ? ''
      : row.ageDays > WAIT_WARN_DAYS
        ? { text: `waiting ${formatAgeDays(row.ageDays)}`, tone: 'warn' as const }
        : `waiting ${formatAgeDays(row.ageDays)}`
  return [repo, waiting, historyFact(row)].filter((part) => part !== '')
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
  return poller.stale ? `stale at ${poller.thresholdMin ?? POLLER_SCALE_MIN}\u00a0min` : null
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

/** One state change; `from` is `null` for the item's creation, `at` is `null` when untimed. */
export type TransitionLine = { from: string | null; to: string; at: string | null }

/** The shown transitions, carrying the item's real transition count so a preview can say how many
 * earlier ones it left out. A plain `TransitionLine[]` (no `total`) counts only its own lines. */
export type TransitionHistory = TransitionLine[] & { total?: number }

/** The last `limit` state changes of one item, oldest first — the context beside a decision. A
 * synthetic `created` row has no `from_state`, so its `from` is `null`. */
export function recentTransitions(timeline: unknown, limit = 3): TransitionHistory {
  const rows = bag(timeline)?.['transitions']
  if (!Array.isArray(rows)) return []
  const lines: TransitionLine[] = []
  for (const row of rows) {
    const r = bag(row)
    const to = typeof r?.['to_state'] === 'string' ? r['to_state'] : null
    if (to === null) continue
    const from = typeof r?.['from_state'] === 'string' ? r['from_state'] : null
    const at = typeof r?.['at'] === 'string' ? r['at'] : null
    lines.push({ from, to, at })
  }
  return Object.assign(lines.slice(-limit), { total: lines.length })
}

// ── History preview ─────────────────────────────────────────────────────────

/** `Needs decision → Working`; a creation row reads `Created` (or `Created → <state>`). */
export function transitionText({ from, to }: TransitionLine): string {
  const target = sentenceCase(to) ?? to
  if (from === null) return to === 'new' ? 'Created' : `Created → ${target}`
  return `${sentenceCase(from) ?? from} → ${target}`
}

export type HistoryView = {
  /** One transition is plain inline text; more earn the right-hand well. */
  layout: 'inline' | 'well'
  /** Newest first, every state named whole. */
  lines: { text: string; at: string | null }[]
  /** Transitions left out of `lines`. */
  earlier: number
}

export function historyView(history: TransitionHistory): HistoryView | null {
  const summary = historySummary(history, history.total)
  if (summary === null) return null
  return {
    layout: Math.max(history.total ?? 0, history.length) <= 1 ? 'inline' : 'well',
    lines: history.toReversed().map((line) => ({ text: transitionText(line), at: line.at })),
    earlier: summary.earlier - (history.length - 1),
  }
}

/** The newest state change plus how many earlier ones sit behind it — a card shows one line, not a log. */
export function historySummary(
  lines: readonly TransitionLine[],
  total: number = lines.length,
): {
  latest: TransitionLine
  earlier: number
} | null {
  const latest = lines.at(-1)
  return latest === undefined ? null : { latest, earlier: Math.max(total, lines.length) - 1 }
}

// ── Board layout ────────────────────────────────────────────────────────────

/** Columns with items take the width; empty ones fold into a single "Empty: …" line. */
export function splitBoardColumns(columns: readonly BoardColumn[]): {
  populated: BoardColumn[]
  emptyLabels: string[]
} {
  return {
    populated: columns.filter((column) => column.items.length > 0),
    emptyLabels: columns.filter((column) => column.items.length === 0).map((c) => c.label),
  }
}

// ── Strip footers ───────────────────────────────────────────────────────────

const NBSP = '\u00a0'

/** The reverts cell's footer: the reopen count and window (the term is defined in the info tooltip). */
export function revertsFooter(
  reverts: StripModel['reverts'],
  noData: (reason: string) => string,
): string {
  const parts = [
    reverts.reverts === null
      ? `reverts ${noData(reverts.revertsUnavailable ?? 'not reported')}`
      : '',
    reverts.reopens === null
      ? `reopens ${noData(reverts.reopensUnavailable ?? 'not reported')}`
      : `${reverts.reopens} reopened after fixed · last${NBSP}${reverts.windowDays}${NBSP}d`,
  ]
  return parts.filter((part) => part !== '').join(' · ')
}

export const REVERTS_INFO =
  'A revert is a merged fix that was undone. A reopen is an item that came back after it was marked fixed.'

/**
 * The fixes legend as a sum: `a fixed + b quiet + c closed = n items`. A count warden did not
 * report is `—` and the total is left off, so the line never claims a sum it cannot show.
 */
export function fixesLegend(fixes: StripModel['fixes']): string {
  const parts = [
    { n: fixes.fixed, label: 'fixed' },
    { n: fixes.quiet, label: 'quiet' },
    { n: fixes.closed, label: 'closed' },
  ]
  const text = parts.map((part) => `${part.n ?? '—'}${NBSP}${part.label}`).join(' + ')
  return parts.some((part) => part.n === null)
    ? text
    : `${text} = ${parts.reduce((sum, part) => sum + (part.n ?? 0), 0)}${NBSP}items`
}

/** The verdicts cell's fact line (the cell has nothing to compare the share against). */
export function verdictsFooter(verdicts: StripModel['verdicts']): string {
  return verdicts.numerator !== null && verdicts.denominator !== null
    ? `${verdicts.numerator} of ${verdicts.denominator} tracked items · all time`
    : 'all time'
}

/** The oldest poller's name and rank (`merge poller · oldest of 3`); an unnamed one states its stale mark. */
export function pollerFooter(poller: StripModel['poller']): string {
  if (poller.name === null) return `stale at ${poller.thresholdMin}\u00a0min`
  const name = poller.name.replaceAll('_', ' ')
  return poller.count > 1 ? `${name} · oldest of ${poller.count}` : name
}

// ── Board empty copy ────────────────────────────────────────────────────────

const COLUMN_MEANING: Record<BoardColumnKey, string> = {
  new: 'waiting to be triaged',
  triaged: 'triaged and waiting to start',
  working: 'being worked on',
  merging: 'with a PR waiting to merge',
  verifying: 'merged and being verified',
  other: 'in a state this page does not list',
}

/** An empty column, as a fact about what would be in it: `No item being worked on.` */
export function emptyColumnText(key: BoardColumnKey): string {
  return `No item ${COLUMN_MEANING[key]}.`
}

/**
 * The whole board empty. Items waiting on the owner leave the board for the cards above it, so an
 * empty board says where they are rather than "No open items" under a non-zero Needs-you count.
 */
export function emptyBoardText(waitingOnOwner: number): string {
  if (waitingOnOwner === 0) return 'No open items.'
  return waitingOnOwner === 1
    ? 'No other open items. The one open item is waiting on you, above.'
    : `No other open items. The ${waitingOnOwner} open items are waiting on you, above.`
}

/** A poller as the Today page names it: `watchdog poll · 4 min old`. */
export function pollerAgeText(poller: { name: string; ageMin: number }): string {
  return `${poller.name.replaceAll('_', ' ')} · ${Math.round(poller.ageMin)}\u00a0min old`
}

export type BoardView = {
  columns: BoardColumn[]
  /** Items on the board: the section count. */
  open: number
  /** What an empty board says; names the board items that left for the cards above it. */
  emptyText: string
}

/**
 * The board's columns with the figures that depend on them. `emptyText` counts only the board
 * items a card actually claimed (not every awaiting entry, some of which may be past the board's cap).
 */
export function deriveBoard(
  board: WardenBoard | undefined,
  claimed: ReadonlySet<number>,
): BoardView {
  const columns = deriveBoardColumns(board, claimed)
  const leftForCards = (board?.items ?? []).filter((item) => claimed.has(item.event_id)).length
  return { columns, open: openCount(columns), emptyText: emptyBoardText(leftForCards) }
}
