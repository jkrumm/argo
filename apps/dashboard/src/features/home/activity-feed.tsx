import { useState } from 'react'
import { Card, Stack } from '@mantine/core'
import { EventList, Section, useSizeClass } from 'basalt-ui'
import { emptyStreamLabel, type ActivityEvent } from './model'

/** Rows shown at desktop width; the rest is behind `Show earlier`. */
const ROW_LIMIT = 12
const ROW_LIMIT_NARROW = 6

type Props = {
  /** Newest first, inside the horizon. */
  events: readonly ActivityEvent[]
  total: number
  now: number
}

/** Day-grouped feed of what the calendar did, newest first. */
export function ActivityFeed({ events, total, now }: Props) {
  const [open, setOpen] = useState(false)
  const narrow = useSizeClass() === 'compact'
  const cap = open ? total : Math.min(narrow ? ROW_LIMIT_NARROW : ROW_LIMIT, total)
  const remaining = total - cap
  const items = events.slice(0, cap).map((e) => ({
    id: e.key,
    at: e.ms,
    actor: e.actor,
    title: e.title,
  }))
  return (
    <Card>
      <Section title="Activity">
        <Stack gap="md" data-shot="activity" data-shot-states="empty">
          <EventList
            label="Activity by day"
            density="feed"
            group="day"
            items={items}
            now={now}
            empty={{
              title: 'No events yet',
              description: emptyStreamLabel(now),
            }}
            {...(remaining > 0 ? { earlier: { onLoad: () => setOpen(true), remaining } } : {})}
          />
        </Stack>
      </Section>
    </Card>
  )
}
