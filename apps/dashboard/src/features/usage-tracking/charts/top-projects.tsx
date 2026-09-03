import { useSuspenseQuery } from '@tanstack/react-query'
import { Text } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/data/table'
import { usageQueries, type Range } from '../../../lib/queries/usage'
import type { BillingValue, WorkspaceValue } from '../types'
import { fmtPct, fmtUsd } from '../constants'

type ProjectRow = { key: string; value: number; share: number }

const columnHelper = createColumnHelper<ProjectRow>()

// `align` on the column def rather than `textAlign` on the `th` AND the `td`: the header and the
// cells cannot drift apart, and a typo'd key is a tsc error instead of a money column that quietly
// left-aligns. `value` and `share` keep the automatic mono numerals — both are plain figures, which
// is exactly what that style is for.
const columns = [
  columnHelper.accessor('key', {
    header: 'Project',
    cell: (ctx) => <Text size="sm">{ctx.getValue()}</Text>,
  }),
  columnHelper.accessor('value', {
    header: 'Cost',
    meta: { align: 'right' },
    cell: (ctx) => fmtUsd(ctx.getValue()),
  }),
  columnHelper.accessor('share', {
    header: 'Share',
    meta: { align: 'right' },
    cell: (ctx) => (
      <Text size="sm" c="dimmed">
        {fmtPct(ctx.getValue())}
      </Text>
    ),
  }),
]

export default function TopProjects({
  range,
  billing,
  workspace,
}: {
  range: Range
  billing?: BillingValue[] | undefined
  workspace?: WorkspaceValue[] | undefined
}) {
  const { data } = useSuspenseQuery(
    usageQueries.breakdown({
      range,
      metric: 'cost',
      dimension: 'project',
      limit: 10,
      billing,
      workspace,
    }),
  )

  return (
    // The table's own `WidgetHeader` carries the title and the window total (`subtitle`) — the
    // `Card` + `Group` wrapper that used to draw them is gone.
    <BasaltDataTable
      title="Top projects (cost)"
      subtitle={`Total ${fmtUsd(data.total)}`}
      data={data.rows}
      columns={columns}
      striped
      highlightOnHover
      withRowBorders={false}
      verticalSpacing="xs"
      emptyState={
        <Text size="sm" c="dimmed">
          No data in this window.
        </Text>
      }
    />
  )
}
