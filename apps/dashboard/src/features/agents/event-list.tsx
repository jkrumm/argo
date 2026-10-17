import { Box, Button, Text, UnstyledButton } from '@mantine/core'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import classes from './event-list.module.css'

export type EventRow = {
  key: string
  /** Who or what the event is about, left. */
  actor: string
  /** The sentence. */
  title: string
  /** Quiet trailing chip, e.g. a linked page. */
  chip?: ReactNode
  /** Mono time, pinned right. */
  time: string
}

export type EventGroup = { label: string; rows: readonly EventRow[] }

export type EventListProps = {
  label: string
  groups: readonly EventGroup[]
  /** Rows shown before `Show n more`. Default: all. */
  limit?: number
  /** Lines a collapsed sentence may take when the list is narrow. Default 1. */
  narrowLines?: 1 | 2
}

/**
 * Day-grouped events: group heading with its row count, rows of actor · sentence · chip · mono
 * time pinned right. Collapses to `limit` rows. Prototype of the SPEC §4 `EventList`.
 */
export function EventList({
  label,
  groups,
  limit = Number.POSITIVE_INFINITY,
  narrowLines = 1,
}: EventListProps) {
  const [open, setOpen] = useState(false)
  const total = groups.reduce((sum, g) => sum + g.rows.length, 0)
  const cap = open ? total : limit
  // Rows each group may show: the budget left after the groups above it.
  const budgets = groups.map((_, i) =>
    Math.max(0, cap - groups.slice(0, i).reduce((sum, g) => sum + g.rows.length, 0)),
  )

  return (
    <div className={classes.root} aria-label={label} data-narrow-lines={narrowLines}>
      {groups.map((group, i) => {
        const rows = group.rows.slice(0, budgets[i])
        if (rows.length === 0) return null
        return (
          <section key={group.label} aria-label={group.label} className={classes.group}>
            <Text className={classes.heading}>
              {group.label}
              <span className={classes.count}>{group.rows.length}</span>
            </Text>
            <div role="list">
              {rows.map((row) => (
                <Row key={row.key} row={row} />
              ))}
            </div>
          </section>
        )
      })}
      {total > cap ? (
        <Button variant="subtle" color="gray" size="compact-sm" onClick={() => setOpen(true)}>
          Show {total - cap} more
        </Button>
      ) : null}
    </div>
  )
}

/** The sentence is clamped (one line when narrow); pressing it reveals the whole sentence. */
function Row({ row }: { row: EventRow }) {
  const [expanded, setExpanded] = useState(false)
  const titleId = useId()
  return (
    <div role="listitem" className={classes.row} data-expanded={expanded || undefined}>
      <Text className={classes.actor} size="sm" fw={600} truncate>
        {row.actor}
      </Text>
      <UnstyledButton
        className={classes.titleButton}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={titleId}
      >
        <Text
          component="span"
          id={titleId}
          className={classes.title}
          data-expanded={expanded || undefined}
          size="sm"
        >
          {row.title}
        </Text>
      </UnstyledButton>
      {row.chip ? <Box className={classes.chip}>{row.chip}</Box> : null}
      <Text className={classes.time}>{row.time}</Text>
    </div>
  )
}
