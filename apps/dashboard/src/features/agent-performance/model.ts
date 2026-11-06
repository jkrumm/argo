// Agent performance — the pure derivations behind /agent-performance. Argo renders what the API
// returns (usage read model + the pushed `agw review stats` snapshot); this file only fills week
// gaps, folds the long tail, sums across the window and spells figures. Input types are structural
// so the Eden response types are assignable without a cast.

import { NBSP, formatAgo } from '../../lib/format'
import type { UsageKpis } from '../../lib/queries/agent-performance'

export const EM_DASH = '—'

type Count = number | null | undefined

// ── Windows ──────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` Monday keys (UTC), oldest first, ending with the week of `now`. */
export function weekKeys(weeks: number, now: number): string[] {
  const d = new Date(now)
  const sinceMonday = (d.getUTCDay() + 6) % 7
  const thisMonday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday)
  return Array.from({ length: weeks }, (_, i) =>
    new Date(thisMonday - (weeks - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
  )
}

const weekDate = (key: string): Date => new Date(`${key}T00:00:00Z`)

// ── Review stats ─────────────────────────────────────────────────────────────

export const TIERS = ['light', 'standard', 'deep'] as const
export type Tier = (typeof TIERS)[number]

type DispositionCounts = {
  fixed?: Count
  wrong?: Count
  intentional?: Count
  irrelevant?: Count
}

export type ReviewGroupInput = {
  key: string
  jobs?: Count | undefined
  round1?: { jobs?: Count; clean?: Count } | null | undefined
  precision?: { important?: Count; nit?: Count } | null | undefined
  dispositions?:
    | {
        important?: DispositionCounts | null | undefined
        nit?: DispositionCounts | null | undefined
      }
    | null
    | undefined
}

export type ReviewWeekInput = { weekStart: string; groups: readonly ReviewGroupInput[] }

export type Precision = {
  /** Acted-on share, 0..1. */
  rate: number
  /** Findings with a verdict: every disposition except `open`. */
  judged: number
}

export type ReviewSummary = {
  jobs: number
  firstRounds: number
  clean: number
  /** `clean / firstRounds`; null with no first rounds. */
  cleanRate: number | null
  important: Precision | null
  nit: Precision | null
}

const num = (v: Count): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** agw's precision denominator: fixed + wrong + irrelevant (`intentional` and `open` are not judged). */
const judgedOf = (d: DispositionCounts | null | undefined): number =>
  d ? num(d.fixed) + num(d.wrong) + num(d.irrelevant) : 0

/** Window precision: each group's rate weighted by its judged findings; groups without either are skipped. */
function pooledPrecision(
  groups: readonly ReviewGroupInput[],
  severity: 'important' | 'nit',
): Precision | null {
  let acted = 0
  let judged = 0
  for (const g of groups) {
    const rate = g.precision?.[severity]
    const n = judgedOf(g.dispositions?.[severity])
    if (typeof rate !== 'number' || !Number.isFinite(rate) || n <= 0) continue
    acted += rate * n
    judged += n
  }
  return judged === 0 ? null : { rate: acted / judged, judged }
}

export function summarizeReview(groups: readonly ReviewGroupInput[]): ReviewSummary {
  const firstRounds = groups.reduce((s, g) => s + num(g.round1?.jobs), 0)
  const clean = groups.reduce((s, g) => s + num(g.round1?.clean), 0)
  return {
    jobs: groups.reduce((s, g) => s + num(g.jobs), 0),
    firstRounds,
    clean,
    cleanRate: firstRounds > 0 ? clean / firstRounds : null,
    important: pooledPrecision(groups, 'important'),
    nit: pooledPrecision(groups, 'nit'),
  }
}

const inWindow = (weeks: readonly ReviewWeekInput[], keys: readonly string[]) =>
  weeks.filter((w) => keys.includes(w.weekStart))

export type ReviewWeekRow = { weekStart: string; at: Date; jobs: Record<Tier, number> }

/** One row per window week (gaps are zero jobs), jobs per tier. */
export function reviewWeekRows(
  weeks: readonly ReviewWeekInput[],
  keys: readonly string[],
): ReviewWeekRow[] {
  return keys.map((weekStart) => {
    const groups = weeks.find((w) => w.weekStart === weekStart)?.groups ?? []
    const jobs = { light: 0, standard: 0, deep: 0 }
    for (const tier of TIERS) jobs[tier] = num(groups.find((g) => g.key === tier)?.jobs)
    return { weekStart, at: weekDate(weekStart), jobs }
  })
}

export type TierSummary = ReviewSummary & { tier: Tier }

/** Per-tier totals over the window, only tiers that ran a job. */
export function tierSummaries(
  weeks: readonly ReviewWeekInput[],
  keys: readonly string[],
): TierSummary[] {
  const scoped = inWindow(weeks, keys)
  return TIERS.map((tier) => ({
    tier,
    ...summarizeReview(scoped.flatMap((w) => w.groups.filter((g) => g.key === tier))),
  })).filter((s) => s.jobs > 0)
}

/** Window totals across every tier: jobs and the first-round clean rate. */
export function reviewTotals(
  weeks: readonly ReviewWeekInput[],
  keys: readonly string[],
): Pick<ReviewSummary, 'jobs' | 'cleanRate'> {
  const { jobs, cleanRate } = summarizeReview(inWindow(weeks, keys).flatMap((w) => w.groups))
  return { jobs, cleanRate }
}

export type PromptRow = ReviewSummary & { key: string }

export const promptRows = (byPrompt: readonly ReviewGroupInput[]): PromptRow[] =>
  byPrompt.map((g) => ({ key: g.key, ...summarizeReview([g]) })).toSorted((a, b) => b.jobs - a.jobs)

/** A fingerprint is long; the table shows its head, the full key rides the title. */
export const shortKey = (key: string, max = 10): string =>
  key.length <= max ? key : `${key.slice(0, max)}…`

export const pct = (rate: number | null): string =>
  rate === null || !Number.isFinite(rate) ? EM_DASH : `${Math.round(rate * 100)}%`

export const cleanBasis = (s: Pick<ReviewSummary, 'clean' | 'firstRounds'>): string =>
  s.firstRounds === 0 ? '' : `${s.clean} of ${s.firstRounds} first rounds`

export const precisionBasis = (p: Precision | null): string =>
  p === null ? '' : `of ${p.judged} judged`

// ── Usage ────────────────────────────────────────────────────────────────────

export const fmtUsd = (usd: number): string => {
  if (!Number.isFinite(usd)) return EM_DASH
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export type SubagentInput = {
  kind: 'subagent' | 'worker'
  name: string
  runs: number
  requests: number
  costUsd: number
  avgCostUsd: number
}

export function splitSubagents(rows: readonly SubagentInput[]): {
  subagents: SubagentInput[]
  workers: SubagentInput[]
} {
  const ranked = rows.toSorted((a, b) => b.costUsd - a.costUsd || a.name.localeCompare(b.name))
  return {
    subagents: ranked.filter((r) => r.kind === 'subagent'),
    workers: ranked.filter((r) => r.kind === 'worker'),
  }
}

export const runsLabel = (n: number): string => `${n}${NBSP}${n === 1 ? 'run' : 'runs'}`

export const LANES = ['lead', 'implementer', 'reviewer', 'verifier', 'Explore', 'other'] as const
export type Lane = (typeof LANES)[number]

/** A raw usage lane + name as one of the Issue lanes; `review` wins over `verif` (review-verifier). */
export function laneOf(lane: string, name: string): Lane {
  if (lane === 'lead') return 'lead'
  const n = name.toLowerCase()
  if (n === 'explore') return 'Explore'
  if (n.includes('implement')) return 'implementer'
  if (n.includes('review')) return 'reviewer'
  if (n.includes('verif')) return 'verifier'
  return 'other'
}

export type IssueInput = {
  issueId: string
  repo: string | null
  firstTs: string
  lastTs: string
  runs: number
  requests: number
  costUsd: number
  lanes: readonly { lane: string; name: string; runs: number; requests: number; costUsd: number }[]
}

export type LaneTotal = { lane: Lane; runs: number; requests: number; costUsd: number }

export type IssueRow = {
  issueId: string
  title: string
  span: string
  runs: number
  requests: number
  costUsd: number
  /** Lanes with any activity, in `LANES` order. */
  lanes: LaneTotal[]
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function spanLabel(firstTs: string, lastTs: string): string {
  const first = Date.parse(firstTs)
  const last = Date.parse(lastTs)
  if (!Number.isFinite(first) || !Number.isFinite(last)) return EM_DASH
  const a = dayFmt.format(first)
  const b = dayFmt.format(last)
  return a === b ? a : `${a}${NBSP}–${NBSP}${b}`
}

/** One row per Issue in the API's order (newest first); lanes folded to the six Issue lanes. */
export function issueRows(issues: readonly IssueInput[]): IssueRow[] {
  return issues.map((issue) => {
    const totals = new Map<Lane, LaneTotal>()
    for (const l of issue.lanes) {
      const lane = laneOf(l.lane, l.name)
      const t = totals.get(lane) ?? { lane, runs: 0, requests: 0, costUsd: 0 }
      t.runs += l.runs
      t.requests += l.requests
      t.costUsd += l.costUsd
      totals.set(lane, t)
    }
    return {
      issueId: issue.issueId,
      title: issue.repo ? `#${issue.issueId} ${issue.repo}` : `#${issue.issueId}`,
      span: spanLabel(issue.firstTs, issue.lastTs),
      runs: issue.runs,
      requests: issue.requests,
      costUsd: issue.costUsd,
      lanes: LANES.flatMap((lane) => totals.get(lane) ?? []),
    }
  })
}

export type WeekRunsInput = {
  weekStart: string
  kind: 'subagent' | 'worker'
  name: string
  runs: number
}

export type RunsSeries = { key: string; label: string; other: boolean }
export type RunsWeekRow = { weekStart: string; at: Date; runs: Record<string, number> }

const OTHER_KEY = 'other'

/** Runs per window week for the `top` types by total runs; the rest fold into one `(other)`. */
export function runsByWeek(
  rows: readonly WeekRunsInput[],
  keys: readonly string[],
  top = 5,
): { series: RunsSeries[]; weeks: RunsWeekRow[] } {
  const inKeys = rows.filter((r) => keys.includes(r.weekStart))
  const typeKey = (r: WeekRunsInput) => `${r.kind}:${r.name}`
  const totals = new Map<string, { label: string; runs: number }>()
  for (const r of inKeys) {
    const t = totals.get(typeKey(r)) ?? {
      label: r.kind === 'worker' ? `${r.name} (worker)` : r.name,
      runs: 0,
    }
    t.runs += r.runs
    totals.set(typeKey(r), t)
  }
  const ranked = [...totals.entries()].toSorted(
    (a, b) => b[1].runs - a[1].runs || a[1].label.localeCompare(b[1].label),
  )
  const kept = ranked.slice(0, top)
  const keptKeys = new Set(kept.map(([key]) => key))
  const series: RunsSeries[] = kept.map(([key, t]) => ({ key, label: t.label, other: false }))
  if (ranked.length > top) series.push({ key: OTHER_KEY, label: '(other)', other: true })

  const weeks = keys.map((weekStart) => {
    const runs: Record<string, number> = {}
    for (const r of inKeys) {
      if (r.weekStart !== weekStart) continue
      const key = keptKeys.has(typeKey(r)) ? typeKey(r) : OTHER_KEY
      runs[key] = (runs[key] ?? 0) + r.runs
    }
    return { weekStart, at: weekDate(weekStart), runs }
  })
  return { series, weeks }
}

// ── Summary ──────────────────────────────────────────────────────────────────

export type SummaryInput = {
  weeks: number
  subagents: readonly SubagentInput[]
  /** Window review totals; null when agw has not pushed review stats, undefined when not known (loading, failed). */
  review?: Pick<ReviewSummary, 'jobs' | 'cleanRate'> | null | undefined
}

export function summarySentence({ weeks, subagents, review }: SummaryInput): string {
  const sum = (kind: SubagentInput['kind'], field: 'runs' | 'costUsd') =>
    subagents.filter((s) => s.kind === kind).reduce((n, s) => n + s[field], 0)
  const cost = sum('subagent', 'costUsd') + sum('worker', 'costUsd')
  const head = `Last ${weeks} weeks: ${sum('subagent', 'runs')} subagent runs and ${sum('worker', 'runs')} factory worker runs, ${fmtUsd(cost)} at list value.`
  if (review === undefined) return head
  if (review === null) return `${head} agw has not pushed review stats yet.`
  if (review.jobs === 0) return `${head} No review jobs in the window.`
  const clean =
    review.cleanRate === null ? '' : `, ${pct(review.cleanRate)} clean in the first round`
  return `${head} ${review.jobs} review jobs${clean}.`
}

export const SUBAGENT_SOURCE =
  'usage.records_unique, lane=subagent by lane_detail.subagent_type / lane=worker by role · runs = distinct sessions'

export type ReviewRecordInput = {
  receivedAt: string
  snapshot: {
    weeks: readonly ReviewWeekInput[]
    byPrompt?: readonly ReviewGroupInput[] | undefined
  }
}

/**
 * The review totals the summary sentence quotes. null = agw has not pushed (the `empty` shot or a
 * successful query without a record); undefined = not known (loading or failed), so the sentence
 * says nothing.
 */
export function reviewForSummary({
  record,
  keys,
  emptyShot,
  succeeded,
}: {
  record: ReviewRecordInput | null
  keys: readonly string[]
  emptyShot: boolean
  succeeded: boolean
}): Pick<ReviewSummary, 'jobs' | 'cleanRate'> | null | undefined {
  if (record !== null) return reviewTotals(record.snapshot.weeks, keys)
  return emptyShot || succeeded ? null : undefined
}

/** The record to draw; the `empty` shot forces the not-pushed state. */
export function pushedRecord<R extends ReviewRecordInput>(
  data: { latest: R | null } | undefined,
  emptyShot: boolean,
): R | null {
  return emptyShot ? null : (data?.latest ?? null)
}

export type ReviewBody = 'unpushed' | 'empty' | 'data'

/** What the review section draws: the not-pushed state, an empty window, or the chart and table. */
export function reviewBody(pushed: boolean, total: number): ReviewBody {
  if (!pushed) return 'unpushed'
  return total === 0 ? 'empty' : 'data'
}

export const reviewJobTotal = (rows: readonly ReviewWeekRow[]): number =>
  rows.reduce((n, r) => n + r.jobs.light + r.jobs.standard + r.jobs.deep, 0)

const REVIEW_SOURCE = 'agw review stats --bucket week --by tier'

/** The review chart's source line: when agw last pushed, or that it has not. */
export function reviewSourceText(receivedAt: string | null, now: number): string {
  if (receivedAt === null) return `${REVIEW_SOURCE}, not pushed yet`
  return `${REVIEW_SOURCE}, pushed ${formatAgo(now - Date.parse(receivedAt))}`
}

/** The usage payload as the sections take it; while it is loading every part is empty. */
export function usageParts(
  usage: UsageKpis | undefined,
): Pick<UsageKpis, 'issues' | 'subagents' | 'byWeek' | 'costBasis'> {
  return {
    issues: usage?.issues ?? [],
    subagents: usage?.subagents ?? [],
    byWeek: usage?.byWeek ?? [],
    costBasis: usage?.costBasis ?? '',
  }
}

/** Everything the review section draws, derived from the pushed record (null = not pushed). */
export function reviewView(record: ReviewRecordInput | null, keys: readonly string[], now: number) {
  const weeks = record?.snapshot.weeks ?? []
  const rows = reviewWeekRows(weeks, keys)
  return {
    rows,
    body: reviewBody(record !== null, reviewJobTotal(rows)),
    tiers: tierSummaries(weeks, keys),
    prompts: promptRows(record?.snapshot.byPrompt ?? []),
    source: reviewSourceText(record?.receivedAt ?? null, now),
  }
}
