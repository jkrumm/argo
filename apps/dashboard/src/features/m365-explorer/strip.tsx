import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import { Skeleton, UnstyledButton } from '@mantine/core'
import {
  channelsFooter,
  chatKindParts,
  chatsStat,
  labeledBasis,
  labeledSegmentCaption,
  emptyGap,
  NO_SOURCES,
  gapLeader,
  nothingToLabel,
  withStep,
  type Coverage,
  type GapLeader,
} from './model'
import classes from './m365.module.css'

/** A split is not a verdict: neutral fills, never a status colour. */
const FILL_STRONG_ALPHA = 0.95
const FILL_FAINT_ALPHA = 0.4
const FILL_STRONG = alpha(VX.muted, FILL_STRONG_ALPHA)
const FILL_FAINT = alpha(VX.muted, FILL_FAINT_ALPHA)
/** The kind bar's shades step down by rank from the strongest fill, never below the faint one. */
const KIND_ALPHA_STEP = 0.25

type Chats = { oneOnOne: number; group: number; meeting: number; other: number }

function labeledCell(
  coverage: Coverage,
  list: { chats: number; capped: boolean },
  onRetry: () => void,
  empty: boolean,
  leading: boolean,
): StatStripCell {
  const { labeled, total, loading, failed } = coverage
  const pending = loading > 0
  const atLeast = failed > 0 ? '≥' : ''
  // Only a settled, complete list can be called empty: a failed team or labels outside the list mean there is more than the cell can see (and Retry lives in the footer).
  if (empty) {
    return {
      key: 'labeled',
      caption: 'Labeled sources',
      state: { kind: 'empty', reason: leading ? withStep(NO_SOURCES) : NO_SOURCES },
    }
  }
  const labeledCount = Math.min(labeled, total)
  const unlabeled = Math.max(total - labeledCount, 0)
  return {
    key: 'labeled',
    caption: 'Labeled sources',
    value: pending ? null : String(labeled),
    unit: pending ? 'of …' : `of ${atLeast}${total}`,
    visual: pending ? (
      <Skeleton h={22} />
    ) : (
      <Meter
        label="Labeled sources of all chats and channels"
        max={Math.max(total, 1)}
        size="row"
        format={(v) => labeledSegmentCaption(v, labeledCount, unlabeled)}
        segments={[
          { label: 'Labeled', value: labeledCount, color: FILL_STRONG },
          { label: 'Unlabeled', value: unlabeled, color: FILL_FAINT },
        ]}
      />
    ),
    footer: (
      <>
        {labeledBasis(coverage, list)}
        {failed > 0 ? (
          <>
            {' · '}
            {failed === 1 ? '1 team failed' : `${failed} teams failed`}{' '}
            <UnstyledButton className={classes.retry} onClick={onRetry}>
              Retry
            </UnstyledButton>
          </>
        ) : null}
      </>
    ),
  }
}

/**
 * The chat kinds as one split bar, shaded by rank (a split is not a verdict); the hero is the leading
 * kind with its count and the bar's row captions name every kind, with the count of every kind but the lead. A kind with no chats is left out; `other` takes any kind the API adds later.
 */
function chatsCell(chats: Chats, noChats: boolean, leader: GapLeader): StatStripCell {
  if (noChats) {
    const short = emptyGap(leader, 'chats')
    const reason = leader === 'chats' ? withStep(short) : short
    return { key: 'chats', caption: 'Chats by kind', state: { kind: 'empty', reason } }
  }
  const parts = chatKindParts(chats)
  const stat = chatsStat(chats)
  // The hero already prints the leading kind's count, so its caption names the kind only; on a tie
  // no segment is the hero's twin and every caption keeps its count. `format` sees values, not
  // segments, so the lead is matched by its (unique) value.
  const [lead, runnerUp] = parts
  const uniqueLead = lead !== undefined && lead.value !== runnerUp?.value
  return {
    key: 'chats',
    caption: 'Chats by kind',
    ...stat.hero,
    visual:
      parts.length === 0 ? undefined : (
        <Meter
          label="Chats by kind"
          max={parts.reduce((sum, p) => sum + p.value, 0)}
          size="row"
          format={(v) => (uniqueLead && v === lead.value ? '' : String(v))}
          segments={parts.map((p, i) => ({
            label: p.label,
            value: p.value,
            color: alpha(
              VX.muted,
              Math.max(FILL_STRONG_ALPHA - i * KIND_ALPHA_STEP, FILL_FAINT_ALPHA),
            ),
          }))}
        />
      ),
  }
}

const footerOf = (footer: string | null) => (footer === null ? {} : { footer })

/** Channels across the teams; the team count is the tab's, so the footer names the biggest team. */
function channelsCell({
  channels,
  largest,
  failed,
  noTeams,
  leader,
}: {
  channels: number | null
  largest: { name: string; channels: number } | null
  failed: number
  noTeams: boolean
  leader: GapLeader
}): StatStripCell {
  // No teams came back: the channel count is unknown, not zero. When the Labeled cell leads, the
  // screen's sentence says `No chats or channels came back`; this cell repeats that clause verbatim.
  if (noTeams) {
    const short = emptyGap(leader, 'teams')
    const reason = leader === 'channels' ? withStep(short) : short
    return { key: 'channels', caption: 'Team channels', state: { kind: 'empty', reason } }
  }
  return {
    key: 'channels',
    caption: 'Team channels',
    value: channels === null ? null : String(channels),
    ...(channels === null ? {} : { unit: channels === 1 ? 'channel' : 'channels' }),
    ...footerOf(channelsFooter({ channels, largest, failed })),
  }
}

export type StripProps = {
  coverage: Coverage
  /** What the labeled count ranges over: the chat count and whether the list hit its request cap. */
  list: { chats: number; capped: boolean }
  chats: Chats
  /** Channels across the teams that loaded; null while any team is not loaded. */
  channels: number | null
  largestTeam: { name: string; channels: number } | null
  /** The chats list / the teams list came back empty (settled: both reads suspend, so never pending). */
  noChats: boolean
  noTeams: boolean
  onRetry: () => void
}

export function ExplorerStrip({
  coverage,
  list,
  chats,
  channels,
  largestTeam,
  noChats,
  noTeams,
  onRetry,
}: StripProps) {
  const nothingLabelable = nothingToLabel(coverage)
  const leader = gapLeader({ nothingToLabel: nothingLabelable, noChats, noTeams })
  return (
    <StatGroup
      variant="strip"
      label="Coverage summary"
      cols={3}
      cells={[
        labeledCell(coverage, list, onRetry, nothingLabelable, leader === 'labeled'),
        chatsCell(chats, noChats, leader),
        channelsCell({ channels, largest: largestTeam, failed: coverage.failed, noTeams, leader }),
      ]}
    />
  )
}
