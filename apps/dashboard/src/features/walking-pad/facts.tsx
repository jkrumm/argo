import { Box } from '@mantine/core'
import classes from './strip.module.css'

/**
 * A chart's facts header, in the card body: ChartCard folds a long `subtitle` into an info icon at
 * half width, and a fact only visible on hover is not shown. Value, unit, then context.
 */
export function Facts({ value, unit, context }: { value: string; unit?: string; context: string }) {
  return (
    <Box className={classes.facts}>
      <span className={classes.factValue}>{value}</span>
      {unit !== undefined && <span className={classes.factUnit}>{unit}</span>}
      <span className={classes.factContext}>{context}</span>
    </Box>
  )
}
