import { Box, Grid, SimpleGrid, Stack } from '@mantine/core'
import { PageBar } from 'basalt-ui'
import { FilterSet, RangeFilter } from 'basalt-ui/controls'
import { CONTAINER_GRID_BREAKPOINTS, CONTAINER_KEYS as CQ } from 'basalt-ui/tokens'
import { lineStore } from '../../lib/window-stores'
import { RouterChart } from './charts/router-chart'
import { SpeedChart } from './charts/speed-chart'
import { TargetChart } from './charts/target-chart'
import { LineStrip } from './strip'

const TARGETS = ['gateway', 'cloudflare', 'google', 'quad9'] as const

/**
 * The internet line on one screen, in the order of the questions: is it up now (the strip), how good has
 * it been over the range (loss and round-trip time per target, outages shaded), what does the line itself
 * deliver (sync rate, noise margin, speed tests). One range control; every card reads ClickHouse through
 * its own endpoint, so one failing query is one error card.
 */
export function LinePage() {
  return (
    <>
      <PageBar
        filters={
          <FilterSet>
            <RangeFilter field={lineStore.field.window} />
          </FilterSet>
        }
      />
      <Stack gap="md">
        <Box data-shot="strip">
          <LineStrip />
        </Box>
        <SimpleGrid
          type="container"
          cols={{ base: 1, [CQ.wide]: 2 }}
          spacing="md"
          data-shot="targets"
        >
          {TARGETS.map((target) => (
            <TargetChart key={target} target={target} />
          ))}
        </SimpleGrid>
        <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS} data-shot="line">
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <RouterChart metric="sync" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <RouterChart metric="noise" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <SpeedChart />
          </Grid.Col>
        </Grid>
      </Stack>
    </>
  )
}
