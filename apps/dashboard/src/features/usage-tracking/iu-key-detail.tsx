/**
 * An IU key's detail on the Flow tab: its cap (meter, can spend today, the date it falls back under),
 * portal vs tracked, where the tokens go and what each tool costs per million. One key at a time, never
 * a sum: each key has its own cap and `gapReading`. Dollars lead; the tokens sit beside them in the
 * lists. A key the portal has not reported for says so in its cap card.
 */
import { Suspense } from 'react'
import { Grid, Stack } from '@mantine/core'
import { ChartCard } from 'basalt-ui/charts'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import type { Range } from '../../lib/queries/usage'
import type { IuKeyId } from './accounts'
import CacheEfficiency from './cache-efficiency'
import { IuKeyLimit } from './iu-key-limit'
import Reconciliation from './reconciliation'
import { selectedKeyWallet } from './scope'
import TopSpenders from './top-spenders'

export interface IuKeyDetailProps {
  iuKey: IuKeyId
  range: Range
}

const fallback = (height: number) => (
  <ChartCard state={{ pending: true }} placeholderHeight={height} />
)

export function IuKeyDetail({ iuKey, range }: IuKeyDetailProps) {
  const wallet = selectedKeyWallet(iuKey)
  const payers = [wallet.id]

  return (
    <Stack gap="md" data-shot={`iu-key-detail-${iuKey}`}>
      <IuKeyLimit wallet={wallet} />
      <Suspense fallback={fallback(200)}>
        <Reconciliation wallet={wallet} />
      </Suspense>
      <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Suspense fallback={fallback(260)}>
            <TopSpenders range={range} lens="cost" payers={payers} workspace={undefined} />
          </Suspense>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Suspense fallback={fallback(260)}>
            <CacheEfficiency range={range} lens="cost" payers={payers} workspace={undefined} />
          </Suspense>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}
