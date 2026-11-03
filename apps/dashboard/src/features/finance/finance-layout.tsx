import { Button, Center, Loader } from '@mantine/core'
import { Outlet } from '@tanstack/react-router'
import { EmptyState } from 'basalt-ui'
import { FinanceApiError } from './api/client'
import { UnlockScreen } from './components/unlock-screen'
import { useVaultStatus } from './lib/vault'

/**
 * The gate every finance page sits behind. The status query decides what renders: the unlock screen
 * while the vault is locked (including after a 423 or an idle lock), the pages while it is open.
 * Polling lives and dies with this component, so it runs only while a finance page is open.
 */
export function FinanceLayout() {
  const status = useVaultStatus()

  if (status.isPending) {
    return (
      <Center mih={240}>
        <Loader size="sm" aria-label="Checking the vault" />
      </Center>
    )
  }
  // Fail closed: react-query keeps the last good data across a failed refetch, and a service that
  // just restarted has dropped the key. A status that cannot be read now never keeps pages on screen.
  if (status.isError || status.data === undefined) {
    const down = status.error instanceof FinanceApiError && status.error.status === 503
    return (
      <EmptyState
        tier="page"
        title={down ? 'Finance service unavailable' : 'Could not read the vault state'}
        description={
          down
            ? 'The finance service on the mini is not answering. Start it, then retry.'
            : (status.error?.message ?? 'Unknown error.')
        }
        action={
          <Button
            variant="default"
            loading={status.isRefetching}
            onClick={() => void status.refetch()}
          >
            Retry
          </Button>
        }
      />
    )
  }
  if (status.data.locked) return <UnlockScreen blockedUntil={status.data.unlock_blocked_until} />
  return <Outlet />
}
