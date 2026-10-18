import { Card, Text } from '@mantine/core'
import { EmptyState, Meter, Section } from 'basalt-ui'
import { IconBooks } from '@tabler/icons-react'
import { BookTitle, Cover } from './book-parts'
import { formatReadTime } from './format'
import {
  approxHours,
  hoursLeft,
  parseTimestamp,
  progressPercent,
  shortDate,
  STATUS,
  type ShelfItem,
  lastReadFact,
} from './model'
import { withUnit } from '../../lib/format'
import classes from './reading.module.css'

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
        : [`${approxHours(left)} left at ${withUnit(pace, 'pages/h')}`]),
    lastReadFact(lastRead, now),
  ]
}

function ProgressCard({ book, pace, now }: { book: ShelfItem; pace: number | null; now: number }) {
  const percent = progressPercent(book)
  return (
    <Card data-shot="progress-card" data-shot-absent="empty">
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
              no device progress yet
            </Text>
          ) : (
            <Meter
              label={`Progress, ${book.title}`}
              value={percent}
              max={100}
              format={(v) => `${Math.round(v)}%`}
              endCaption={book.pages === null ? null : withUnit(book.pages, 'p')}
              tone="muted"
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
    <Section title="Currently reading">
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
