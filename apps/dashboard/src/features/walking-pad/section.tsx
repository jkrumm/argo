import type { ReactNode } from 'react'
import { Stack, Text } from '@mantine/core'
import { VX } from 'basalt-ui/tokens'

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
