import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Table, Text, Tooltip } from '@mantine/core'
import { BarSparkline, ChartCard, LineSparkline, VX } from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { METRIC_TOOLTIPS } from '../constants'
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

// Single-series sparklines carry no separation — neutral. Color lives only in the
// direction arrow / status dot (trend signal).
function rowColor(): string {
  return VX.line
}

export default function SparklineGridChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.sparklines(params))

  const rows = data.byExercise as SparkRow[]

  const hasData = rows.some((r) => r.e1rm.length > 0 || r.volume.length > 0 || r.inol.length > 0)

  return (
    <ChartCard
      title="Strength Scan"
      subtitle="All lifts at a glance"
      info={METRIC_TOOLTIPS.strengthScan}
    >
      {!hasData ? (
        <ChartEmpty height={180} message="No data — start logging workouts." />
      ) : (
        <Table verticalSpacing="xs" horizontalSpacing="sm" striped="even">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Exercise</Table.Th>
              <Table.Th>
                <Tooltip label="1RM (last 20 sessions)" withArrow position="top">
                  <span style={{ cursor: 'help' }}>1RM</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Volume (last 10 weeks)" withArrow position="top">
                  <span style={{ cursor: 'help' }}>Volume</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="INOL (last 15 sessions)" withArrow position="top">
                  <span style={{ cursor: 'help' }}>INOL</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Momentum (28d velocity %/day)" withArrow position="top">
                  <span style={{ cursor: 'help' }}>Momentum</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const color = rowColor()
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
                    <LineSparkline
                      ariaLabel={`${row.exercise_name} 1RM trend, last 20 sessions`}
                      data={row.e1rm}
                      width={SPARK_W}
                      height={SPARK_H}
                      color={color}
                    />
                  </Table.Td>
                  <Table.Td>
                    <BarSparkline
                      ariaLabel={`${row.exercise_name} volume trend, last 10 weeks`}
                      data={row.volume}
                      width={SPARK_W}
                      height={SPARK_H}
                      color={color}
                    />
                  </Table.Td>
                  <Table.Td>
                    <LineSparkline
                      ariaLabel={`${row.exercise_name} INOL trend, last 15 sessions`}
                      data={row.inol}
                      width={SPARK_W}
                      height={SPARK_H}
                      color={color}
                    />
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
                    <Box display="inline-block" w={10} h={10} bdrs="xl" bg={dirColor} />
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
