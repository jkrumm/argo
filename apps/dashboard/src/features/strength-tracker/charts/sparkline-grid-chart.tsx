import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Table, Text } from '@mantine/core'
import { BarSparkline, ChartCard, LineSparkline } from '@argo/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { EXERCISE_COLORS, type ExerciseKey } from '../constants'
import { directionArrow, directionColor, type StrengthDirection } from '../formulas'
import { ChartEmpty } from './empty'

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

function colorFor(exId: string): string {
  return EXERCISE_COLORS[exId as ExerciseKey] ?? '#888'
}

export default function SparklineGridChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.sparklines(params))

  const rows = data.byExercise as SparkRow[]

  const hasData = rows.some((r) => r.e1rm.length > 0 || r.volume.length > 0 || r.inol.length > 0)

  return (
    <ChartCard
      title="Strength Scan"
      subtitle="All lifts at a glance"
      tooltip="One row per lift: 1RM trend, weekly volume, INOL quality, momentum (28d velocity), and a status indicator."
    >
      {!hasData ? (
        <ChartEmpty height={180} message="No data — start logging workouts." />
      ) : (
        <Table verticalSpacing="xs" horizontalSpacing="sm" striped="even">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Exercise</Table.Th>
              <Table.Th>1RM</Table.Th>
              <Table.Th>Volume</Table.Th>
              <Table.Th>INOL</Table.Th>
              <Table.Th>Momentum</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const color = colorFor(row.exercise_id)
              const dirColor = directionColor(row.dir)
              const arrow = directionArrow(row.dir)
              return (
                <Table.Tr key={row.exercise_id}>
                  <Table.Td>
                    <Text size="sm" fw={600} c={color}>
                      {row.exercise_name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <LineSparkline data={row.e1rm} width={SPARK_W} height={SPARK_H} color={color} />
                  </Table.Td>
                  <Table.Td>
                    <BarSparkline
                      data={row.volume}
                      width={SPARK_W}
                      height={SPARK_H}
                      color={color}
                    />
                  </Table.Td>
                  <Table.Td>
                    <LineSparkline data={row.inol} width={SPARK_W} height={SPARK_H} color={color} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={dirColor}>
                      <Text component="span" fw={700}>
                        {arrow}
                      </Text>
                      {row.vel !== null && (
                        <Text component="span" ml={4}>
                          {row.vel >= 0 ? '+' : ''}
                          {row.vel.toFixed(2)}%/d
                        </Text>
                      )}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Box
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        backgroundColor: dirColor,
                      }}
                    />
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      )}
    </ChartCard>
  )
}
