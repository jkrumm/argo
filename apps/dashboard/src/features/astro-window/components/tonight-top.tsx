import type { ReactNode } from 'react'
import { Box } from '@mantine/core'
import classes from './tonight-layout.module.css'

/** The verdict, the gates and the night timeline in one responsive block (see the css module). */
export function TonightTop({
  verdict,
  gates,
  timeline,
}: {
  verdict: ReactNode
  gates: ReactNode
  timeline: ReactNode
}) {
  return (
    <Box className={classes.host}>
      <Box className={classes.grid}>
        <Box className={classes.verdict}>{verdict}</Box>
        <Box className={classes.gates}>{gates}</Box>
        <Box className={classes.timeline}>{timeline}</Box>
      </Box>
    </Box>
  )
}
