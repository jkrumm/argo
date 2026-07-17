import type { ReactNode } from 'react'
import { Stack, Text } from '@mantine/core'

/**
 * Section divider for the Garmin Health page.
 *
 * Matches the old dashboard's `SectionTitle` styling — a small, slightly
 * muted heading above a row of charts.
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm" mt={4} style={{ opacity: 0.65 }}>
        {title}
      </Text>
      {children}
    </Stack>
  )
}
