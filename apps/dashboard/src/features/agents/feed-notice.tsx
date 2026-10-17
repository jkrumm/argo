import { Alert, Button } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import type { FeedState } from './model'

type Props = {
  state: Extract<FeedState, 'failed' | 'stale'>
  onRetry: () => void
  retrying: boolean
}

/** The snapshot fetch from Argo failed. With `stale`, the previous snapshot stays on screen below. */
export function FeedNotice({ state, onRetry, retrying }: Props) {
  return (
    <Alert
      color="red"
      variant="light"
      icon={<IconAlertTriangle size={16} />}
      title={
        state === 'failed' ? "Couldn't load the agent snapshot" : "Couldn't refresh the snapshot"
      }
    >
      {state === 'failed'
        ? 'Argo did not answer, so nothing below is known.'
        : 'Argo did not answer. Everything below is the last snapshot received.'}{' '}
      <Button variant="subtle" size="compact-sm" loading={retrying} onClick={onRetry}>
        Retry
      </Button>
    </Alert>
  )
}
