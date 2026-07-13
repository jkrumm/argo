import type { ReactNode } from 'react'
import { Stack, Text } from '@mantine/core'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm" opacity={0.65} mt={4}>
        {title}
      </Text>
      {children}
    </Stack>
  )
}
