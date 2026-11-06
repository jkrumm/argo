/**
 * The models page: where the owner decides which model to use for what. One big scatter of intelligence
 * against the efficiency index (or cost, time or tokens, by the toggle), "Your slots" with the leanest
 * alternative to each agw route, and the catalog of every effort of every current model as a data
 * table. Everything on screen is `model.ts`'s answer over `GET /api/models/efficiency`.
 */
import { useQuery } from '@tanstack/react-query'
import { Stack, Text } from '@mantine/core'
import { PageBar, PageSummary, useSizeClass } from 'basalt-ui'
import { FilterSet, MultiSelectFilter, ToggleFilter } from 'basalt-ui/controls'
import { chartStateOf } from '../../lib/chart-state'
import { formatRelative } from '../../lib/format'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { modelsStore } from '../../lib/window-stores'
import { modelsQueries } from './api/queries'
import type { EfficiencyVariant } from './api/types'
import { CatalogTable } from './catalog-table'
import { METRIC_COPY } from './copy'
import { EfficiencyScatter } from './efficiency-scatter'
import { asUtc, shortLineage } from './format'
import {
  efficiencyIndexes,
  intelligenceDomain,
  lineageNames,
  routeUse,
  scatterPoints,
  variantLabel,
  visibleVariants,
} from './model'
import { slotRows, slotSummary } from './slot-rows'
import { SlotsList } from './slots-list'

const HEIGHT = { base: 340, regular: 520 } as const
const EMPTY: readonly EfficiencyVariant[] = []

export function ModelsPage() {
  const filters = modelsStore.useValues()
  const query = useQuery(modelsQueries.efficiency())
  const now = useNow()

  const data = shotState() === 'empty' ? undefined : query.data
  const variants = data?.variants ?? EMPTY
  const routes = data?.routes ?? []
  const visible = visibleVariants(variants, filters, routes)
  const use = routeUse(routes)

  // The tables, tooltips and the chip say the readable lineage name (the API's `name` without its effort
  // parenthetical); only the chart labels shorten it, one rule for every lineage.
  const readable = lineageNames(variants)
  const display = (lineage: string) => readable.get(lineage) ?? lineage
  const variantName = (v: EfficiencyVariant) => variantLabel(v, display)
  const compact = useSizeClass() === 'compact'

  // Medians and recommendation pools use every variant: a filter never moves an index or a verdict.
  const indexes = efficiencyIndexes(variants)
  const scatter = scatterPoints(visible, filters.metric, indexes)
  const copy = METRIC_COPY[filters.metric]
  const slots = slotRows(routes, variants, indexes, display)

  const summary =
    data === undefined
      ? null
      : slots.length === 0
        ? `${visible.length} variants shown.`
        : slotSummary(slots)
  const captured = data?.capturedAt ?? null
  const aside =
    data === undefined
      ? undefined
      : captured === null
        ? 'Artificial Analysis snapshot of unknown age'
        : `Artificial Analysis data from ${formatRelative(asUtc(captured), now)}`

  return (
    <>
      <PageBar
        sync={{
          syncing: query.isFetching,
          onSync: () => void query.refetch(),
          label: 'Refresh',
        }}
        filters={
          <FilterSet>
            <ToggleFilter field={modelsStore.field.callable} label="IU callable only" />
            <ToggleFilter field={modelsStore.field.superseded} label="Show superseded" />
            <MultiSelectFilter
              field={modelsStore.field.creators}
              label="All creators"
              noun="creators"
            />
          </FilterSet>
        }
      />

      <Stack gap="md">
        {summary === null ? null : compact ? (
          // A phone: the headline at body size with the freshness under it, not beside it.
          <Stack gap={2}>
            <Text size="md" fw={600}>
              {summary}
            </Text>
            <Text size="xs" c="dimmed">
              {aside}
            </Text>
          </Stack>
        ) : (
          <PageSummary sentence={summary} aside={aside} />
        )}
        <EfficiencyScatter
          axis={filters.metric}
          title={copy.title}
          subtitle={copy.subtitle}
          info={copy.info}
          lacks={copy.lacks}
          points={scatter.points}
          free={scatter.free}
          missing={scatter.missing}
          yDomain={intelligenceDomain(visible)}
          use={use}
          names={(lineage) => shortLineage(display(lineage))}
          display={display}
          source={data?.source ?? null}
          height={HEIGHT}
          state={chartStateOf(
            query,
            query.isSuccess && scatter.points.length === 0
              ? visible.length === 0
                ? 'No model matches the filters'
                : 'No variant has this measure'
              : undefined,
          )}
        />
        <SlotsList rows={slots} routesError={data?.routesError ?? null} names={variantName} />
        <CatalogTable
          variants={visible}
          indexes={indexes}
          routesOf={(v) => use.get(v.slug)?.routes.length ?? 0}
          names={display}
        />
      </Stack>
    </>
  )
}
