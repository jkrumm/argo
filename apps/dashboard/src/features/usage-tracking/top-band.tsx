/**
 * The page's top band, the three questions the usage page exists to answer: Q1 the IU cap, Q2 the
 * subscription headroom, Q3 the biggest movers. One row at desktop widths, stacked below. None of it
 * follows the page filters: the cap and quota are account-level, and the movers fix their payers.
 */
import { Grid } from '@mantine/core'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { CapGauge } from './cap-gauge'
import { MoversList } from './movers-list'
import { SubscriptionMeters } from './subscription-meters'

export function TopBand() {
  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <CapGauge />
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <SubscriptionMeters />
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 4 }}>
        <MoversList />
      </Grid.Col>
    </Grid>
  )
}
