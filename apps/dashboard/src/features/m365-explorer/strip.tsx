import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import { Box, Group, Skeleton, UnstyledButton } from '@mantine/core'
import type { Coverage } from './model'
import classes from './m365.module.css'

/** A split is not a verdict: stepped neutral fills, never a status colour. */
const FILL_STRONG = alpha(VX.muted, 0.95)
const FILL_MID = alpha(VX.muted, 0.65)
const FILL_FAINT = alpha(VX.muted, 0.4)

type Chats = { total: number; oneOnOne: number; group: number; meeting: number }

function labeledCell(coverage: Coverage, basis: string, onRetry: () => void): StatStripCell {
  const { labeled, total, loading, failed, outside } = coverage
  const pending = loading > 0
  const atLeast = failed > 0 ? '≥' : ''
  return {
    key: 'labeled',
    caption: 'Labeled',
    value: pending ? null : String(labeled),
    unit: pending ? 'of …' : `of ${atLeast}${total} sources`,
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
        {basis}
        {outside > 0 ? ` · ${outside} outside this set` : ''}
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

/** The Meter's `row` size drops part captions, so the footer names each part: swatch + word + count. */
function KindLegend({
  parts,
}: {
  parts: ReadonlyArray<{ label: string; value: number; color: string }>
}) {
  return (
    <Group gap="sm" wrap="wrap" component="span">
      {parts.map((part) => (
        <Group key={part.label} gap={4} wrap="nowrap" component="span">
          <Box component="span" w={8} h={8} bdrs="50%" bg={part.color} />
          {part.label} {part.value}
        </Group>
      ))}
    </Group>
  )
}

function chatsCell(chats: Chats): StatStripCell {
  const parts = [
    { label: '1:1', value: chats.oneOnOne, color: FILL_STRONG },
    { label: 'Group', value: chats.group, color: FILL_MID },
    { label: 'Meeting', value: chats.meeting, color: FILL_FAINT },
  ]
  return {
    key: 'chats',
    caption: 'Chats',
    value: String(chats.total),
    unit: chats.total === 1 ? 'chat' : 'chats',
    visual:
      chats.total === 0 ? undefined : (
        <Meter label="Chats by kind" max={chats.total} size="row" segments={parts} />
      ),
    footer: chats.total === 0 ? undefined : <KindLegend parts={parts} />,
  }
}

function teamsCell(teams: number, channels: number | null): StatStripCell {
  return {
    key: 'teams',
    caption: 'Teams',
    value: String(teams),
    unit: teams === 1 ? 'team' : 'teams',
    footer: channels === null ? '—' : `${channels} ${channels === 1 ? 'channel' : 'channels'}`,
  }
}

export type StripProps = {
  coverage: Coverage
  /** The chat list is the newest-N window of a longer list. */
  chatsCapped: boolean
  chats: Chats
  teams: number
  /** Channels across the teams that loaded; null while any team is not loaded. */
  channels: number | null
  onRetry: () => void
}

export function ExplorerStrip({
  coverage,
  chatsCapped,
  chats,
  teams,
  channels,
  onRetry,
}: StripProps) {
  const basis = chatsCapped ? `newest ${chats.total} chats + channels` : 'chats + channels'
  return (
    <StatGroup
      variant="strip"
      label="Coverage summary"
      cols={3}
      cells={[labeledCell(coverage, basis, onRetry), chatsCell(chats), teamsCell(teams, channels)]}
    />
  )
}
