import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core'
import { ChartCard, VX } from 'basalt-ui/charts'
import { strengthQueries, type StrengthQueryParams } from '../../../lib/queries/strength'
import { METRIC_TOOLTIPS } from '../constants'
import { ChartEmpty } from './empty'

type VerdictType = 'good' | 'warn' | 'bad'
type RecoveryRow = 'high' | 'normal' | 'low'
type AcwrCol = 'under' | 'optimal' | 'caution'

type AlignmentCell = {
  recoveryRow: RecoveryRow
  acwrCol: AcwrCol
  verdict: string
  verdictType: VerdictType
  dates: string[]
  count: number
  isToday: boolean
}

const ROW_LABELS: Record<RecoveryRow, string> = {
  high: 'High recovery',
  normal: 'Normal',
  low: 'Low',
}

const COL_LABELS: Record<AcwrCol, string> = {
  under: 'Under',
  optimal: 'Optimal',
  caution: 'Caution',
}

const ROW_ORDER: RecoveryRow[] = ['high', 'normal', 'low']
const COL_ORDER: AcwrCol[] = ['under', 'optimal', 'caution']

function verdictColor(type: VerdictType): string {
  if (type === 'good') return VX.goodSolid
  if (type === 'warn') return VX.warnSolid
  return VX.badSolid
}

function cellBg(type: VerdictType): string {
  if (type === 'good') return VX.goodSoft
  if (type === 'warn') return VX.warn
  return VX.bad
}

export default function AlignmentMatrixChart({ params }: { params: StrengthQueryParams }) {
  const { data } = useSuspenseQuery(strengthQueries.alignment({ exercises: params.exercises }))

  const grid = data.grid as AlignmentCell[][]
  const flat = grid.flat()
  const totalCount = flat.reduce((acc, c) => acc + c.count, 0)
  const todayCell = flat.find((c) => c.isToday) ?? null

  const headerExtra =
    todayCell !== null ? (
      <Text size="xs" fw={600} c={verdictColor(todayCell.verdictType)}>
        Today: {todayCell.verdict}
      </Text>
    ) : null

  if (totalCount === 0) {
    return (
      <ChartCard
        title="Training × Recovery Alignment"
        subtitle="Where do my sessions land?"
        tooltip={METRIC_TOOLTIPS.trainingRecoveryAlignment}
        extra={headerExtra}
      >
        <ChartEmpty height={200} message="No sessions to chart" />
      </ChartCard>
    )
  }

  // Order grid rows + columns by ROW_ORDER / COL_ORDER from the cell metadata
  // (rather than trusting array index).
  const byRow = new Map<RecoveryRow, Map<AcwrCol, AlignmentCell>>()
  for (const cell of flat) {
    const row = byRow.get(cell.recoveryRow) ?? new Map<AcwrCol, AlignmentCell>()
    row.set(cell.acwrCol, cell)
    byRow.set(cell.recoveryRow, row)
  }

  return (
    <ChartCard
      title="Training × Recovery Alignment"
      subtitle="Where do my sessions land?"
      tooltip={METRIC_TOOLTIPS.trainingRecoveryAlignment}
      extra={headerExtra}
    >
      <Stack gap="xs" p="md">
        {/* Column headers */}
        <SimpleGrid cols={4} spacing="xs" verticalSpacing={4}>
          <div />
          {COL_ORDER.map((col) => (
            <Text key={col} size="xs" c="dimmed" ta="center">
              {COL_LABELS[col]}
            </Text>
          ))}
        </SimpleGrid>

        {ROW_ORDER.map((row) => (
          <SimpleGrid key={row} cols={4} spacing="xs" verticalSpacing={4}>
            <Text size="xs" c="dimmed" style={{ alignSelf: 'center' }}>
              {ROW_LABELS[row]}
            </Text>
            {COL_ORDER.map((col) => {
              const cell = byRow.get(row)?.get(col)
              if (!cell) {
                return <Box key={col} />
              }
              const color = verdictColor(cell.verdictType)
              const bg = cellBg(cell.verdictType)
              const tooltipLabel =
                cell.dates.length > 0
                  ? cell.dates.slice().sort().reverse().slice(0, 8).join(', ')
                  : 'No sessions'

              return (
                <Tooltip key={col} label={tooltipLabel} withArrow position="top">
                  <Box
                    style={{
                      position: 'relative',
                      background: bg,
                      border: cell.isToday ? `2px solid ${color}` : '2px solid transparent',
                      textAlign: 'center',
                      minHeight: 56,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'column',
                    }}
                    display="flex"
                    py="sm"
                    px={6}
                    bdrs={6}
                  >
                    <Text size="xs" fw={600} c={color} lh={1.2}>
                      {cell.verdict}
                    </Text>
                    {cell.count > 0 && (
                      <Box
                        style={{
                          position: 'absolute',
                          top: 4,
                          right: 6,
                          fontSize: VX.text.micro,
                          fontWeight: 600,
                          opacity: 0.7,
                        }}
                      >
                        {cell.isToday ? 'today' : `${cell.count}×`}
                      </Box>
                    )}
                  </Box>
                </Tooltip>
              )
            })}
          </SimpleGrid>
        ))}
      </Stack>
    </ChartCard>
  )
}
