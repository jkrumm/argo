import type { ReactNode } from 'react'
import { Stack, Text } from '@mantine/core'

/**
 * Section divider for the Strength Tracker page.
 *
 * Mirrors the Garmin Health pattern — small, slightly muted heading above a
 * row of charts.
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm" style={{ opacity: 0.65, marginTop: 4 }}>
        {title}
      </Text>
      {children}
    </Stack>
  )
}
