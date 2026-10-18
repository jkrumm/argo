import { ActionIcon, UnstyledButton } from '@mantine/core'
import {
  IconChevronDown,
  IconChevronRight,
  IconHash,
  IconStarFilled,
  IconTrash,
  IconUser,
  IconUsers,
  IconUsersGroup,
  IconVideo,
} from '@tabler/icons-react'
import type { ReactNode } from 'react'
import type { ChatType } from './model'
import classes from './m365.module.css'

export type Glyph = ChatType | 'channel' | 'team'

const GLYPHS: Record<Glyph, typeof IconUser> = {
  oneOnOne: IconUser,
  group: IconUsers,
  meeting: IconVideo,
  unknownFutureValue: IconUsers,
  channel: IconHash,
  team: IconUsersGroup,
}

export type SourceRowProps = {
  glyph: Glyph
  name: string
  meta?: string | undefined
  time?: string
  selected?: boolean | undefined
  /** A labeled source shows a star at rest; the tag name is the accessible text. */
  starLabel?: string | undefined
  /** Disclosure state for a team row. */
  expanded?: boolean | undefined
  child?: boolean
  onSelect: () => void
  /** Hover/focus-only remove — the one control a labeled-source row may carry. */
  onRemove?: () => void
  removing?: boolean | undefined
  shot?: string
}

export function SourceRow(props: SourceRowProps): ReactNode {
  const Glyph = GLYPHS[props.glyph]
  const Disclosure = props.expanded ? IconChevronDown : IconChevronRight
  const rowClass = [
    classes.row,
    props.selected ? classes.rowSelected : '',
    props.child ? classes.rowChild : '',
  ]
    .filter(Boolean)
    .join(' ')
  const button = (
    <UnstyledButton
      className={rowClass}
      onClick={props.onSelect}
      aria-pressed={props.selected}
      aria-expanded={props.expanded}
      data-shot={props.shot}
    >
      <span className={classes.glyph} aria-hidden>
        <Glyph size={16} />
      </span>
      <span className={classes.rowMain}>
        <span className={classes.rowName} title={props.name}>
          {props.name}
        </span>
        {props.meta ? (
          <span className={classes.rowMeta} title={props.meta}>
            {props.meta}
          </span>
        ) : null}
      </span>
      {props.starLabel ? (
        <span className={classes.star} role="img" aria-label={`Labeled ${props.starLabel}`}>
          <IconStarFilled size={12} />
        </span>
      ) : null}
      {props.expanded === undefined ? null : (
        <span className={classes.glyph} aria-hidden>
          <Disclosure size={14} />
        </span>
      )}
      {props.time ? <span className={classes.rowTime}>{props.time}</span> : null}
    </UnstyledButton>
  )
  if (!props.onRemove) return button
  return (
    <div className={classes.rowShell}>
      {button}
      <span className={classes.removeWrap}>
        <ActionIcon
          size="sm"
          variant="subtle"
          color="gray"
          aria-label={`Remove label from ${props.name}`}
          onClick={props.onRemove}
          loading={props.removing ?? false}
        >
          <IconTrash size={14} />
        </ActionIcon>
      </span>
    </div>
  )
}
