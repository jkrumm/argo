import { useQuery } from '@tanstack/react-query'
import { Box, Group, Text } from '@mantine/core'
import { ChartCard, Sparkline } from 'basalt-ui/charts'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { METRIC_TOOLTIPS } from '../constants'
import { directionArrow, directionColor, inolZoneLabel, type StrengthDirection } from '../formulas'
import { NBSP, withUnit } from '../../../lib/format'
import { DELTA_DAYS, fmtWeeklyTonnes, liftDelta, perMonth, signed } from '../model'
import { useNow } from '../../../lib/use-now'

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
  /** No scored session in the trend window (the API's velocity is then an old window's); null until the record loads. */
  stale: boolean | null
}

/**
 * The latest figure with its unit, then its recent shape. A lift with no history in the window
 * gets a dash. Single-series sparklines carry no separation, so they stay neutral; colour lives
 * only in the trend cell.
 */
function FigureSpark({
  data,
  mark,
  ariaLabel,
  figure,
  format,
}: {
  data: readonly number[]
  mark: 'line' | 'bar'
  ariaLabel: string
  figure: (latest: number) => string
  format: (value: number) => string
}) {
  const latest = data.at(-1)
  if (latest === undefined) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    )
  }
  return (
    <Group gap="xs" wrap="nowrap">
      <Sparkline
        ariaLabel={ariaLabel}
        data={data}
        mark={mark}
        width={SPARK_W}
        height={SPARK_H}
        color={VX.line}
        format={format}
        emphasizeLast
      />
      <Text size="sm">{figure(latest)}</Text>
    </Group>
  )
}

const inolFigure = (v: number) => `${v.toFixed(2)}${NBSP}${inolZoneLabel(v)}`

/** The page's one velocity wording: `+1.2 %/mo`, a dash when the lift has no fit. */
function velocityFigure(vel: number | null): string {
  const monthly = perMonth(vel)
  return monthly === null ? '—' : `${signed(monthly)}${NBSP}%/mo`
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
    header: `Trend, ${withUnit(DELTA_DAYS, 'd')}`,
    enableSorting: false,
    meta: { priority: 1 },
    cell: (ctx) => {
      const { dir, vel, stale } = ctx.row.original
      if (stale === null) {
        return (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )
      }
      if (stale) {
        return (
          <Text size="xs" c="dimmed">
            no session in {withUnit(DELTA_DAYS, 'd')}
          </Text>
        )
      }
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
    header: 'Volume, last 10 training weeks',
    enableSorting: false,
    meta: { priority: 2 },
    cell: (ctx) => (
      <FigureSpark
        data={ctx.row.original.volume}
        mark="bar"
        figure={fmtWeeklyTonnes}
        format={fmtWeeklyTonnes}
        ariaLabel={`${ctx.row.original.exercise_name} weekly volume in tonnes, last 10 training weeks`}
      />
    ),
  }),
  columnHelper.display({
    id: 'inol',
    header: 'INOL, last 15 sessions',
    enableSorting: false,
    meta: { priority: 3 },
    cell: (ctx) => (
      <FigureSpark
        data={ctx.row.original.inol}
        mark="line"
        figure={inolFigure}
        format={(v) => v.toFixed(2)}
        ariaLabel={`${ctx.row.original.exercise_name} INOL per session, last 15 sessions`}
      />
    ),
  }),
]

export default function SparklineGridChart({ params }: { params: StrengthQueryParams }) {
  const query = useQuery(strengthQueries.sparklines(params))
  // The trend's freshness reads the full record, as the strip's 28 d delta does.
  const series = useQuery(
    strengthQueries.seriesDetailed({ window: 'all', exercises: params.exercises }),
  )
  const now = useNow()

  const rows: SparkRow[] = (query.data?.byExercise ?? []).map((r) => {
    const points = series.data?.byExercise.find((l) => l.exercise_id === r.exercise_id)?.points
    return {
      ...(r as Omit<SparkRow, 'stale'>),
      stale: points === undefined ? null : liftDelta(points, now).stale,
    }
  })
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
