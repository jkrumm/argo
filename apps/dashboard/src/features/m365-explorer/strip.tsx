import { Meter } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import { Skeleton, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import classes from './m365.module.css'

const EM_DASH = '—'
/** A split is not a verdict: stepped neutral fills, never a status colour. */
const FILL_STRONG = alpha(VX.muted, 0.9)
const FILL_MID = alpha(VX.muted, 0.6)
const FILL_FAINT = alpha(VX.muted, 0.3)

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
  labeled: number
  /** Chats + channels; null until every team's channel list has loaded. */
  total: number | null
  chats: { total: number; oneOnOne: number; group: number; meeting: number }
  teams: number
  /** Channels across all teams; null while loading. */
  channels: number | null
}

export function ExplorerStrip({ labeled, total, chats, teams, channels }: StripProps) {
  return (
    <section className={classes.strip} aria-label="Coverage summary">
      <Cell
        shot="labeled"
        caption="Labeled"
        value={String(labeled)}
        unit={
          total === null ? (
            'of …'
          ) : (
            <>
              of {total}
              <span className={classes.unitLong}> chats + channels</span>
            </>
          )
        }
        visual={
          total === null ? (
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
