/**
 * "Your slots": the agw routes grouped by model and effort, each with what the variant scores, costs and
 * takes, its efficiency index, and the leanest alternative on Max and anywhere (billed slots first, they
 * spend money). A route AA has no row for stays in the list with the reason. Selecting a row highlights
 * the lineage on the chart and in the catalog.
 */
import { Stack, Text, Tooltip } from '@mantine/core'
import { Callout } from 'basalt-ui/content'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { modelsStore } from '../../lib/window-stores'
import type { EfficiencyVariant } from './api/types'
import { SLOTS_INFO } from './copy'
import { EM_DASH, fmtIndex, fmtPoints, fmtSeconds, fmtTokens, fmtUsd } from './format'
import type { Option, SlotRow } from './slot-rows'
import { useField } from '../../lib/use-field'

const columnHelper = createColumnHelper<SlotRow>()

const routeLine = (row: SlotRow): string => {
  const n = row.group.routes.length
  return `${n} ${n === 1 ? 'route' : 'routes'} · ${row.billed ? 'billed' : 'Max quota'}`
}

/** The slot's name with the route count and billing under it; the count hovers to the route ids. */
function SlotName({ row }: { row: SlotRow }) {
  const name = row.name
  return (
    <Stack gap={0}>
      <Text
        size="sm"
        fw={500}
        // A name breaks at its spaces; a raw model id has none and stays whole.
        style={name.includes(' ') ? undefined : { whiteSpace: 'nowrap' }}
      >
        {name}
      </Text>
      <Tooltip
        multiline
        w={260}
        withArrow
        label={row.group.routes.map((r) => r.route).join(', ')}
        events={{ hover: true, focus: true, touch: true }}
      >
        <Text size="xs" c="dimmed" tabIndex={0} style={{ width: 'fit-content', cursor: 'help' }}>
          {routeLine(row)}
        </Text>
      </Tooltip>
      {row.variant === null ? (
        <Text size="xs" c="dimmed">
          {row.group.reason ?? 'No Artificial Analysis row'}
        </Text>
      ) : null}
    </Stack>
  )
}

function OptionText({
  option,
  names,
}: {
  option: Option
  names: (v: EfficiencyVariant) => string
}) {
  if (option.kind === 'na')
    return (
      <Text size="sm" c="dimmed">
        {EM_DASH}
      </Text>
    )
  if (option.kind === 'leanest') {
    return (
      <Text size="sm" c="dimmed">
        Already leanest
      </Text>
    )
  }
  return (
    <Stack gap={0}>
      <Text size="sm" fw={500}>
        {names(option.by)}
      </Text>
      <Text size="xs" c="dimmed">
        {fmtPoints(option.points)} · {fmtIndex(option.indexRatio)} index ·{' '}
        {fmtUsd(option.by.costPerTask)} / task · {fmtSeconds(option.by.timePerTaskEstSec)}
      </Text>
    </Stack>
  )
}

const indexText = (row: SlotRow): string => (row.index === null ? EM_DASH : fmtIndex(row.index))

export function SlotsList({
  rows,
  routesError,
  names,
}: {
  rows: readonly SlotRow[]
  routesError: string | null
  names: (v: EfficiencyVariant) => string
}) {
  const [pick, setPick] = useField(modelsStore.field.pick)
  const open = (row: SlotRow) => {
    if (row.variant === null) return
    setPick(row.variant.lineage === pick ? '' : row.variant.lineage)
  }

  const columns = [
    columnHelper.accessor('name', {
      meta: { priority: 0, numeral: false },
      header: 'Slot',
      cell: (ctx) => <SlotName row={ctx.row.original} />,
    }),
    columnHelper.accessor((row) => row.variant?.intelligence ?? null, {
      id: 'intelligence',
      meta: { priority: 3 },
      header: 'Intel.',
      cell: (ctx) => ctx.getValue()?.toFixed(1) ?? EM_DASH,
    }),
    columnHelper.accessor((row) => row.index, {
      id: 'index',
      meta: { priority: 4 },
      header: 'Index',
      cell: (ctx) => {
        const index = ctx.getValue()
        return index === null ? EM_DASH : fmtIndex(index)
      },
    }),
    columnHelper.accessor((row) => row.variant?.costPerTask ?? null, {
      id: 'cost',
      meta: { priority: 5 },
      header: '$ / task',
      cell: (ctx) => fmtUsd(ctx.getValue()),
    }),
    columnHelper.accessor((row) => row.variant?.timePerTaskEstSec ?? null, {
      id: 'time',
      meta: { priority: 6 },
      header: '≈ Time',
      cell: (ctx) => fmtSeconds(ctx.getValue()),
    }),
    columnHelper.accessor((row) => row.variant?.tokensPerTaskEst ?? null, {
      id: 'tokens',
      meta: { priority: 7 },
      header: '≈ Tokens',
      cell: (ctx) => fmtTokens(ctx.getValue()),
    }),
    columnHelper.display({
      id: 'onMax',
      meta: { priority: 1, numeral: false },
      header: 'Leanest on Max',
      cell: (ctx) => <OptionText option={ctx.row.original.onMax} names={names} />,
    }),
    columnHelper.display({
      id: 'anywhere',
      meta: { priority: 2, numeral: false },
      header: 'Leanest anywhere',
      cell: (ctx) => <OptionText option={ctx.row.original.anywhere} names={names} />,
    }),
  ]

  return (
    <Stack gap="xs" data-shot="slots-list" data-shot-states="empty">
      {routesError === null ? null : (
        <Callout kind="warn" title="Routes unavailable">
          {routesError}
        </Callout>
      )}
      <BasaltDataTable
        title="Your slots"
        subtitle="agw routes by model and effort, with the leanest option at equal or better intelligence"
        data={[...rows]}
        columns={columns}
        enableSorting={false}
        getRowId={(row) => row.key}
        highlightOnHover
        verticalSpacing="xs"
        onRowActivate={open}
        emptyState={
          routesError === null ? 'No agw routes use a text model' : 'Routes could not be read'
        }
        renderCard={(row) => (
          <Stack gap={4} onClick={() => open(row)}>
            <SlotName row={row} />
            {row.variant === null ? null : (
              <Text size="xs" c="dimmed">
                Intel. {row.variant.intelligence.toFixed(1)} · {indexText(row)} index ·{' '}
                {fmtUsd(row.variant.costPerTask)} / task ·{' '}
                {fmtSeconds(row.variant.timePerTaskEstSec)} ·{' '}
                {fmtTokens(row.variant.tokensPerTaskEst)} tokens
              </Text>
            )}
            <Stack gap={2}>
              <Text size="xs" c="dimmed">
                Leanest on Max
              </Text>
              <OptionText option={row.onMax} names={names} />
              <Text size="xs" c="dimmed">
                Leanest anywhere
              </Text>
              <OptionText option={row.anywhere} names={names} />
            </Stack>
          </Stack>
        )}
      />
      <Text size="xs" c="dimmed">
        {SLOTS_INFO}
      </Text>
    </Stack>
  )
}
