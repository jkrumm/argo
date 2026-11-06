/**
 * The models page: where the owner decides which model to use for what. Three scatters share one
 * encoding (intelligence against cost, time and tokens per task, log x), "Your slots" puts the agw routes
 * against the field, and the catalog lists the current models with their effort ladders. Everything
 * on screen is `model.ts`'s answer over `GET /api/models/efficiency`.
 */
import { useQuery } from '@tanstack/react-query'
import { SimpleGrid, Stack } from '@mantine/core'
import { PageBar, PageSummary } from 'basalt-ui'
import { FilterSet, MultiSelectFilter, SelectFilter, ToggleFilter } from 'basalt-ui/controls'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import { chartStateOf } from '../../lib/chart-state'
import { formatRelative } from '../../lib/format'
import { shotState } from '../../lib/shot-state'
import { useNow } from '../../lib/use-now'
import { modelsStore } from '../../lib/window-stores'
import { modelsQueries } from './api/queries'
import type { EfficiencyVariant } from './api/types'
import { CatalogTable } from './catalog-table'
import { COST_INFO, COST_NOTE, ESTIMATE_NOTE, TIME_INFO, TOKENS_INFO } from './copy'
import { EfficiencyScatter } from './efficiency-scatter'
import { shortLineage } from './format'
import { intelligenceDomain, lineageRows, routeUse, scatterPoints, visibleVariants } from './model'
import { slotRows } from './slot-rows'
import { SlotsList } from './slots-list'

const HEIGHT = { base: 300, regular: 340 } as const
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

  const lineages = [...new Set(variants.map((v) => v.lineage))]
  const names = (lineage: string) => shortLineage(lineage, lineages)
  const variantName = (v: EfficiencyVariant) =>
    `${names(v.lineage)}${v.effort === 'default' ? '' : ` ${v.effort}`}`

  const yDomain = intelligenceDomain(visible)
  const cost = scatterPoints(visible, 'cost')
  const tokens = scatterPoints(visible, 'tokens')
  const time = scatterPoints(visible, 'time')

  const slots = slotRows(routes, variants, visible, variantName)
  const rows = lineageRows(visible, routes)
  const beaten = slots.filter((s) => s.verdict?.kind === 'beaten').length
  const frontier = slots.filter((s) => s.verdict?.kind === 'frontier').length

  const base = {
    yDomain,
    use,
    selected: filters.pick,
    names,
    source: data?.source ?? null,
    height: HEIGHT,
  }
  const stateFor = (points: number) =>
    chartStateOf(
      query,
      query.isSuccess && points === 0
        ? visible.length === 0
          ? 'No model matches the filters'
          : 'No variant has this measure'
        : undefined,
    )

  const summary =
    data === undefined
      ? null
      : slots.length === 0
        ? `${rows.length} models shown.`
        : `${beaten} of your ${slots.length} slots ${beaten === 1 ? 'is' : 'are'} beaten by a callable variant; ${frontier} on the frontier.`
  const captured = data?.capturedAt ?? null
  const aside =
    data === undefined
      ? undefined
      : captured === null
        ? 'Artificial Analysis snapshot of unknown age'
        : `Artificial Analysis data from ${formatRelative(captured, now)}`

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
            <SelectFilter
              field={modelsStore.field.pick}
              label="Highlight"
              clearable
              options={lineages
                .toSorted((a, b) => names(a).localeCompare(names(b)))
                .map((lineage) => ({ value: lineage, label: names(lineage) }))}
            />
          </FilterSet>
        }
      />

      <Stack gap="md">
        {summary === null ? null : <PageSummary sentence={summary} aside={aside} />}
        <SimpleGrid type="container" cols={{ base: 1, [CONTAINER_KEYS.wide]: 2 }} spacing="md">
          <EfficiencyScatter
            {...base}
            axis="cost"
            title="Intelligence vs cost per task"
            subtitle={COST_NOTE}
            info={COST_INFO}
            points={cost.points}
            free={cost.free}
            state={stateFor(cost.points.length)}
            cursorGroup="models-cost"
          />
          <EfficiencyScatter
            {...base}
            axis="time"
            title="Intelligence vs time per task"
            subtitle={ESTIMATE_NOTE}
            info={TIME_INFO}
            points={time.points}
            free={time.free}
            state={stateFor(time.points.length)}
            cursorGroup="models-time"
          />
        </SimpleGrid>
        <SimpleGrid type="container" cols={{ base: 1, [CONTAINER_KEYS.wide]: 2 }} spacing="md">
          <EfficiencyScatter
            {...base}
            axis="tokens"
            title="Intelligence vs tokens per task"
            subtitle={ESTIMATE_NOTE}
            info={TOKENS_INFO}
            points={tokens.points}
            free={tokens.free}
            state={stateFor(tokens.points.length)}
            cursorGroup="models-tokens"
          />
          <SlotsList rows={slots} routesError={data?.routesError ?? null} names={variantName} />
        </SimpleGrid>
        <CatalogTable
          lineages={rows}
          unscored={data?.unscored ?? []}
          slotsOf={(v) => use.get(v.slug)?.routes.length ?? 0}
          names={names}
        />
      </Stack>
    </>
  )
}
