import type { ReactNode } from 'react'
import { Stack, Text } from '@mantine/core'

/**
 * Section divider for the Strength Tracker page.
 *
 * Mirrors the Garmin Health pattern — small, slightly muted heading above a
 * row of charts. Optional subtitle reads as the question the section answers.
 */
export function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <Stack gap={2}>
      <Text fw={600} size="sm" mt={4} style={{ opacity: 0.65 }}>
        {title}
      </Text>
      {subtitle !== undefined && subtitle.length > 0 && (
        <Text size="xs" c="dimmed" mb={4} style={{ fontSize: 12 }}>
          {subtitle}
        </Text>
      )}
      {children}
    </Stack>
  )
}
