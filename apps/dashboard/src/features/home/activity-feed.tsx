import { useState } from 'react'
import { Badge, Button, Card, Text } from '@mantine/core'
import { Section, useSizeClass } from 'basalt-ui'
import { NBSP } from '../../lib/format'
import { clockTime } from '../agents/model'
import { feedEmptyLine, type ActivityEvent, type ActivityGroup } from './model'
import classes from './home.module.css'

/** Rows shown at desktop width; the rest is behind `Show n more`. */
const ROW_LIMIT = 12
const ROW_LIMIT_NARROW = 6

type Props = {
  groups: readonly ActivityGroup[]
  total: number
  /** Loaded feeds older than 30 min, named; empty means every contributing feed is fresh (`Live`). */
  stale: readonly string[]
  /** At least one feed loaded; with none there is nothing live to show. */
  loaded: boolean
  /** Sources whose read failed / is still pending: with no feed loaded the empty line says which. */
  failed: readonly string[]
  pending: readonly string[]
  now: number
}

type RowPart = { kind: 'lead' | 'outcome' | 'chip'; text: string }

/** A row's parts in reading order: the one list the row renders and its full-text label joins. */
const rowParts = (e: ActivityEvent): RowPart[] => [
  { kind: 'lead', text: `${e.actor} ${e.title}` },
  ...(e.outcome ? [{ kind: 'outcome' as const, text: e.outcome }] : []),
  ...(e.chip ? [{ kind: 'chip' as const, text: e.chip }] : []),
]

/**
 * Day-grouped feed of what the control plane, the narrator and the calendar did, newest first.
 * Prototype of `EventList density="feed" live` (docs/design/UPSTREAM.md): the Agents `EventList`
 * has a fixed 10 rem actor column, too wide for a 40 % column.
 */
export function ActivityFeed({ groups, total, stale, loaded, failed, pending, now }: Props) {
  const [open, setOpen] = useState(false)
  const narrow = useSizeClass() === 'compact'
  const cap = open ? total : Math.min(narrow ? ROW_LIMIT_NARROW : ROW_LIMIT, total)
  const budgets = groups.map((_, i) =>
    Math.max(0, cap - groups.slice(0, i).reduce((sum, g) => sum + g.events.length, 0)),
  )
  const shown = Math.min(total, cap)
  return (
    <Card>
      <Section title="Activity">
        <div className={classes.feed} data-shot="activity" data-shot-states="empty">
          {loaded || total > 0 ? (
            <span className={classes.live}>
              {loaded ? (
                <span
                  className={stale.length === 0 ? classes.pulse : classes.pulseOff}
                  aria-hidden
                />
              ) : null}
              {!loaded
                ? 'No live feed'
                : stale.length === 0
                  ? 'Live'
                  : `Stale: ${stale.join(', ')}`}
              {total > 0
                ? ` · ${total} ${total === 1 ? 'update' : 'updates'} since yesterday`
                : null}
            </span>
          ) : null}
          {total > 0 ? (
            <Text size="sm" c="dimmed">
              A burst of steps on one item counts as one update.
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              {feedEmptyLine({ loaded, failed, pending, now })}
            </Text>
          )}
          {groups.map((group, i) => {
            const events = group.events.slice(0, budgets[i])
            if (events.length === 0) return null
            return (
              <section key={group.label} aria-label={group.label} className={classes.feedGroup}>
                <Text className={classes.feedHeading}>{group.label}</Text>
                <div role="list">
                  {events.map((e) => (
                    <FeedRow key={e.key} event={e} />
                  ))}
                </div>
              </section>
            )
          })}
          {total > shown ? (
            <Button
              variant="light"
              color="gray"
              size="compact-sm"
              fz="sm"
              onClick={() => setOpen(true)}
            >
              Show {total - shown} more
            </Button>
          ) : null}
        </div>
      </Section>
    </Card>
  )
}

function FeedRow({ event: e }: { event: ActivityEvent }) {
  const parts = rowParts(e)
  const time = clockTime(new Date(e.ms).toISOString())
  const text = parts.map((p) => p.text).join(' · ')
  const meta = parts.filter((p) => p.kind !== 'lead')
  return (
    <div role="listitem" className={classes.feedRow} title={text} aria-label={`${text} · ${time}`}>
      <div className={classes.feedBody}>
        <Text component="span" size="sm" className={classes.feedLead}>
          <span className={classes.feedActor}>{e.actor}</span> {e.title}
        </Text>
        {meta.length > 0 ? (
          <span className={classes.feedMeta}>
            {meta.map((p, i) => (
              <MetaPart key={p.kind} part={p} lead={i > 0} />
            ))}
          </span>
        ) : null}
      </div>
      <span className={classes.feedTime}>{time}</span>
    </div>
  )
}

/** One part of line 2: the outcome wraps whole, only the chip clips inside itself. */
function MetaPart({ part, lead }: { part: RowPart; lead: boolean }) {
  // The pill separates itself: no `·` before the chip, so a wrap never opens a line with one.
  if (part.kind === 'chip')
    return (
      <span className={classes.feedPart}>
        <Badge
          variant="light"
          color="gray"
          size="sm"
          fz="sm"
          tt="none"
          classNames={{ root: classes.chip, label: classes.chipLabel }}
        >
          {part.text}
        </Badge>
      </span>
    )
  if (part.kind !== 'outcome') return null
  // The `·` before an outcome sits inside its wrapper, so a wrap never leaves it dangling at a line end.
  const dot = lead ? <span aria-hidden>{`·${NBSP}`}</span> : null
  return (
    <span className={classes.feedOutcome}>
      {dot}
      {part.text}
    </span>
  )
}
