import type { ReactNode } from 'react'
import { Box, Text } from '@mantine/core'
import classes from './home.module.css'

export type StripCellModel = {
  id: string
  caption: string
  value: string
  unit?: string | undefined
  /** Ink for the value, only when the reading is a verdict. */
  tone?: string | undefined
  visual?: ReactNode
  footer?: ReactNode
}

function StripCell({ cell }: { cell: StripCellModel }) {
  return (
    <Box className={classes.cell} data-shot={`strip-${cell.id}`}>
      <Text className={classes.caption}>{cell.caption}</Text>
      <div className={classes.reading}>
        <Text component="span" className={classes.value} {...(cell.tone ? { c: cell.tone } : {})}>
          {cell.value}
        </Text>
        {cell.unit ? <span className={classes.unit}>{cell.unit}</span> : null}
      </div>
      {cell.visual ? <div className={classes.visual}>{cell.visual}</div> : null}
      {cell.footer ? <div className={classes.footer}>{cell.footer}</div> : null}
    </Box>
  )
}

export function TodayStrip({ cells }: { cells: readonly StripCellModel[] }) {
  return (
    <section className={classes.strip} aria-label="Today at a glance">
      <div className={classes.grid}>
        {cells.map((cell) => (
          <StripCell key={cell.id} cell={cell} />
        ))}
      </div>
    </section>
  )
}
