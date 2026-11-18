import { SimpleGrid, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { PageBar } from 'basalt-ui'
import { ChartCard } from 'basalt-ui/charts'
import { FilterSet, RangeFilter } from 'basalt-ui/controls'
import { CONTAINER_KEYS as CQ } from 'basalt-ui/tokens'
import { machinesQueries } from '../../lib/queries/machines'
import { useField } from '../../lib/use-field'
import { machinesStore } from '../../lib/window-stores'
import { RateChart } from './charts/rate-chart'
import { ContainersCard, FilesystemsCard } from './charts/lists'
import { TrendChart } from './charts/trend-chart'
import { MachineTable } from './machine-table'
import classes from './machines.module.css'
import { RANGE_NOUN, selectHost } from './model'

/**
 * Every machine on one screen: a row each with its current CPU, memory, fullest disk, load and network
 * and the range's trend, then the selected machine's charts as small multiples on one shared time
 * axis. One range control. The list and the charts are two queries, so one failing is one error state.
 */
export function MachinesPage() {
  const { range } = machinesStore.useValues()
  const [picked, setPicked] = useField(machinesStore.field.host)
  const overview = useQuery(machinesQueries.overview(range))
  const machines = overview.data?.machines ?? []
  const host = selectHost(machines, picked)
  const machine = machines.find((m) => m.host === host)

  return (
    <>
      <PageBar
        filters={
          <FilterSet>
            <RangeFilter field={machinesStore.field.range} />
          </FilterSet>
        }
      />
      <Stack gap="md">
        {overview.isError && overview.data === undefined ? (
          <ChartCard
            title="Machines"
            state={{ error: overview.error }}
            onRetry={() => void overview.refetch()}
            retrying={overview.isFetching}
            placeholderHeight={160}
          >
            {null}
          </ChartCard>
        ) : (
          <MachineTable machines={machines} range={range} selected={host} onSelect={setPicked} />
        )}
        {machine === undefined ? null : (
          <Text className={classes.detailHead}>
            {machine.host} · {RANGE_NOUN[range]}
          </Text>
        )}
        {machine === undefined ? null : (
          <SimpleGrid
            type="container"
            cols={{ base: 1, [CQ.regular]: 2, [CQ.wide]: 3 }}
            spacing="md"
            data-shot="detail"
          >
            <TrendChart machine={machine} metric="cpu" />
            <TrendChart machine={machine} metric="memory" />
            <RateChart machine={machine} kind="network" />
            <RateChart machine={machine} kind="disk" />
            <FilesystemsCard machine={machine} />
            <ContainersCard machine={machine} />
          </SimpleGrid>
        )}
      </Stack>
    </>
  )
}
