/**
 * The catalog: one row per current lineage, sortable, opening to its effort ladder. The cost, tokens and
 * time of a lineage row are those of its most intelligent variant (the top effort), and the header says
 * so. The open lineage is the page's highlighted one (`pick`, in the URL), so opening a row also lights
 * it on the three charts.
 */
import { Group, Stack, Text } from '@mantine/core'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { Section } from 'basalt-ui'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { modelsStore } from '../../lib/window-stores'
import type { EfficiencyVariant, UnscoredModel } from './api/types'
import { CATALOG_NOTE } from './copy'
import { EM_DASH, fmtPrice, fmtSeconds, fmtTokens, fmtUsd } from './format'
import { CATALOG_SORT_KEYS, sortLineageRows, type CatalogSortKey, type LineageRow } from './model'

/** A lineage row or, under the open lineage, one of its variants. */
interface CatalogRow {
  id: string
  kind: 'lineage' | 'variant'
  name: string
  lineage: string
  creator: string
  releaseDate: string | null
  variant: EfficiencyVariant
  slots: number
  legs: string[]
  callable: boolean
  superseded: boolean
}

function flatten(
  rows: readonly LineageRow[],
  open: string,
  slotsOf: (v: EfficiencyVariant) => number,
  names: (lineage: string) => string,
): CatalogRow[] {
  return rows.flatMap((row) => {
    const head: CatalogRow = {
      id: row.lineage,
      kind: 'lineage',
      name: names(row.lineage),
      lineage: row.lineage,
      creator: row.creator,
      releaseDate: row.releaseDate,
      variant: row.best,
      slots: row.slots,
      legs: row.legs,
      callable: row.callable,
      superseded: row.superseded,
    }
    if (row.lineage !== open) return [head]
    const children = row.variants.map<CatalogRow>((variant) => ({
      id: variant.slug,
      kind: 'variant',
      name: variant.effort === 'default' ? 'default' : variant.effort,
      lineage: row.lineage,
      creator: '',
      releaseDate: null,
      variant,
      slots: slotsOf(variant),
      legs: variant.iu.legs,
      callable: variant.iu.accessible,
      superseded: variant.superseded,
    }))
    return [head, ...children]
  })
}

const columnHelper = createColumnHelper<CatalogRow>()

const iuText = (row: CatalogRow): string =>
  row.callable
    ? `callable${row.legs.length > 0 ? ` · ${row.legs.join(', ')}` : ''}`
    : 'not callable'

function CatalogCard({ row, open }: { row: CatalogRow; open: boolean }) {
  const v = row.variant
  const figures = `Intel. ${v.intelligence.toFixed(1)} · ${fmtUsd(v.costPerTask)} / task · ${fmtSeconds(v.timePerTaskEstSec)} · ${fmtTokens(v.tokensPerTaskEst)} tokens`
  if (row.kind === 'variant') {
    return (
      <Stack gap={2} pl="md">
        <Text size="sm" fw={500}>
          {row.name}
        </Text>
        <Text size="xs" c="dimmed">
          {figures}
        </Text>
      </Stack>
    )
  }
  const Chevron = open ? IconChevronDown : IconChevronRight
  return (
    <Stack gap={2}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Chevron size={14} />
          <Text size="sm" fw={600}>
            {row.name}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {row.creator}
          {row.superseded ? ' · superseded' : ''}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {figures}
      </Text>
      <Text size="xs" c="dimmed">
        {fmtPrice(v.priceIn)} in / {fmtPrice(v.priceOut)} out per 1M · {iuText(row)}
        {row.slots > 0 ? ` · ${row.slots} ${row.slots === 1 ? 'slot' : 'slots'}` : ''}
      </Text>
    </Stack>
  )
}

const SORT_IDS = new Set<string>(CATALOG_SORT_KEYS)
const isSortKey = (id: string): id is CatalogSortKey => SORT_IDS.has(id)

export function CatalogTable({
  lineages,
  unscored,
  slotsOf,
  names,
}: {
  lineages: readonly LineageRow[]
  unscored: readonly UnscoredModel[]
  slotsOf: (v: EfficiencyVariant) => number
  names: (lineage: string) => string
}) {
  const [pick, setPick] = modelsStore.field.pick.use()
  const [sort, setSort] = modelsStore.field.sort.use()
  const [dir, setDir] = modelsStore.field.dir.use()
  const data = flatten(sortLineageRows(lineages, sort, dir), pick, slotsOf, names)

  const columns = [
    columnHelper.accessor((row) => row.name, {
      id: 'lineage',
      meta: { priority: 0, numeral: false },
      header: 'Model',
      cell: (ctx) => {
        const row = ctx.row.original
        if (row.kind === 'variant') {
          return (
            <Text size="sm" c="dimmed" pl="md">
              {row.name}
            </Text>
          )
        }
        const Chevron = row.lineage === pick ? IconChevronDown : IconChevronRight
        return (
          <Group gap="xs" wrap="nowrap">
            <Chevron size={14} />
            <Stack gap={0}>
              <Text size="sm" fw={500}>
                {row.name}
              </Text>
              {row.superseded ? (
                <Text size="xs" c="dimmed">
                  superseded
                </Text>
              ) : null}
            </Stack>
          </Group>
        )
      },
    }),
    columnHelper.accessor((row) => row.creator, {
      id: 'creator',
      meta: { priority: 9, numeral: false },
      header: 'Creator',
    }),
    columnHelper.accessor((row) => row.releaseDate ?? '', {
      id: 'released',
      meta: { priority: 8, numeral: false },
      header: 'Released',
      cell: (ctx) => ctx.getValue() || '',
    }),
    columnHelper.accessor((row) => row.variant.intelligence, {
      id: 'intelligence',
      meta: { priority: 1 },
      header: 'Best intel.',
      cell: (ctx) => ctx.getValue().toFixed(1),
    }),
    columnHelper.accessor((row) => row.variant.costPerTask, {
      id: 'cost',
      meta: { priority: 2 },
      header: '$ / task, top effort',
      cell: (ctx) => fmtUsd(ctx.getValue()),
    }),
    columnHelper.accessor((row) => row.variant.tokensPerTaskEst, {
      id: 'tokens',
      meta: { priority: 5 },
      header: '≈ Tokens',
      cell: (ctx) => fmtTokens(ctx.getValue()),
    }),
    columnHelper.accessor((row) => row.variant.timePerTaskEstSec, {
      id: 'time',
      meta: { priority: 4 },
      header: '≈ Time',
      cell: (ctx) => fmtSeconds(ctx.getValue()),
    }),
    columnHelper.accessor((row) => row.variant.priceIn, {
      id: 'priceIn',
      meta: { priority: 7 },
      header: '$ in /1M',
      cell: (ctx) => fmtPrice(ctx.getValue()),
    }),
    columnHelper.accessor((row) => row.variant.priceOut, {
      id: 'priceOut',
      meta: { priority: 7 },
      header: '$ out /1M',
      cell: (ctx) => fmtPrice(ctx.getValue()),
    }),
    columnHelper.display({
      id: 'iu',
      meta: { priority: 6, numeral: false },
      header: 'IU',
      cell: (ctx) => (
        <Text size="sm" {...(ctx.row.original.callable ? {} : { c: 'dimmed' })}>
          {iuText(ctx.row.original)}
        </Text>
      ),
    }),
    columnHelper.accessor((row) => row.slots, {
      id: 'slots',
      meta: { priority: 3 },
      header: 'Slots',
      cell: (ctx) => (ctx.getValue() === 0 ? EM_DASH : ctx.getValue()),
    }),
  ]

  return (
    <Stack gap="md" data-shot="catalog" data-shot-states="empty">
      <BasaltDataTable
        title="Catalog"
        subtitle={CATALOG_NOTE}
        data={data}
        columns={columns}
        getRowId={(row) => row.id}
        manualSorting
        initialSorting={[{ id: sort, desc: dir === 'desc' }]}
        onSortingChange={(sorting) => {
          const first = sorting[0]
          if (first === undefined || !isSortKey(first.id)) return
          setSort(first.id)
          setDir(first.desc ? 'desc' : 'asc')
        }}
        highlightOnHover
        verticalSpacing="xs"
        onRowActivate={(row) =>
          setPick(row.lineage === pick && row.kind === 'lineage' ? '' : row.lineage)
        }
        // A phone gets one card per row: the column fold's disclosure would add a bare dot column.
        renderCard={(row) => <CatalogCard row={row} open={row.lineage === pick} />}
        emptyState="No model matches the filters"
        stickyHeader
        maxHeight={640}
      />
      {unscored.length === 0 ? null : (
        <Section
          title="Not scored"
          count={unscored.length}
          subtitle="Callable on the IU endpoint, no Artificial Analysis row"
          collapsible
          defaultOpen={false}
        >
          <Stack gap={4}>
            {unscored.map((model) => (
              <Group key={model.id} gap="sm">
                <Text size="sm" ff="monospace">
                  {model.id}
                </Text>
                <Text size="xs" c="dimmed">
                  {model.accessible ? 'callable' : 'not callable'}
                  {model.legs.length > 0 ? ` · ${model.legs.join(', ')}` : ''}
                </Text>
              </Group>
            ))}
          </Stack>
        </Section>
      )}
    </Stack>
  )
}
