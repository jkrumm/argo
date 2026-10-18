import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import { Skeleton, UnstyledButton } from '@mantine/core'
import { labeledBasis, plural, type Coverage } from './model'
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
 * The chat kinds as aligned rows that sum to the Chats tab's total (`Other` takes any kind the API
 * adds later). `null` while the chat list loads: a dash per row, never 0.
 */
function chatsCell(chats: Chats | null): StatStripCell {
  const row = (key: string, label: string, value: number | undefined) => ({
    key,
    label,
    value: value === undefined ? null : String(value),
  })
  return {
    key: 'chats',
    caption: 'Chats by kind',
    rows: [
      row('oneOnOne', '1:1', chats?.oneOnOne),
      row('group', 'Group', chats?.group),
      row('meeting', 'Meeting', chats?.meeting),
      row('other', 'Other', chats?.other),
    ],
  }
}

/** The channels cell's footer: loading, failed and empty are different facts, each in its own words. */
function channelsFooter(
  channels: number | null,
  largest: { name: string; channels: number } | null,
  failed: number,
): string {
  if (failed > 0) return failed === 1 ? '1 team failed to load' : `${failed} teams failed to load`
  if (channels === null) return 'still loading'
  if (largest === null) return 'no channels'
  return `most in ${largest.name}, ${plural(largest.channels, 'channel')}`
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
    footer: channelsFooter(channels, largest, failed),
  }
}

export type StripProps = {
  coverage: Coverage
  /** What the labeled count ranges over, from `sourceListName`. */
  list: string
  chats: Chats | null
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
