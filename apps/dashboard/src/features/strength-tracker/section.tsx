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
      <Text fw={600} size="sm" style={{ opacity: 0.65, marginTop: 4 }}>
        {title}
      </Text>
      {subtitle !== undefined && subtitle.length > 0 && (
        <Text size="xs" c="dimmed" style={{ fontSize: 12, marginBottom: 4 }}>
          {subtitle}
        </Text>
      )}
      {children}
    </Stack>
  )
}
