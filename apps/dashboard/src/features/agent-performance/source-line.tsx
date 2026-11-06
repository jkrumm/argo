import { Text } from '@mantine/core'
import type { ReactNode } from 'react'

/** The muted line that closes a section: the exact source, and the cost basis where cost is shown. */
export function SourceLine({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" c="dimmed" data-source-line>
      {children}
    </Text>
  )
}
