import { useState } from 'react'
import { Badge, Card, Stack, Text } from '@mantine/core'
import { EventList, Section, useSizeClass } from 'basalt-ui'
import { feedEmptyLine, type ActivityEvent } from './model'
import classes from './home.module.css'

/** Rows shown at desktop width; the rest is behind `Show earlier`. */
const ROW_LIMIT = 12
const ROW_LIMIT_NARROW = 6

type Props = {
  /** Newest first, inside the horizon. */
  events: readonly ActivityEvent[]
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

/** Day-grouped feed of what the control plane, the narrator and the calendar did, newest first. */
export function ActivityFeed({ events, total, stale, loaded, failed, pending, now }: Props) {
  const [open, setOpen] = useState(false)
  const narrow = useSizeClass() === 'compact'
  const cap = open ? total : Math.min(narrow ? ROW_LIMIT_NARROW : ROW_LIMIT, total)
  const remaining = total - cap
  const items = events.slice(0, cap).map((e) => ({
    id: e.key,
    at: e.ms,
    actor: e.actor,
    title: e.title,
    body: e.outcome,
    chips: e.chip ? (
      <Badge variant="light" color="gray" size="sm" tt="none">
        {e.chip}
      </Badge>
    ) : undefined,
  }))
  return (
    <Card>
      <Section title="Activity">
        <Stack gap="md" data-shot="activity" data-shot-states="empty">
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
          ) : null}
          <EventList
            label="Activity by day"
            density="feed"
            group="day"
            items={items}
            now={now}
            empty={{
              title: 'No events yet',
              description: feedEmptyLine({ loaded, failed, pending, now }),
            }}
            {...(remaining > 0 ? { earlier: { onLoad: () => setOpen(true), remaining } } : {})}
          />
        </Stack>
      </Section>
    </Card>
  )
}
