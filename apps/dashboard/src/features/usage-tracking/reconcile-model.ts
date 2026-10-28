/**
 * Section D, portal vs tracked: the words and shapes for one `iu-reconcile` response. The API owns
 * the verdict (`flagged`: off by more than max($1, 20 %) of the portal figure, the rule of
 * `make budget`) and the `partial` newest day; this file only shapes them for the strip.
 *
 * What a portal figure above the tracked one means depends on the key (`GapReading`, a registry
 * property). `pricing` (the personal key): we price the rows ourselves, so the gap is mostly a pricing
 * or unpriced-row difference, read as a signed delta. `unseen` (the team key): its costs are
 * producer-reported, so the gap is spend by producers we do not see, said in neutral words.
 */
import type { BandSpan } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import type { IuReconcile } from '../../lib/queries/usage'
import type { GapReading } from './accounts'
import { dayToDate } from './constants'
import { deltaDirection } from './budget-model'
import { fmtUsdWhole } from './model'

export const RECON_WINDOW_DAYS = 30
export const RECON_NO_PORTAL = 'no portal report for this key yet'

const MINUS = '−'

export type ReconDay = {
  date: Date
  portalUsd: number
  trackedUsd: number
  deltaUsd: number
  ratio: number | null
  flagged: boolean
  partial: boolean
}

export const reconDays = (days: IuReconcile['days']): ReconDay[] =>
  days.map((d) => ({ ...d, date: dayToDate(d.day) }))

/** `+$12`, `−$41`, or `$0` when the gap rounds to under a dollar. */
export function fmtSignedUsd(deltaUsd: number): string {
  const direction = deltaDirection(deltaUsd)
  if (direction === 'flat') return fmtUsdWhole(0)
  const amount = fmtUsdWhole(Math.abs(deltaUsd))
  return direction === 'up' ? `+${amount}` : `${MINUS}${amount}`
}

/** What the portal shows beyond the tracked rows of a key whose gap is `unseen`. */
export const UNSEEN = 'producers we do not see'

/**
 * The window's gap in words, from the whole-dollar figures the line prints. `pricing`: the signed
 * delta (`−$41`). `unseen`: portal above tracked is spend by producers we do not see, tracked above
 * portal a signed excess, equal reads as no gap.
 */
export function gapLine(reading: GapReading, portalUsd: number, trackedUsd: number): string {
  const delta = trackedUsd - portalUsd
  if (reading === 'pricing') return fmtSignedUsd(delta)
  if (delta < 0) return `${fmtUsdWhole(-delta)} from ${UNSEEN}`
  if (delta > 0) return `${fmtSignedUsd(delta)} tracked above portal`
  return 'no gap'
}

/** `0.42×` tracked per portal dollar; `—` on a day the portal reported nothing. */
export const fmtRatio = (ratio: number | null): string =>
  ratio === null ? '—' : `${ratio.toFixed(2)}×`

/**
 * The reading the strip prints for a day. `pricing`: `−$41 · 0.42×`. `unseen`: `$41 unseen · 0.42×`
 * on a day the portal is above tracked, `+$12 · 1.30×` the other way round.
 */
export function dayReading(reading: GapReading, d: Pick<ReconDay, 'deltaUsd' | 'ratio'>): string {
  const gap =
    reading === 'unseen' && deltaDirection(d.deltaUsd) === 'down'
      ? `${fmtUsdWhole(-d.deltaUsd)} unseen`
      : fmtSignedUsd(d.deltaUsd)
  return `${gap} · ${fmtRatio(d.ratio)}`
}

export const unpricedNote = (rows: number): string =>
  `${rows} IU ${rows === 1 ? 'row' : 'rows'} unpriced (no cost recorded)`

const COMMON_INFO =
  'The strip flags a UTC day when the two differ by more than the larger of $1 and 20 % of the portal figure. The newest portal day is still settling and is marked partial. This card always compares the last 30 days of the whole key: the Range and Workspace filters do not apply to it (the portal has no workspace).'

const INFO: Record<GapReading, string> = {
  pricing: `Portal is what IU's own billing report says the API cost; tracked is our estimate, priced from the usage-tracker rows billed to IU. ${COMMON_INFO} Tracking prices some models at far less than the portal does, and rows without a recorded cost count as zero.`,
  unseen: `Portal is what IU's own billing report says this key cost; tracked is the cost its producers reported to us. ${COMMON_INFO} A portal figure above ours is spend by producers we do not see: usage that never reached our tracker, for example before a producer was connected.`,
}

/** The strip's flagged state: an amber flag for a pricing gap, a neutral mark for unseen spend. */
const FLAG: Record<GapReading, { key: 'warn' | 'differ'; label: string; color: string }> = {
  pricing: { key: 'warn', label: 'Off by more', color: VX.warnSolid },
  unseen: { key: 'differ', label: 'Portal and tracked differ', color: VX.line },
}

const stripStatesOf = (reading: GapReading) =>
  [
    {
      key: 'ok',
      label: 'Within max($1, 20 %)',
      color: alpha(VX.muted, 0.2),
      formatValue: (d: ReconDay) => dayReading(reading, d),
    },
    { ...FLAG[reading], formatValue: (d: ReconDay) => dayReading(reading, d) },
    { key: 'partial', label: 'Partial day', color: VX.muted },
  ] as const

const bandOf =
  (reading: GapReading) =>
  (d: ReconDay): BandSpan => ({
    state: d.flagged ? FLAG[reading].key : 'ok',
    ...(d.partial ? { marker: { state: 'partial' } } : {}),
  })

/**
 * How each gap reading presents the card: its info text, the strip's states and band function, and
 * the sentence the strip's label carries. Built once, so the strip gets stable references.
 */
export const GAP_PRESENTATION: Record<
  GapReading,
  {
    info: string
    /** `flagged when off by more` / `marked when the two differ by more`, up to "than the larger of $1 and 20 %". */
    flagged: string
    states: ReturnType<typeof stripStatesOf>
    bandOf: (d: ReconDay) => BandSpan
  }
> = {
  pricing: {
    info: INFO.pricing,
    flagged: 'flagged when off by more',
    states: stripStatesOf('pricing'),
    bandOf: bandOf('pricing'),
  },
  unseen: {
    info: INFO.unseen,
    flagged: 'marked when the two differ by more',
    states: stripStatesOf('unseen'),
    bandOf: bandOf('unseen'),
  },
}
