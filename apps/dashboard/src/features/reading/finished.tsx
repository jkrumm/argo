import { Text } from '@mantine/core'
import { Section } from 'basalt-ui'
import { BookRow } from './book-parts'
import { scopeLabel, shortDate, type FinishedGroup, type TimeRow } from './model'
import { formatReadTime } from './format'
import { withUnit } from '../../lib/format'
import classes from './reading.module.css'

function trail(date: string, pages: number | null): string {
  return `${shortDate(date)}${pages === null ? '' : ` · ${withUnit(pages, 'p')}`}`
}

/** `4 ★ · 12 days`; the days are left out (not zeroed) when the book has no start date. */
function finishedMeta(rating: number | null, days: number | null): string | undefined {
  const parts = [
    ...(rating === null ? [] : [withUnit(rating, '★')]),
    ...(days === null
      ? []
      : [days === 0 ? 'same day' : withUnit(days, days === 1 ? 'day' : 'days')]),
  ]
  return parts.length === 0 ? undefined : parts.join(' · ')
}

export function Finished({
  groups,
  undated,
}: {
  groups: readonly FinishedGroup[]
  /** Read books without a read date: on the shelf, not in this list. */
  undated: number
}) {
  const total = groups.reduce((sum, g) => sum + g.rows.length, 0)
  const note = undated > 0 ? `${undated} finished without a read date, not listed` : null
  const scope = scopeLabel(groups)
  return (
    <Section
      title={scope === '' ? 'Finished' : `Finished · ${scope}`}
      {...(note !== null && { summary: <Text className={classes.facts}>{note}</Text> })}
    >
      {total === 0 ? (
        <Text size="sm" c="dimmed">
          No finished books with a read date.
        </Text>
      ) : (
        <div>
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <Text className={classes.groupHeading}>
                {group.label}
                <span>
                  {withUnit(group.rows.length, group.rows.length === 1 ? 'book' : 'books')}
                </span>
              </Text>
              <ul className={classes.list}>
                {group.rows.map(({ book, readDate, days }) => (
                  <BookRow
                    key={book.hardcoverBookId}
                    book={book}
                    meta={finishedMeta(book.rating, days)}
                    trail={trail(readDate, book.pages)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Section>
  )
}

/** Finished books by device reading time. In-progress books are on their cards, once. */
export function TimeRead({ rows }: { rows: readonly TimeRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.seconds, 0)
  return (
    <Section
      title="Time read, finished books"
      summary={<Text className={classes.facts}>{formatReadTime(total)} in total</Text>}
    >
      <ul className={classes.list}>
        {rows.map((r) => (
          <li key={r.key} className={classes.row}>
            <Text size="sm" className={classes.rowBody} lineClamp={2}>
              {r.label}
            </Text>
            <div className={classes.rowTrail}>{formatReadTime(r.seconds)}</div>
          </li>
        ))}
      </ul>
    </Section>
  )
}
