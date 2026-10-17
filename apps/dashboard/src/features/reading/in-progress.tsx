import { Card, Text } from '@mantine/core'
import { EmptyState, Meter, Section } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import { IconBooks } from '@tabler/icons-react'
import { relativeTime } from '../../lib/format'
import { BookTitle, Cover } from './book-parts'
import { formatReadTime } from './format'
import {
  hoursLabel,
  hoursLeft,
  parseTimestamp,
  progressPercent,
  shortDate,
  STATUS,
  type ShelfItem,
} from './model'
import classes from './reading.module.css'

/** Progress is not a verdict: the muted fill, never `Meter`'s near-white neutral. */
const MUTED_FILL = alpha(VX.muted, 0.35)

function facts(book: ShelfItem, pace: number | null, now: number): string[] {
  const { stats } = book
  if (stats === null) {
    return book.startedDate === null ? [] : [`started ${shortDate(book.startedDate)}`]
  }
  const left = hoursLeft(book, pace)
  const lastRead = parseTimestamp(stats.lastReadAt)
  return [
    ...(stats.totalReadSeconds > 0 ? [`${formatReadTime(stats.totalReadSeconds)} read`] : []),
    ...(stats.sessions > 0
      ? [`${stats.sessions} ${stats.sessions === 1 ? 'session' : 'sessions'}`]
      : []),
    ...(book.pages === null
      ? ['no page count, so no time left']
      : left === null || pace === null
        ? []
        : [`≈ ${hoursLabel(left)} left at ${pace} pages/h`]),
    lastRead === null
      ? 'last read —'
      : `last read ${relativeTime(lastRead, { now, numeric: 'always' })}`,
  ]
}

function ProgressCard({ book, pace, now }: { book: ShelfItem; pace: number | null; now: number }) {
  const percent = progressPercent(book)
  return (
    <Card py="sm" px="md" data-shot="progress-card">
      <div className={classes.card}>
        <Cover book={book} width={56} />
        <div className={classes.cardBody}>
          <div>
            <BookTitle book={book} />
            <Text size="xs" c="dimmed" lineClamp={1}>
              {book.authors.join(', ')}
            </Text>
          </div>
          {percent === null ? (
            <Text size="sm" c="dimmed">
              — % · no device progress yet
            </Text>
          ) : (
            <Meter
              label={`Progress, ${book.title}`}
              value={percent}
              max={100}
              format={(v) => `${Math.round(v)}%`}
              endCaption={book.pages === null ? null : `${book.pages} p`}
              color={MUTED_FILL}
            />
          )}
          <Text className={classes.facts}>{facts(book, pace, now).join(' · ')}</Text>
        </div>
      </div>
    </Card>
  )
}

export function InProgress({
  shelf,
  pace,
  now,
}: {
  shelf: readonly ShelfItem[]
  pace: number | null
  now: number
}) {
  const books = shelf
    .filter((b) => b.statusId === STATUS.reading)
    // The stalest first: the one most likely to be dropped is the decision.
    .toSorted(
      (a, b) =>
        (parseTimestamp(a.stats?.lastReadAt ?? null) ?? Number.NEGATIVE_INFINITY) -
        (parseTimestamp(b.stats?.lastReadAt ?? null) ?? Number.NEGATIVE_INFINITY),
    )
  return (
    <Section title="Currently reading" count={books.length}>
      {books.length === 0 ? (
        <EmptyState
          icon={<IconBooks size={28} />}
          title="No books in progress — pick one from the backlog"
        />
      ) : (
        <div className={classes.cardGrid}>
          {books.map((book) => (
            <ProgressCard key={book.hardcoverBookId} book={book} pace={pace} now={now} />
          ))}
        </div>
      )}
    </Section>
  )
}
