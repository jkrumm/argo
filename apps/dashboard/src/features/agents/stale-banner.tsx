import { Alert, Code, Text } from '@mantine/core'
import { relativeTime } from 'basalt-ui/format'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import type { OverviewRecord } from '../../lib/queries/agents'
import { STALE_AFTER_MS, snapshotAgeMs } from './model'

type Props = {
  latest: OverviewRecord | null
}

/**
 * Renders only when the feed itself is suspect: no snapshot at all, or the latest one older than
 * 30 minutes. A quiet machine still pushes on schedule, so age is a statement about the producer
 * (sideclaw on the dev host), not about the agents.
 */
export function StaleBanner({ latest }: Props) {
  const age = snapshotAgeMs(latest)
  if (age === null) {
    return (
      <Alert
        color="gray"
        variant="light"
        icon={<IconInfoCircle size={16} />}
        title="No snapshot yet"
      >
        Nothing has been pushed to <Code>POST /agents/overview</Code> — the dev host's overview
        producer has not reported.
      </Alert>
    )
  }
  if (age < STALE_AFTER_MS) return null
  return (
    <Alert
      color="orange"
      variant="light"
      icon={<IconAlertTriangle size={16} />}
      title="Stale snapshot"
    >
      Latest snapshot from{' '}
      <Text span fw={600}>
        {latest!.machine}
      </Text>{' '}
      was received {relativeTime(latest!.receivedAt)} — the producer has stopped pushing. Everything
      below is that last snapshot, not the live state.
    </Alert>
  )
}
