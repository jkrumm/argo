import type { ReactNode } from 'react'
import { Box } from '@mantine/core'

/** A refetch with new params keeps the previous render, dimmed, instead of flashing a skeleton. */
export function RefetchDim({ active, children }: { active: boolean; children: ReactNode }) {
  return <Box opacity={active ? 0.55 : 1}>{children}</Box>
}
