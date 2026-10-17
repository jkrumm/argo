import { UnstyledButton } from '@mantine/core'
import { LABELED_FILTER, type ChipCounts } from './model'
import classes from './m365.module.css'

export type ChipScope = 'chats' | 'channels' | 'sources'

export type TagChipsProps = {
  /** `''` = all sources, `*` = every labeled source, otherwise a tag. */
  active: string
  counts: ChipCounts
  /** What the counts range over (`chats`, `channels`, `sources`), so "Labeled" names its scope. */
  scope: ChipScope
  onChange: (tag: string) => void
}

function Chip(props: {
  label: string
  count: number | null
  active: boolean
  onClick: () => void
}) {
  return (
    <UnstyledButton
      className={props.active ? `${classes.chip} ${classes.chipActive}` : classes.chip}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.label}
      <span className={classes.chipCount}>{props.count ?? '—'}</span>
    </UnstyledButton>
  )
}

/** Neutral filter chips with counts; the accent is spent only on the active one. */
export function TagChips({ active, counts, scope, onChange }: TagChipsProps) {
  return (
    <div className={classes.toolbar} role="group" aria-label="Filter by tag" data-shot="tag-chips">
      <Chip label="All" count={counts.all} active={active === ''} onClick={() => onChange('')} />
      {counts.labeled > 0 || active === LABELED_FILTER ? (
        <Chip
          label={`Labeled ${scope}`}
          count={counts.labeled}
          active={active === LABELED_FILTER}
          onClick={() => onChange(LABELED_FILTER)}
        />
      ) : null}
      {counts.tags.map(([tag, count]) => (
        <Chip
          key={tag}
          label={tag}
          count={count}
          active={active === tag}
          onClick={() => onChange(tag)}
        />
      ))}
    </div>
  )
}
