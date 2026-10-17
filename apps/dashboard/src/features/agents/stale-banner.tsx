import { Alert, Code, Text } from '@mantine/core'
import { relativeTime } from '../../lib/format'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import type { OverviewRecord } from '../../lib/queries/agents'
import { STALE_AFTER_MS, snapshotAgeMs } from './model'

type Props = {
  latest: OverviewRecord | null
  /** The fetch from Argo failed: that is not the producer's silence, so say nothing about it. */
  fetchFailed?: boolean
}

/**
 * Renders only when the feed itself is suspect: no snapshot at all, or the latest one older than
 * 30 minutes. A quiet machine still pushes on schedule, so age is a statement about the producer
 * (agent-gateway on the dev host), not about the agents.
 */
export function StaleBanner({ latest, fetchFailed = false }: Props) {
  if (fetchFailed) return null
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
