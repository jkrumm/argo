/**
 * "Your slots": the agw routes grouped by model and effort, each with what the variant scores, costs and
 * takes, and the verdict on it. A route AA has no row for stays in the list with the reason. Selecting
 * a row highlights the lineage on the charts and in the catalog.
 */
import { Badge, Box, Group, Stack, Text } from '@mantine/core'
import { Callout } from 'basalt-ui/content'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import { modelsStore } from '../../lib/window-stores'
import type { EfficiencyVariant } from './api/types'
import { QUOTA_NOTE, SLOTS_INFO } from './copy'
import { EM_DASH, fmtPoints, fmtRatio, fmtSeconds, fmtUsd } from './format'
import type { SlotRow } from './slot-rows'

const columnHelper = createColumnHelper<SlotRow>()

function VerdictText({ row, names }: { row: SlotRow; names: (v: EfficiencyVariant) => string }) {
  const { verdict, group } = row
  const quota = group.access !== 'metered'
  if (verdict === null) {
    return (
      <Text size="sm" c="dimmed">
        {group.reason ?? 'No Artificial Analysis row'}
      </Text>
    )
  }
  const text =
    verdict.kind === 'frontier'
      ? 'Frontier'
      : verdict.kind === 'near'
        ? 'Near the frontier'
        : verdict.kind === 'unscored'
          ? 'No cost measured'
          : `Beaten by ${names(verdict.by)}`
  return (
    <Stack gap={2}>
      <Group gap="xs" wrap="wrap">
        <Text size="sm" fw={500} {...(verdict.kind === 'beaten' ? { c: VX.status.warn } : {})}>
          {text}
        </Text>
        {verdict.kind === 'beaten' ? (
          <Text size="xs" c="dimmed">
            {fmtPoints(verdict.points)}, {fmtRatio(verdict.costRatio)} $
          </Text>
        ) : null}
      </Group>
      {quota ? (
        <Text size="xs" c="dimmed">
          {QUOTA_NOTE}
        </Text>
      ) : null}
    </Stack>
  )
}

const routeCount = (row: SlotRow): string =>
  row.group.routes.length === 1 ? '1 route' : `${row.group.routes.length} routes`

export function SlotsList({
  rows,
  routesError,
  names,
}: {
  rows: readonly SlotRow[]
  routesError: string | null
  names: (v: EfficiencyVariant) => string
}) {
  const [, setPick] = modelsStore.field.pick.use()
  const open = (row: SlotRow) => {
    if (row.variant !== null) setPick(row.variant.lineage)
  }

  const columns = [
    columnHelper.accessor('name', {
      meta: { priority: 0, numeral: false },
      header: 'Model',
      cell: (ctx) => (
        <Stack gap={0}>
          <Text
            size="sm"
            fw={500}
            // A name breaks at its spaces; a raw model id has none and stays whole.
            style={ctx.getValue().includes(' ') ? undefined : { whiteSpace: 'nowrap' }}
          >
            {ctx.getValue()}
          </Text>
          <Text size="xs" c="dimmed">
            {ctx.row.original.group.access === 'metered'
              ? 'billed'
              : ctx.row.original.group.access === 'subscription'
                ? 'on quota'
                : 'billed and on quota'}
          </Text>
        </Stack>
      ),
    }),
    columnHelper.accessor((row) => row.group.routes.length, {
      id: 'routes',
      meta: { priority: 1, numeral: true },
      header: 'Routes',
    }),
    columnHelper.accessor((row) => row.variant?.intelligence ?? null, {
      id: 'intelligence',
      meta: { priority: 2 },
      header: 'Intel.',
      cell: (ctx) => ctx.getValue()?.toFixed(1) ?? EM_DASH,
    }),
    columnHelper.accessor((row) => row.variant?.costPerTask ?? null, {
      id: 'cost',
      meta: { priority: 3 },
      header: '$ / task',
      cell: (ctx) => fmtUsd(ctx.getValue()),
    }),
    columnHelper.accessor((row) => row.variant?.timePerTaskEstSec ?? null, {
      id: 'time',
      meta: { priority: 5 },
      header: '≈ Time',
      cell: (ctx) => fmtSeconds(ctx.getValue()),
    }),
    columnHelper.display({
      id: 'verdict',
      meta: { priority: 4, numeral: false },
      header: 'Verdict',
      cell: (ctx) => <VerdictText row={ctx.row.original} names={names} />,
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
        subtitle="agw routes by model and effort · select a row to highlight it"
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
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" fw={600}>
                {row.name}
              </Text>
              <Badge size="sm" variant="light" color="gray">
                {routeCount(row)}
              </Badge>
            </Group>
            <Box>
              <Text size="xs" c="dimmed">
                {row.variant === null
                  ? EM_DASH
                  : `Intel. ${row.variant.intelligence.toFixed(1)} · ${fmtUsd(row.variant.costPerTask)} / task · ${fmtSeconds(row.variant.timePerTaskEstSec)}`}
              </Text>
            </Box>
            <VerdictText row={row} names={names} />
          </Stack>
        )}
      />
      <Text size="xs" c="dimmed">
        {SLOTS_INFO}
      </Text>
    </Stack>
  )
}
