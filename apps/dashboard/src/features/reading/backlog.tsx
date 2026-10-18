import { Button, Text } from '@mantine/core'
import { BarList, Section, useSizeClass } from 'basalt-ui'
import { useState } from 'react'
import { BookRow } from './book-parts'
import { NO_PACE_REASON, approxHours, genreCounts, type BacklogTotals } from './model'
import classes from './reading.module.css'

const ROWS_WIDE = 8
const ROWS_NARROW = 5

function headerFacts(b: BacklogTotals, pace: number | null): string {
  return [
    'ranked by community rating',
    ...(b.pages > 0 ? [`${b.pages.toLocaleString('en-GB')} p`] : []),
    b.hours !== null
      ? `${approxHours(b.hours)} to read`
      : `no hours estimate: ${pace === null ? NO_PACE_REASON : 'no page counts'}`,
    ...(b.withoutPages > 0 ? [`${b.withoutPages} without a page count`] : []),
  ].join(' · ')
}

export function Backlog({ backlog, pace }: { backlog: BacklogTotals; pace: number | null }) {
  const narrow = useSizeClass() === 'compact'
  const [expanded, setExpanded] = useState(false)
  const cap = narrow ? ROWS_NARROW : ROWS_WIDE
  const shown = expanded ? backlog.books : backlog.books.slice(0, cap)
  const genres = genreCounts(backlog.books, 5)

  return (
    <div className={classes.pair} data-shot="backlog">
      <Section
        title="Backlog"
        count={backlog.count}
        {...(backlog.count > 0 && {
          summary: <Text className={classes.facts}>{headerFacts(backlog, pace)}</Text>,
        })}
      >
        {backlog.count === 0 ? (
          <Text size="sm" c="dimmed">
            Nothing waiting on the shelf.
          </Text>
        ) : (
          <>
            <ul className={classes.list}>
              {shown.map((book) => (
                <BookRow
                  key={book.hardcoverBookId}
                  book={book}
                  meta={
                    book.communityRating === null
                      ? undefined
                      : `★ ${book.communityRating.toFixed(1)}${
                          book.ratingsCount === null ? '' : ` · ${book.ratingsCount} ratings`
                        }`
                  }
                  trail={book.pages === null ? '—' : `${book.pages} p`}
                />
              ))}
            </ul>
            {backlog.count > cap ? (
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'Show fewer' : `Show all ${backlog.count}`}
              </Button>
            ) : null}
          </>
        )}
      </Section>
      <Section
        title="Backlog by genre · top 5"
        summary={<Text className={classes.facts}>a book counts once under each of its genres</Text>}
      >
        <BarList
          label="Backlog books per genre"
          items={genres.map((g) => ({ key: g.label, label: g.label, value: g.value }))}
          format={(v) => `${v} books`}
          emptyText="No genres on the backlog."
        />
      </Section>
    </div>
  )
}
