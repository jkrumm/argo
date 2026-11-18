import { Box, Group, Progress, Stack, Text } from '@mantine/core'
import { Sparkline } from 'basalt-ui/charts'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import type { Machine, MachineRange } from '../../lib/queries/machines'
import { useNow } from '../../lib/use-now'
import classes from './machines.module.css'
import {
  LIMITS,
  RANGE_NOUN,
  formatLoad,
  formatPct,
  formatRate,
  loadPerCore,
  statusLine,
  toneOf,
  type Tone,
} from './model'

const columnHelper = createColumnHelper<Machine>()

const SPARK_WIDTH = 96
const SPARK_HEIGHT = 28

const toneColor = (tone: Tone | undefined): string =>
  tone === 'bad' ? VX.status.bad : tone === 'warn' ? VX.status.warn : VX.line

const DASH = '—'

/** A value in its unit, coloured only when it needs the eye. */
function Value({ text, unit, tone }: { text: string; unit?: string; tone?: Tone | undefined }) {
  return (
    <Text size="md" fw={500} span {...(tone && { c: toneColor(tone) })}>
      {text}
      {unit ? (
        <Text size="xs" c="dimmed" span>
          {' '}
          {unit}
        </Text>
      ) : null}
    </Text>
  )
}

/** A percentage with its sparkline of the range, every row on the same 0 to 100 scale. */
function PercentCell({
  machine,
  value,
  tone,
  series,
  label,
}: {
  machine: Machine
  value: number | null
  tone: Tone | undefined
  series: (number | null)[]
  label: string
}) {
  if (machine.state === 'silent') return <Text c="dimmed">{DASH}</Text>
  const data = series.filter((v): v is number => v !== null)
  return (
    <Group gap="sm" wrap="nowrap">
      <Value text={formatPct(value)} unit="%" tone={tone} />
      {data.length > 1 ? (
        <Sparkline
          ariaLabel={`${machine.host} ${label}, percent`}
          data={data}
          width={SPARK_WIDTH}
          height={SPARK_HEIGHT}
          band={{ from: 0, to: 100 }}
          emphasizeLast={false}
          color={VX.line}
          format={(v) => `${v.toFixed(0)} %`}
          window={false}
        />
      ) : null}
    </Group>
  )
}

function FillBar({ value, max, tone }: { value: number; max: number; tone: Tone | undefined }) {
  return (
    <Progress
      value={Math.min(100, (100 * value) / max)}
      size="sm"
      w={SPARK_WIDTH}
      color={toneColor(tone)}
      aria-hidden
    />
  )
}

function NameCell({
  machine,
  selected,
  range,
}: {
  machine: Machine
  selected: boolean
  range: MachineRange
}) {
  const now = useNow(30_000)
  const silent = machine.state === 'silent'
  return (
    <Stack gap={0} data-selected={selected}>
      <Group gap="xs" wrap="nowrap">
        <Text span c={silent ? VX.status.bad : VX.line} aria-hidden>
          ●
        </Text>
        <Text fw={selected ? 700 : 500} span>
          {machine.host}
        </Text>
      </Group>
      <Text size="xs" c={silent ? VX.status.bad : 'dimmed'} title={RANGE_NOUN[range]}>
        {statusLine(machine, range, now)}
      </Text>
    </Stack>
  )
}

/**
 * One row per machine that reported in the last 24 hours: status, CPU, memory, the fullest filesystem,
 * load and network as a current value with the range beside it. Percentages share one 0 to 100 scale so
 * rows compare. Colour only where a value needs the eye; a silent machine shows dashes, never zero.
 * A click selects the machine whose charts show below (`machinesStore.host`).
 */
export function MachineTable({
  machines,
  range,
  selected,
  onSelect,
}: {
  machines: readonly Machine[]
  range: MachineRange
  selected: string | undefined
  onSelect: (host: string) => void
}) {
  const columns = [
    columnHelper.accessor('host', {
      id: 'machine',
      header: 'Machine',
      enableSorting: false,
      meta: { priority: 0, numeral: false },
      cell: (ctx) => (
        <NameCell
          machine={ctx.row.original}
          selected={ctx.row.original.host === selected}
          range={range}
        />
      ),
    }),
    columnHelper.display({
      id: 'cpu',
      header: `CPU · ${range}`,
      meta: { priority: 1, numeral: false },
      cell: (ctx) => {
        const m = ctx.row.original
        return (
          <PercentCell
            machine={m}
            value={m.cpuPct}
            tone={toneOf(m.cpuPct, LIMITS.cpu)}
            series={m.points.map((p) => p.cpuPct)}
            label="CPU"
          />
        )
      },
    }),
    columnHelper.display({
      id: 'memory',
      header: `Memory · ${range}`,
      meta: { priority: 2, numeral: false },
      cell: (ctx) => {
        const m = ctx.row.original
        return (
          <PercentCell
            machine={m}
            value={m.memPct}
            tone={toneOf(m.memPct, LIMITS.memory)}
            series={m.points.map((p) => p.memPct)}
            label="memory used"
          />
        )
      },
    }),
    columnHelper.display({
      id: 'disk',
      header: 'Fullest disk',
      meta: { priority: 3, numeral: false },
      cell: (ctx) => {
        const m = ctx.row.original
        const fs = m.fullestFilesystem
        if (m.state === 'silent' || fs === null) return <Text c="dimmed">{DASH}</Text>
        const tone = toneOf(fs.pct, LIMITS.disk)
        return (
          <Stack gap={2}>
            <Group gap="sm" wrap="nowrap">
              <Value text={formatPct(fs.pct)} unit="%" tone={tone} />
              <FillBar value={fs.pct} max={100} tone={tone} />
            </Group>
            <Text size="xs" c={tone ? toneColor(tone) : 'dimmed'}>
              {fs.mount}
            </Text>
          </Stack>
        )
      },
    }),
    columnHelper.display({
      id: 'load',
      header: 'Load · 1 min',
      meta: { priority: 4, numeral: false },
      cell: (ctx) => {
        const m = ctx.row.original
        const perCore = loadPerCore(m.load1, m.cores)
        if (m.state === 'silent' || perCore === null) return <Text c="dimmed">{DASH}</Text>
        const tone = toneOf(perCore, LIMITS.load)
        return (
          <Stack gap={2}>
            <Group gap="sm" wrap="nowrap">
              <Value text={formatLoad(m.load1)} tone={tone} />
              <FillBar value={perCore} max={2} tone={tone} />
            </Group>
            <Text size="xs" c="dimmed">
              {m.cores} cores
            </Text>
          </Stack>
        )
      },
    }),
    columnHelper.display({
      id: 'network',
      header: `Network · ${range}`,
      meta: { priority: 5, numeral: false },
      cell: (ctx) => {
        const m = ctx.row.original
        if (m.state === 'silent') return <Text c="dimmed">{DASH}</Text>
        const total = m.points.map((p) =>
          p.netInBps === null && p.netOutBps === null
            ? null
            : (p.netInBps ?? 0) + (p.netOutBps ?? 0),
        )
        const data = total.filter((v): v is number => v !== null)
        return (
          <Group gap="sm" wrap="nowrap">
            <Stack gap={0}>
              <Text size="xs" span>
                ↓ {formatRate(m.netInBps)}
              </Text>
              <Text size="xs" c="dimmed" span>
                ↑ {formatRate(m.netOutBps)}
              </Text>
            </Stack>
            {data.length > 1 ? (
              <Sparkline
                ariaLabel={`${m.host} network in plus out, bytes per second`}
                data={data}
                width={SPARK_WIDTH}
                height={SPARK_HEIGHT}
                emphasizeLast={false}
                color={VX.line}
                format={formatRate}
                window={false}
              />
            ) : null}
          </Group>
        )
      },
    }),
  ]

  return (
    <Box className={classes.table}>
      <BasaltDataTable
        data={[...machines]}
        columns={columns}
        getRowId={(m) => m.host}
        highlightOnHover
        verticalSpacing="xs"
        onRowActivate={(m) => onSelect(m.host)}
        emptyState="No machine has reported in the last 24 hours"
      />
    </Box>
  )
}
