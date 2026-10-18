/**
 * PageSummary — a page's opening: one headline sentence that carries at least one live number, and
 * an optional mono facts line under it (`·`-separated). An optional `aside` sits right of the
 * headline (a date, a freshness word). Facts that are `null`/`false` are dropped, so a caller can
 * pass conditional facts inline.
 *
 * Prototype of Keel's page summary (basalt SPEC § 6.9 "Page summary"; docs/design/UPSTREAM.md).
 */
import type { ReactNode } from 'react'
import { Skeleton } from '@mantine/core'
import classes from './page-summary.module.css'

type Fact = ReactNode | null | false | undefined

type Content = {
  /** The headline sentence. Must state a live fact, never describe the page. */
  sentence: ReactNode
  /** Short facts under the headline, e.g. `12 open · 3 need you · oldest 2 d`. */
  facts?: readonly Fact[]
  /** Right of the headline: a date or a freshness word. */
  aside?: ReactNode
  loading?: false
}

/** While the sentence's data loads: a skeleton of the same shape, no content props needed. */
type Loading = Partial<Omit<Content, 'loading'>> & { loading: true }

export type PageSummaryProps = Content | Loading

const NO_FACTS: readonly Fact[] = []

export function PageSummary(props: PageSummaryProps) {
  if (props.loading === true) {
    return (
      <div className={classes.root} data-shot="summary" aria-busy="true">
        <Skeleton height={28} width="55%" radius="sm" />
      </div>
    )
  }
  const { sentence, facts = NO_FACTS, aside } = props
  const shown = facts.filter((f) => f !== null && f !== false && f !== undefined && f !== '')
  return (
    <div className={classes.root} data-shot="summary">
      <div className={classes.top}>
        <h2 className={classes.sentence}>{sentence}</h2>
        {aside !== undefined && <span className={classes.aside}>{aside}</span>}
      </div>
      {shown.length > 0 && (
        <p className={classes.facts}>
          {shown.map((fact, i) => (
            <span key={i} className={classes.fact}>
              {fact}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
