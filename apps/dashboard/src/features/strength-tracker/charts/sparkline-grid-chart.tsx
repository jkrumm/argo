import { useQuery } from '@tanstack/react-query'
import { Box, Group, Text, Tooltip } from '@mantine/core'
import { ChartCard, Sparkline } from 'basalt-ui/charts'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { METRIC_TOOLTIPS } from '../constants'
import { directionArrow, directionColor, type StrengthDirection } from '../formulas'
import { perMonth, signed } from '../model'

const SPARK_W = 80
const SPARK_H = 28

type SparkRow = {
  exercise_id: string
  exercise_name: string
  e1rm: number[]
  volume: number[]
  inol: number[]
  vel: number | null
  dir: StrengthDirection
}

/** A sparkline needs a trend to draw; a lift with no history in the window gets a dash. */
function SparkCell({
  data,
  mark,
  ariaLabel,
}: {
  data: readonly number[]
  mark: 'line' | 'bar'
  ariaLabel: string
}) {
  if (data.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    )
  }
  // Single-series sparklines carry no separation — neutral. Color lives only in the direction
  // arrow / status dot (trend signal).
  return (
    <Sparkline
      ariaLabel={ariaLabel}
      data={data}
      mark={mark}
      width={SPARK_W}
      height={SPARK_H}
      color={VX.line}
    />
  )
}

const MOMENTUM_COL = 'momentum'

/** The page's one velocity wording: `+1.2 %/mo`, a dash when the lift has no fit. */
function velocityFigure(vel: number | null): string {
  const monthly = perMonth(vel)
  return monthly === null ? '—' : `${signed(monthly)} %/mo`
}

const columnHelper = createColumnHelper<SparkRow>()

function HelpHeader({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip label={tip} withArrow position="top">
      <span style={{ cursor: 'help' }}>{label}</span>
    </Tooltip>
  )
}

// `meta.priority`: the HIGHEST number folds first when the card is too narrow. Fold order (the
// list numbers are the order, not the priority values): 1. INOL, 2. Volume, 3. Velocity (its figure then
// moves under the Status word), 4. Status. Exercise and 1RM stay.
// Folded columns remain one tap away in the per-row disclosure.
const columns = [
  columnHelper.accessor('exercise_name', {
    header: 'Exercise',
    meta: { priority: 0 },
    cell: (ctx) => (
      <Text size="sm" fw={600} c={VX.line} truncate="end" title={ctx.getValue()}>
        {ctx.getValue()}
      </Text>
    ),
  }),
  columnHelper.display({
    id: 'e1rm',
    header: () => <HelpHeader label="e1RM, kg" tip="Estimated 1RM, last 20 sessions" />,
    enableSorting: false,
    meta: { priority: 1 },
    cell: (ctx) => (
      <SparkCell
        data={ctx.row.original.e1rm}
        mark="line"
        ariaLabel={`${ctx.row.original.exercise_name} 1RM trend, last 20 sessions`}
      />
    ),
  }),
  columnHelper.display({
    id: 'volume',
    header: () => <HelpHeader label="Volume, kg/wk" tip="Weekly volume, last 10 weeks" />,
    enableSorting: false,
    meta: { priority: 4 },
    cell: (ctx) => (
      <SparkCell
        data={ctx.row.original.volume}
        mark="bar"
        ariaLabel={`${ctx.row.original.exercise_name} volume trend, last 10 weeks`}
      />
    ),
  }),
  columnHelper.display({
    id: 'inol',
    header: () => <HelpHeader label="INOL / session" tip="INOL, last 15 sessions" />,
    enableSorting: false,
    meta: { priority: 5 },
    cell: (ctx) => (
      <SparkCell
        data={ctx.row.original.inol}
        mark="line"
        ariaLabel={`${ctx.row.original.exercise_name} INOL trend, last 15 sessions`}
      />
    ),
  }),
  columnHelper.display({
    id: MOMENTUM_COL,
    header: () => (
      <HelpHeader label="Velocity, %/mo" tip="e1RM velocity over 28 days, as a monthly rate" />
    ),
    enableSorting: false,
    meta: { priority: 3 },
    cell: (ctx) => {
      const { dir, vel } = ctx.row.original
      return (
        <Text size="sm" c={directionColor(dir)}>
          <Text component="span" fw={700}>
            {directionArrow(dir)}
          </Text>
          <Text component="span" ml={4}>
            {velocityFigure(vel)}
          </Text>
        </Text>
      )
    },
  }),
  columnHelper.display({
    id: 'status',
    header: 'Status',
    enableSorting: false,
    meta: { priority: 2 },
    cell: (ctx) => {
      const { dir, vel } = ctx.row.original
      // Velocity folds before Status; once it has (or is absent), its figure moves in under the
      // status word, so the narrow scan keeps both and the wide one prints it once.
      const velocityFolded = ctx.table.getColumn(MOMENTUM_COL)?.getIsVisible() !== true
      return (
        <Box>
          <Group gap={6} wrap="nowrap">
            <Box display="inline-block" w={10} h={10} bdrs="xl" bg={directionColor(dir)} />
            <Text size="sm">{dir}</Text>
          </Group>
          {velocityFolded && (
            <Text size="xs" c={directionColor(dir)} ml="md" truncate="end">
              {velocityFigure(vel)}
            </Text>
          )}
        </Box>
      )
    },
  }),
]

export default function SparklineGridChart({ params }: { params: StrengthQueryParams }) {
  const query = useQuery(strengthQueries.sparklines(params))

  const rows = (query.data?.byExercise ?? []) as SparkRow[]
  const hasData = rows.some((r) => r.e1rm.length > 0 || r.volume.length > 0 || r.inol.length > 0)

  return (
    <ChartCard
      title="Strength scan"
      info={METRIC_TOOLTIPS.strengthScan}
      state={chartStateOf(query, !hasData ? 'No data — start logging workouts.' : undefined)}
      placeholderHeight={180}
    >
      <BasaltDataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.exercise_id}
        enableSorting={false}
        striped="even"
        verticalSpacing="xs"
        horizontalSpacing="sm"
      />
    </ChartCard>
  )
}
