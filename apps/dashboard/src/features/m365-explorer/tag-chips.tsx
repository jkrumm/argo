import { UnstyledButton } from '@mantine/core'
import { LABELED_FILTER } from './model'
import classes from './m365.module.css'

export type TagChipsProps = {
  /** `''` = all sources, `*` = every labeled source, otherwise a tag. */
  active: string
  total: number
  labeled: number
  tagCounts: ReadonlyArray<[string, number]>
  onChange: (tag: string) => void
}

function Chip(props: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <UnstyledButton
      className={props.active ? `${classes.chip} ${classes.chipActive}` : classes.chip}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.label}
      <span className={classes.chipCount}>{props.count}</span>
    </UnstyledButton>
  )
}

/** Neutral filter chips with counts; the accent is spent only on the active one. */
export function TagChips({ active, total, labeled, tagCounts, onChange }: TagChipsProps) {
  return (
    <div className={classes.toolbar} role="group" aria-label="Filter by tag" data-shot="tag-chips">
      <Chip label="All" count={total} active={active === ''} onClick={() => onChange('')} />
      {labeled > 0 ? (
        <Chip
          label="Labeled"
          count={labeled}
          active={active === LABELED_FILTER}
          onClick={() => onChange(LABELED_FILTER)}
        />
      ) : null}
      {tagCounts.map(([tag, count]) => (
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
