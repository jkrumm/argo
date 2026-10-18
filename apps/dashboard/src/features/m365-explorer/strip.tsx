import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import { Skeleton, UnstyledButton } from '@mantine/core'
import { withUnit } from '../../lib/format'
import { channelsFooter, chatKindParts, labeledBasis, type Coverage } from './model'
import classes from './m365.module.css'

/** A split is not a verdict: neutral fills, never a status colour. */
const FILL_STRONG = alpha(VX.muted, 0.95)
const FILL_FAINT = alpha(VX.muted, 0.4)

type Chats = { oneOnOne: number; group: number; meeting: number; other: number }

function labeledCell(coverage: Coverage, list: string, onRetry: () => void): StatStripCell {
  const { labeled, total, loading, failed } = coverage
  const pending = loading > 0
  const atLeast = failed > 0 ? '≥' : ''
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
        segments={[
          { label: 'Labeled', value: Math.min(labeled, total), color: FILL_STRONG },
          { label: 'Unlabeled', value: Math.max(total - labeled, 0), color: FILL_FAINT },
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
 * The chat kinds as one split bar, shaded by rank (a split is not a verdict), keyed by the footer
 * words. A kind with no chats is left out; `other` takes any kind the API adds later.
 */
function chatsCell(chats: Chats): StatStripCell {
  const parts = chatKindParts(chats)
  return {
    key: 'chats',
    caption: 'Chats by kind',
    visual:
      parts.length === 0 ? undefined : (
        <Meter
          label="Chats by kind"
          max={parts.reduce((sum, p) => sum + p.value, 0)}
          size="row"
          segments={parts.map((p, i) => ({
            label: p.label,
            value: p.value,
            color: alpha(VX.muted, Math.max(0.95 - i * 0.25, 0.3)),
          }))}
        />
      ),
    footer:
      parts.length === 0 ? 'no chats' : parts.map((p) => withUnit(p.value, p.label)).join(' · '),
  }
}

/** Channels across the teams; the team count is the tab's, so the footer names the biggest team. */
function channelsCell(
  channels: number | null,
  largest: { name: string; channels: number } | null,
  failed: number,
): StatStripCell {
  return {
    key: 'channels',
    caption: 'Team channels',
    value: channels === null ? null : String(channels),
    ...(channels === null ? {} : { unit: channels === 1 ? 'channel' : 'channels' }),
    footer: channelsFooter({ channels, largest, failed }),
  }
}

export type StripProps = {
  coverage: Coverage
  /** What the labeled count ranges over, from `sourceListName`. */
  list: string
  chats: Chats
  /** Channels across the teams that loaded; null while any team is not loaded. */
  channels: number | null
  largestTeam: { name: string; channels: number } | null
  onRetry: () => void
}

export function ExplorerStrip({
  coverage,
  list,
  chats,
  channels,
  largestTeam,
  onRetry,
}: StripProps) {
  return (
    <StatGroup
      variant="strip"
      label="Coverage summary"
      cols={3}
      cells={[
        labeledCell(coverage, list, onRetry),
        chatsCell(chats),
        channelsCell(channels, largestTeam, coverage.failed),
      ]}
    />
  )
}
