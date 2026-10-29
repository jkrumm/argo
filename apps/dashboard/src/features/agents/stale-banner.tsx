import { Alert, Code, Text } from '@mantine/core'
import { formatAgo } from '../../lib/format'
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react'
import type { OverviewRecord } from '../../lib/queries/agents'
import { NO_SNAPSHOT_SHORT, STALE_AFTER_MS, snapshotAgeMs } from './model'

type Props = {
  latest: OverviewRecord | null
  /** The fetch from Argo failed: that is not the producer's silence, so say nothing about it. */
  fetchFailed?: boolean
}

/**
 * Renders only when the feed itself is suspect: no snapshot at all, or the latest one older than
 * 30 minutes. A quiet machine still pushes on schedule, so age is a statement about the producer
 * (agent-workflows on the dev host), not about the agents.
 */
export function StaleBanner({ latest, fetchFailed = false }: Props) {
  if (fetchFailed) return null
  const age = snapshotAgeMs(latest)
  if (age === null) {
    return (
      <Alert
        data-shot="no-snapshot"
        color="gray"
        variant="light"
        icon={<IconInfoCircle size={16} />}
        title={NO_SNAPSHOT_SHORT}
      >
        agent-workflows (<Code>agw</Code> overview workflow) pushes to{' '}
        <Code>POST /agents/overview</Code> every 10&nbsp;min from each dev host. If this stays
        empty, check that agent-workflows is running on a dev host.
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
      was received {formatAgo(age)} — the producer has stopped pushing. Everything below is that
      last snapshot, not the live state.
    </Alert>
  )
}
