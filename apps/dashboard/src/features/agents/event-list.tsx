import { Button, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { useState } from 'react'
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
}

/**
 * Day-grouped events: group heading with its row count, rows of actor · sentence · chip · mono
 * time pinned right. Collapses to `limit` rows. Prototype of the SPEC §4 `EventList`.
 */
export function EventList({ label, groups, limit = Number.POSITIVE_INFINITY }: EventListProps) {
  const [open, setOpen] = useState(false)
  const total = groups.reduce((sum, g) => sum + g.rows.length, 0)
  const cap = open ? total : limit
  // Rows each group may show: the budget left after the groups above it.
  const budgets = groups.map((_, i) =>
    Math.max(0, cap - groups.slice(0, i).reduce((sum, g) => sum + g.rows.length, 0)),
  )

  return (
    <div className={classes.root} role="list" aria-label={label}>
      {groups.map((group, i) => {
        const rows = group.rows.slice(0, budgets[i])
        if (rows.length === 0) return null
        return (
          <div key={group.label} role="listitem">
            <Text className={classes.heading}>
              {group.label}
              <span className={classes.count}>{group.rows.length}</span>
            </Text>
            {rows.map((row) => (
              <div key={row.key} className={classes.row}>
                <Text className={classes.actor} size="sm" fw={600} truncate>
                  {row.actor}
                </Text>
                <Text className={classes.title} size="sm" lineClamp={2}>
                  {row.title}
                </Text>
                {row.chip ? <span className={classes.chip}>{row.chip}</span> : null}
                <Text className={classes.time}>{row.time}</Text>
              </div>
            ))}
          </div>
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
