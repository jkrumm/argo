import { Badge, Group } from '@mantine/core'
import type { AttentionReason } from './model'

const COLOR: Record<AttentionReason['type'], string> = {
  expired: 'red',
  missing: 'red',
  expiring: 'yellow',
  nokind: 'gray',
}

export function AttentionBadges({ reasons }: { reasons: AttentionReason[] }) {
  if (reasons.length === 0) return null
  return (
    <Group gap={4}>
      {reasons.map((reason) => (
        <Badge key={reason.type} variant="light" color={COLOR[reason.type]} tt="none">
          {reason.label}
        </Badge>
      ))}
    </Group>
  )
}
