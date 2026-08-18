import { Stack, Text } from '@mantine/core'

/**
 * Centered "no data yet" message rendered inside a `ChartCard` when a chart's
 * filtered series has zero points. Matches the chart's normal inner height so
 * the card doesn't collapse and the empty state reads as intentional rather
 * than a load glitch.
 */
export function ChartEmpty({
  height = 280,
  message = 'No entries yet',
}: {
  // `string` as well as `number` so a full-bleed caller can hand it `"100%"` and have the empty
  // state fill its container instead of guessing a pixel height.
  height?: number | string
  message?: string
}) {
  return (
    <Stack justify="center" align="center" h={height} gap={4}>
      <Text size="sm" c="dimmed">
        {message}
      </Text>
    </Stack>
  )
}
