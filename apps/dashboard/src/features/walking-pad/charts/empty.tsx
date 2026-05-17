import { Stack, Text } from '@mantine/core'

export function ChartEmpty({ height = 280, label }: { height?: number; label: string }) {
  return (
    <Stack justify="center" align="center" h={height} gap={4}>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Stack>
  )
}
