import { useQuery } from '@tanstack/react-query'
import { Box, Group, Text } from '@mantine/core'
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

/** The page's one velocity wording: `+1.2 %/mo`, a dash when the lift has no fit. */
function velocityFigure(vel: number | null): string {
  const monthly = perMonth(vel)
  return monthly === null ? '—' : `${signed(monthly)} %/mo`
}

const columnHelper = createColumnHelper<SparkRow>()

// The e1RM trend is the lift strip's (one fact, one form); this table answers "is each lift's load
// right": its direction, then the volume and INOL behind it. `meta.priority`: the HIGHEST number
// folds first into `BasaltDataTable`'s row detail, which labels each folded value with its column
// header, so every header is a plain string carrying its unit and scope.
const columns = [
  columnHelper.accessor('exercise_name', {
    header: 'Exercise',
    meta: { priority: 0 },
    cell: (ctx) => (
      <Text size="sm" fw={600} truncate="end" title={ctx.getValue()}>
        {ctx.getValue()}
      </Text>
    ),
  }),
  columnHelper.display({
    id: 'trend',
    header: '28 d trend, %/mo',
    enableSorting: false,
    meta: { priority: 1 },
    cell: (ctx) => {
      const { dir, vel } = ctx.row.original
      return (
        <Box>
          <Group gap={4} wrap="nowrap">
            <Text size="sm" fw={700} c={directionColor(dir)}>
              {directionArrow(dir)}
            </Text>
            <Text size="sm" c={directionColor(dir)}>
              {velocityFigure(vel)}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            {dir}
          </Text>
        </Box>
      )
    },
  }),
  columnHelper.display({
    id: 'volume',
    header: 'Volume, kg/wk · 10 wk',
    enableSorting: false,
    meta: { priority: 2 },
    cell: (ctx) => (
      <SparkCell
        data={ctx.row.original.volume}
        mark="bar"
        ariaLabel={`${ctx.row.original.exercise_name} weekly volume in kg, last 10 weeks`}
      />
    ),
  }),
  columnHelper.display({
    id: 'inol',
    header: 'INOL · 15 sessions',
    enableSorting: false,
    meta: { priority: 3 },
    cell: (ctx) => (
      <SparkCell
        data={ctx.row.original.inol}
        mark="line"
        ariaLabel={`${ctx.row.original.exercise_name} INOL per session, last 15 sessions`}
      />
    ),
  }),
]

export default function SparklineGridChart({ params }: { params: StrengthQueryParams }) {
  const query = useQuery(strengthQueries.sparklines(params))

  const rows = (query.data?.byExercise ?? []) as SparkRow[]
  const hasData = rows.some((r) => r.e1rm.length > 0 || r.volume.length > 0 || r.inol.length > 0)

  return (
    <ChartCard
      title="Per-lift trend and load"
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
