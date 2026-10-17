import { Meter } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import { Skeleton, Text, UnstyledButton } from '@mantine/core'
import type { Coverage } from './model'
import type { ReactNode } from 'react'
import classes from './m365.module.css'

const EM_DASH = '—'
/** A split is not a verdict: stepped neutral fills, never a status colour. */
const FILL_STRONG = alpha(VX.muted, 0.95)
const FILL_MID = alpha(VX.muted, 0.65)
const FILL_FAINT = alpha(VX.muted, 0.4)

type CellProps = {
  caption: string
  value: string
  unit?: ReactNode
  visual?: ReactNode
  footer?: ReactNode
  shot: string
}

function Cell({ caption, value, unit, visual, footer, shot }: CellProps) {
  return (
    <div className={classes.cell} data-shot={`strip-${shot}`}>
      <Text className={classes.caption}>{caption}</Text>
      <div className={classes.reading}>
        <Text component="span" className={classes.value}>
          {value}
        </Text>
        {unit ? <span className={classes.unit}>{unit}</span> : null}
      </div>
      {visual ? <div className={classes.visual}>{visual}</div> : null}
      {footer ? <div className={classes.footer}>{footer}</div> : null}
    </div>
  )
}

export type StripProps = {
  coverage: Coverage
  /** The chat list is the newest-N window of a longer list. */
  chatsCapped: boolean
  chats: { total: number; oneOnOne: number; group: number; meeting: number }
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
  const { labeled, total, loading, failed, outside } = coverage
  const pending = loading > 0
  const atLeast = failed > 0 ? '≥' : ''
  const basis = chatsCapped ? `newest ${chats.total} chats + channels` : 'chats + channels'
  return (
    <section className={classes.strip} aria-label="Coverage summary">
      <Cell
        shot="labeled"
        caption="Labeled"
        value={pending ? EM_DASH : String(labeled)}
        unit={pending ? 'of …' : `of ${atLeast}${total} sources`}
        visual={
          pending ? (
            <Skeleton h={22} />
          ) : (
            <Meter
              label="Labeled sources of all chats and channels"
              max={Math.max(total, 1)}
              startCaption={null}
              endCaption={null}
              segments={[
                { label: 'Labeled', value: Math.min(labeled, total), color: FILL_STRONG },
                { label: 'Unlabeled', value: Math.max(total - labeled, 0), color: FILL_FAINT },
              ]}
            />
          )
        }
        footer={
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
        }
      />
      <Cell
        shot="chats"
        caption="Chats"
        value={String(chats.total)}
        unit={chats.total === 1 ? 'chat' : 'chats'}
        visual={
          chats.total === 0 ? undefined : (
            <Meter
              label="Chats by kind"
              max={chats.total}
              startCaption={null}
              endCaption={null}
              segments={[
                { label: '1:1', value: chats.oneOnOne, color: FILL_STRONG },
                { label: 'Group', value: chats.group, color: FILL_MID },
                { label: 'Meeting', value: chats.meeting, color: FILL_FAINT },
              ]}
            />
          )
        }
      />
      <Cell
        shot="teams"
        caption="Teams"
        value={String(teams)}
        unit={teams === 1 ? 'team' : 'teams'}
        footer={
          channels === null ? EM_DASH : `${channels} ${channels === 1 ? 'channel' : 'channels'}`
        }
      />
    </section>
  )
}
