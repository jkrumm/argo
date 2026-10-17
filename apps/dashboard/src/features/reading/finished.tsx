import { Text } from '@mantine/core'
import { BarList, Section } from 'basalt-ui'
import { BookRow } from './book-parts'
import { shortDate, timeRead, type FinishedGroup, type ShelfItem } from './model'
import classes from './reading.module.css'

function trail(date: string, pages: number | null): string {
  return `${shortDate(date)}${pages === null ? '' : ` · ${pages} p`}`
}

/** `★ 4 · 12 days`; the days are left out (not zeroed) when the book has no start date. */
function finishedMeta(rating: number | null, days: number | null): string | undefined {
  const parts = [
    ...(rating === null ? [] : [`★ ${rating}`]),
    ...(days === null ? [] : [days === 0 ? 'same day' : `${days} ${days === 1 ? 'day' : 'days'}`]),
  ]
  return parts.length === 0 ? undefined : parts.join(' · ')
}

export function Finished({ groups }: { groups: readonly FinishedGroup[] }) {
  const total = groups.reduce((sum, g) => sum + g.rows.length, 0)
  const unknownDays = groups.reduce(
    (sum, g) => sum + g.rows.filter((r) => r.days === null).length,
    0,
  )
  return (
    <Section
      title="Finished"
      count={total}
      {...(unknownDays > 0 && {
        summary: (
          <Text className={classes.facts}>
            days to finish needs a start date; {unknownDays} of {total} have none, so no days are
            shown
          </Text>
        ),
      })}
    >
      {total === 0 ? (
        <Text size="sm" c="dimmed">
          No finished books with a read date.
        </Text>
      ) : (
        <div role="list">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <Text className={classes.groupHeading}>
                {group.label}
                <span>{group.rows.length}</span>
              </Text>
              {group.rows.map(({ book, readDate, days }) => (
                <BookRow
                  key={book.hardcoverBookId}
                  book={book}
                  meta={finishedMeta(book.rating, days)}
                  trail={trail(readDate, book.pages)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </Section>
  )
}

const hours = (seconds: number) => seconds / 3600

export function TimeRead({ shelf }: { shelf: readonly ShelfItem[] }) {
  const rows = timeRead(shelf)
  return (
    <Section title="Time read, per book · hours" count={rows.length}>
      <BarList
        label="Time read per book, hours"
        items={rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: hours(r.seconds),
        }))}
        format={(v) => `${v.toFixed(1)} h`}
        emptyText="No device reading time recorded yet."
      />
    </Section>
  )
}
