/**
 * The catalog: one flat row per variant (every effort of every model the filters leave), as a client-side
 * data table: search over model, creator and effort, an Effort facet, sortable columns (a missing value
 * sorts last in both directions), pagination and a pinned Model column. The index, cost, tokens and time
 * are the variant's own, so sorting by index ranks efforts against each other. Clicking a row highlights
 * its lineage (`pick`, in the URL) on the chart; the highlighted lineage's name is set in bold.
 */
import { ColorSwatch, Group, Stack, Text } from '@mantine/core'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import { MODEL_CREATOR } from '../../lib/series'
import { modelsStore } from '../../lib/window-stores'
import type { EfficiencyVariant } from './api/types'
import { EM_DASH, fmtIndex, fmtPrice, fmtSeconds, fmtTokens, fmtUsd } from './format'
import { byEffort, creatorKey, effortRank } from './model'
import { useField } from '../../lib/use-field'

/** A variant with what the table shows beside it. */
interface CatalogRow {
  variant: EfficiencyVariant
  name: string
  creator: string
  index: number | undefined
  routes: number
}

const columnHelper = createColumnHelper<CatalogRow>()

const creatorColor = (creator: string): string => {
  const key = creatorKey(creator)
  return key === 'openai' || key === 'anthropic' || key === 'google'
    ? MODEL_CREATOR[key]
    : VX.neutral
}

const effortText = (v: EfficiencyVariant): string => (v.effort === 'default' ? 'default' : v.effort)

const iuText = (v: EfficiencyVariant): string =>
  v.iu.accessible
    ? `callable${v.iu.legs.length > 0 ? ` · ${v.iu.legs.join(', ')}` : ''}`
    : 'not callable'

/** Undefined, not null, is what TanStack's `sortUndefined: 'last'` keeps at the end in both directions. */
const orUndefined = (value: number | null): number | undefined => value ?? undefined

function ModelName({ row, lit }: { row: CatalogRow; lit: boolean }) {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <ColorSwatch size={8} mt={6} color={creatorColor(row.variant.creator)} withShadow={false} />
      <Stack gap={0}>
        <Text size="sm" fw={lit ? 700 : 500}>
          {row.name}
        </Text>
        {row.variant.superseded ? (
          <Text size="xs" c="dimmed">
            superseded
          </Text>
        ) : null}
      </Stack>
    </Group>
  )
}

function CatalogCard({ row, lit }: { row: CatalogRow; lit: boolean }) {
  const v = row.variant
  return (
    <Stack gap={2}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <ModelName row={row} lit={lit} />
        <Text size="xs" c="dimmed">
          {effortText(v)} · {row.creator}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        Intel. {v.intelligence.toFixed(1)} ·{' '}
        {row.index === undefined ? EM_DASH : fmtIndex(row.index)} index · {fmtUsd(v.costPerTask)} /
        task · {fmtSeconds(v.timePerTaskEstSec)} · {fmtTokens(v.tokensPerTaskEst)} tokens
      </Text>
      <Text size="xs" c="dimmed">
        {fmtPrice(v.priceIn)} in / {fmtPrice(v.priceOut)} out per 1M · {iuText(v)}
        {row.routes > 0 ? ` · ${row.routes} ${row.routes === 1 ? 'route' : 'routes'}` : ''}
      </Text>
    </Stack>
  )
}

export function CatalogTable({
  variants,
  indexes,
  routesOf,
  names,
}: {
  variants: readonly EfficiencyVariant[]
  indexes: ReadonlyMap<string, number>
  routesOf: (v: EfficiencyVariant) => number
  names: (lineage: string) => string
}) {
  const [pick, setPick] = useField(modelsStore.field.pick)
  const data = variants.map<CatalogRow>((variant) => ({
    variant,
    name: names(variant.lineage),
    creator: variant.creator,
    index: indexes.get(variant.slug),
    routes: routesOf(variant),
  }))
  const efforts = [...new Set(variants.toSorted(byEffort).map(effortText))]
  const lit = (row: CatalogRow) => pick !== '' && row.variant.lineage === pick

  const columns = [
    columnHelper.accessor((row) => row.name, {
      id: 'model',
      meta: { priority: 0, numeral: false },
      header: 'Model',
      cell: (ctx) => <ModelName row={ctx.row.original} lit={lit(ctx.row.original)} />,
    }),
    columnHelper.accessor((row) => effortText(row.variant), {
      id: 'effort',
      meta: { priority: 1, numeral: false },
      header: 'Effort',
      sortFn: (a, b) =>
        effortRank(a.original.variant.effort) - effortRank(b.original.variant.effort),
    }),
    columnHelper.accessor((row) => row.creator, {
      id: 'creator',
      meta: { priority: 9, numeral: false },
      header: 'Creator',
    }),
    columnHelper.accessor((row) => row.variant.releaseDate ?? undefined, {
      id: 'released',
      meta: { priority: 8, numeral: false },
      header: 'Released',
      enableGlobalFilter: false,
      sortUndefined: 'last',
      // A date is one token: never split at its hyphens.
      cell: (ctx) => (
        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
          {ctx.getValue() ?? EM_DASH}
        </Text>
      ),
    }),
    columnHelper.accessor((row) => row.variant.intelligence, {
      id: 'intelligence',
      meta: { priority: 2 },
      header: 'Intel.',
      enableGlobalFilter: false,
      cell: (ctx) => ctx.getValue().toFixed(1),
    }),
    columnHelper.accessor((row) => row.index, {
      id: 'index',
      meta: { priority: 3 },
      header: 'Index',
      enableGlobalFilter: false,
      sortUndefined: 'last',
      cell: (ctx) => {
        const index = ctx.getValue()
        return index === undefined ? EM_DASH : fmtIndex(index)
      },
    }),
    columnHelper.accessor((row) => orUndefined(row.variant.costPerTask), {
      id: 'cost',
      meta: { priority: 4 },
      header: '$ / task',
      enableGlobalFilter: false,
      sortUndefined: 'last',
      cell: (ctx) => fmtUsd(ctx.getValue() ?? null),
    }),
    columnHelper.accessor((row) => orUndefined(row.variant.timePerTaskEstSec), {
      id: 'time',
      meta: { priority: 5 },
      header: '≈ Time',
      enableGlobalFilter: false,
      sortUndefined: 'last',
      cell: (ctx) => fmtSeconds(ctx.getValue() ?? null),
    }),
    columnHelper.accessor((row) => orUndefined(row.variant.tokensPerTaskEst), {
      id: 'tokens',
      meta: { priority: 6 },
      header: '≈ Tokens',
      enableGlobalFilter: false,
      sortUndefined: 'last',
      cell: (ctx) => fmtTokens(ctx.getValue() ?? null),
    }),
    columnHelper.accessor((row) => orUndefined(row.variant.tps), {
      id: 'speed',
      meta: { priority: 10 },
      header: 'Speed (tok/s)',
      enableGlobalFilter: false,
      sortUndefined: 'last',
      cell: (ctx) => {
        const tps = ctx.getValue()
        return tps === undefined ? EM_DASH : Math.round(tps)
      },
    }),
    columnHelper.accessor((row) => orUndefined(row.variant.priceIn), {
      id: 'priceIn',
      meta: { priority: 7 },
      header: '$ in /1M',
      enableGlobalFilter: false,
      sortUndefined: 'last',
      cell: (ctx) => fmtPrice(ctx.getValue() ?? null),
    }),
    columnHelper.accessor((row) => orUndefined(row.variant.priceOut), {
      id: 'priceOut',
      meta: { priority: 7 },
      header: '$ out /1M',
      enableGlobalFilter: false,
      sortUndefined: 'last',
      cell: (ctx) => fmtPrice(ctx.getValue() ?? null),
    }),
    columnHelper.accessor((row) => iuText(row.variant), {
      id: 'iu',
      meta: { priority: 11, numeral: false },
      header: 'IU',
      enableGlobalFilter: false,
      cell: (ctx) => (
        <Text size="sm" {...(ctx.row.original.variant.iu.accessible ? {} : { c: 'dimmed' })}>
          {ctx.getValue()}
        </Text>
      ),
    }),
    columnHelper.accessor((row) => row.routes, {
      id: 'routes',
      meta: { priority: 3 },
      header: 'Routes',
      enableGlobalFilter: false,
      cell: (ctx) => (ctx.getValue() === 0 ? EM_DASH : ctx.getValue()),
    }),
  ]

  return (
    <Stack gap="md" data-shot="catalog" data-shot-states="empty">
      <BasaltDataTable
        title="Catalog"
        subtitle="Every effort of every current model · click a row to highlight it"
        data={data}
        columns={columns}
        getRowId={(row) => row.variant.slug}
        initialSorting={[{ id: 'intelligence', desc: true }]}
        enableGlobalFilter
        globalFilterPlaceholder="Search models"
        facets={[
          {
            columnId: 'effort',
            label: 'Effort',
            options: efforts.map((effort) => ({ value: effort, label: effort })),
          },
        ]}
        enablePagination
        pageSizeOptions={[25, 50, 100]}
        initialPagination={{ pageIndex: 0, pageSize: 25 }}
        stickyHeader
        enablePinning
        initialColumnPinning={{ start: ['model'] }}
        highlightOnHover
        verticalSpacing="xs"
        onRowActivate={(row) => setPick(row.variant.lineage === pick ? '' : row.variant.lineage)}
        // A phone gets one card per row: the column fold's disclosure would add a bare dot column.
        renderCard={(row) => <CatalogCard row={row} lit={lit(row)} />}
        emptyState="No model matches the filters"
      />
    </Stack>
  )
}
