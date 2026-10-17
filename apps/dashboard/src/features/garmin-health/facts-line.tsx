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
      {fact.unit !== undefined && <span className={classes.factUnit}>{fact.unit}</span>}
      {fact.context.map((c) => (
        <span key={c} className={classes.factContext}>
          · {c}
        </span>
      ))}
    </Box>
  )
}
