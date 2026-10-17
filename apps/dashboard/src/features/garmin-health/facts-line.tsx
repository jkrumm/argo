/**
 * Prototype of the chart facts header (docs/design/UPSTREAM.md "Chart facts header"): the headline
 * figure with its unit, then comparison and period, on one wrapping mono line. It replaces the
 * filler-question subtitle; rendered as the first child of a `ChartCard`.
 */
import { Box } from '@mantine/core'
import type { Fact } from './model'
import classes from './stat-strip.module.css'

export function FactsLine({ fact }: { fact: Fact }) {
  const hasContext = fact.context.length > 0
  return (
    <Box className={classes.facts}>
      {/* The separator trails its item (the unit, else the value), so no line starts with a dot. */}
      <span className={classes.factValue}>
        {fact.value}
        {fact.unit === undefined && hasContext ? ' ·' : ''}
      </span>
      {fact.unit !== undefined && (
        <span className={classes.factUnit}>
          {fact.unit}
          {hasContext ? ' ·' : ''}
        </span>
      )}
      {fact.context.map((c, i) => (
        <span key={c} className={classes.factContext}>
          {c}
          {i < fact.context.length - 1 ? ' ·' : ''}
        </span>
      ))}
    </Box>
  )
}
