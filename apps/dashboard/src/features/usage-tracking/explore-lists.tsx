/**
 * The Explore tab's Projects and Tools rows over the selected payers: one `/usage/split` call each,
 * side by side, each row with its inline timeline (the shared `SplitList`).
 */
import { useSuspenseQueries } from '@tanstack/react-query'
import { Grid } from '@mantine/core'
import { CONTAINER_GRID_BREAKPOINTS } from 'basalt-ui/tokens'
import { usageQueries, type Range } from '../../lib/queries/usage'
import type { UsageLens } from '../../lib/window-stores'
import type { PayerValue } from './accounts'
import { SplitList } from './split-lists'
import { SPLIT_TOP } from './split-model'
import type { WorkspaceValue } from './types'

export function ExploreLists({
  payers,
  range,
  lens,
  workspace,
}: {
  payers: PayerValue[]
  range: Range
  lens: UsageLens
  workspace: WorkspaceValue[] | undefined
}) {
  const [projects, tools] = useSuspenseQueries({
    queries: [
      usageQueries.split({ by: 'project', range, lens, payer: payers, workspace, top: SPLIT_TOP }),
      usageQueries.split({ by: 'sub_tool', range, lens, payer: payers, workspace, top: SPLIT_TOP }),
    ],
  })
  return (
    <Grid type="container" breakpoints={CONTAINER_GRID_BREAKPOINTS}>
      {(
        [
          ['project', projects.data.rows],
          ['tool', tools.data.rows],
        ] as const
      ).map(([dimension, rows]) => (
        <Grid.Col key={dimension} span={{ base: 12, lg: 6 }}>
          <SplitList
            dimension={dimension}
            rows={rows}
            lens={lens}
            range={range}
            workspace={workspace}
            payers={payers}
          />
        </Grid.Col>
      ))}
    </Grid>
  )
}
