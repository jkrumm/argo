import type { ReactNode } from 'react'
import { Box } from '@mantine/core'
import classes from './tonight-layout.module.css'

/** The verdict (with its gates) and the night timeline in one responsive block (see the css module). */
export function TonightTop({ verdict, timeline }: { verdict: ReactNode; timeline: ReactNode }) {
  return (
    <Box className={classes.host}>
      <Box className={classes.grid}>
        <Box className={classes.verdict}>{verdict}</Box>
        <Box className={classes.timeline}>{timeline}</Box>
      </Box>
    </Box>
  )
}
