import { Group, Text } from '@mantine/core'
import { StatusDot } from 'basalt-ui'
import { VX } from 'basalt-ui/tokens'
import type { feedAside } from './model'

/** The freshness word beside the headline: a neutral dot while live, a warn dot once stale. */
export function FeedAside({ aside }: { aside: NonNullable<ReturnType<typeof feedAside>> }) {
  return (
    <Group gap="xs" wrap="nowrap" component="span">
      <StatusDot color={aside.tone === 'live' ? VX.line : VX.status.warn} />
      <Text span inherit>
        {aside.text}
      </Text>
    </Group>
  )
}
