/**
 * Prototype of the chart facts header (docs/design/UPSTREAM.md "Chart facts header"): the headline
 * figure with its unit, then comparison and period, on one wrapping mono line. It replaces the
 * filler-question subtitle; rendered as the first child of a `ChartCard`.
 */
import { Box } from '@mantine/core'
import type { Fact } from './model'
import classes from './stat-strip.module.css'

export function FactsLine({ fact }: { fact: Fact }) {
  return (
    <Box className={classes.facts}>
      <span className={classes.factValue}>{fact.value}</span>
      <span className={classes.factUnit}>
        {fact.unit ?? ''}
        {fact.context.length > 0 ? ' ·' : ''}
      </span>
      {/* The separator trails its item, so a wrapped line ends in a dot instead of starting with one. */}
      {fact.context.map((c, i) => (
        <span key={c} className={classes.factContext}>
          {c}
          {i < fact.context.length - 1 ? ' ·' : ''}
        </span>
      ))}
    </Box>
  )
}
