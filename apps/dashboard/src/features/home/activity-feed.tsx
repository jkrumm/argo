import { useState } from 'react'
import { Badge, Button, Card, Text } from '@mantine/core'
import { Section, useSizeClass } from 'basalt-ui'
import { clockTime } from '../agents/model'
import { emptyStreamLabel, NO_FEED_LABEL, type ActivityGroup } from './model'
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
  now: number
}

/**
 * Day-grouped feed of what the control plane, the narrator and the calendar did, newest first.
 * Prototype of `EventList density="feed" live` (docs/design/UPSTREAM.md): the Agents `EventList`
 * has a fixed 10 rem actor column, too wide for a 40 % column.
 */
export function ActivityFeed({ groups, total, stale, loaded, now }: Props) {
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
              {loaded ? emptyStreamLabel(now) : NO_FEED_LABEL}
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
                    <div key={e.key} role="listitem" className={classes.feedRow}>
                      <Text component="span" size="sm" className={classes.feedSentence}>
                        <span className={classes.feedActor}>{e.actor}</span> {e.title}
                        {e.outcome ? (
                          <>
                            {' '}
                            <span className={classes.feedOutcome}>{e.outcome}</span>
                          </>
                        ) : null}
                        {e.chip ? (
                          <>
                            {' '}
                            <Badge
                              variant="light"
                              color="gray"
                              size="sm"
                              fz="sm"
                              tt="none"
                              classNames={{ root: classes.chip, label: classes.chipLabel }}
                            >
                              {e.chip}
                            </Badge>
                          </>
                        ) : null}
                      </Text>
                      <span className={classes.feedTime}>
                        {clockTime(new Date(e.ms).toISOString())}
                      </span>
                      {e.detail ? <span className={classes.feedDetail}>{e.detail}</span> : null}
                    </div>
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
