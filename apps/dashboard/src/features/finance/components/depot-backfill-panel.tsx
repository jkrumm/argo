import { Button, Loader } from '@mantine/core'
import { EmptyState } from 'basalt-ui'
import { useBackfill, useListWrites } from '../api/lists'
import { reportWriteError } from '../api/mutations'
import type { WatchList } from '../api/types'
import { backfillText, loadingHistory } from '../lib/depot-nav'

/**
 * Where the main area stands while an added instrument has no bars: the service is loading its history (this polls and, the
 * moment bars exist, the page refetches and shows the chart), or it failed and says why, with Retry.
 */
export function DepotBackfillPanel({
  symbol,
  name,
  lists,
}: {
  symbol: string
  name: string
  lists: readonly WatchList[]
}) {
  const backfill = useBackfill(symbol, true)
  const writes = useListWrites()
  const failed = backfill.data?.state === 'failed'
  const home = lists.find((list) => list.entries.some((entry) => entry.symbol === symbol))

  return (
    <EmptyState
      tier="section"
      data-shot="depot-loading"
      icon={failed || !loadingHistory(backfill.data) ? undefined : <Loader size="sm" />}
      title={
        failed ||
        backfill.data?.state === 'none' ||
        (backfill.data?.state === 'done' && backfill.data.bars === 0)
          ? `${name}: no history yet`
          : `${name}: loading its history`
      }
      description={backfillText(backfill.data)}
      action={
        failed && home !== undefined ? (
          <Button
            variant="default"
            onClick={() => void writes.addEntry(home.id, { symbol }).catch(reportWriteError)}
          >
            Try again
          </Button>
        ) : undefined
      }
    />
  )
}
