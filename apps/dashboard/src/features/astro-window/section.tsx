import type { ReactNode } from 'react'
import { Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'

/**
 * Section divider for the Astro Window page. Mirrors the Body Composition / Garmin Health
 * pattern — small, slightly muted heading above a panel. Optional subtitle reads as the
 * question the section answers.
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
        <Text size="xs" c="dimmed" mb={4} style={{ fontSize: VX.text.xs }}>
          {subtitle}
        </Text>
      )}
      {children}
    </Stack>
  )
}
