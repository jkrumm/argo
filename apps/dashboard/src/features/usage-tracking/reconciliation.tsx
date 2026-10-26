/**
 * Section D, portal vs tracked: can tracked spend stand in for the IU number, and on which days does
 * it not? Grouped bars per day (the portal's figure beside the tracker's), a delta strip under them
 * (ok within max($1, 20 %), warn beyond: the API's `flagged`, the newest portal day marked partial),
 * and the per-model split of the whole window. The API returns models for the window, not per day,
 * so the table does not follow a selected day. No portal data collapses the section to one line.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Stack, Table, Text } from '@mantine/core'
import { Bars, BandStrip, ChartCard } from 'basalt-ui/charts'
import type { BandSpan } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { USAGE_RECON } from '../../lib/series'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type IuReconcile } from '../../lib/queries/usage'
import { fmtUsdWhole, shortDay } from './model'
import {
  RECON_MODELS_NOTE,
  RECON_NO_PORTAL,
  RECON_WINDOW_DAYS,
  dayReading,
  fmtSignedUsd,
  modelRows,
  reconDays,
  unpricedNote,
  wholeDollarTable,
  type ReconDay,
} from './reconcile-model'

const EMPTY: IuReconcile = {
  days: [],
  models: [],
  unpricedRows: 0,
  windowTotals: { portalUsd: 0, trackedUsd: 0 },
}

const BAR_HEIGHT = 200
const STRIP_HEIGHT = 56

const INFO =
  'Tracked IU spend (the usage-tracker rows billed to IU) against what the IU portal reports, per UTC day. The strip flags a day when the two differ by more than the larger of $1 and 20 % of the portal figure. The newest portal day is still settling and is marked partial. Tracking prices some models at far less than the portal does, and rows without a recorded cost count as zero.'

const BARS = [
  {
    key: 'portal',
    label: 'Portal',
    color: alpha(VX.muted, 0.55),
    getValue: (d: ReconDay) => d.portalUsd,
  },
  {
    key: 'tracked',
    label: 'Tracked',
    color: USAGE_RECON.tracked,
    getValue: (d: ReconDay) => d.trackedUsd,
  },
]

const STRIP_STATES = [
  {
    key: 'ok',
    label: 'Within max($1, 20 %)',
    color: alpha(VX.muted, 0.2),
    formatValue: (d: ReconDay) => dayReading(d),
  },
  {
    key: 'warn',
    label: 'Off by more',
    color: VX.warnSolid,
    formatValue: (d: ReconDay) => dayReading(d),
  },
  { key: 'partial', label: 'Partial day', color: VX.muted },
] as const

const bandOf = (d: ReconDay): BandSpan => ({
  state: d.flagged ? 'warn' : 'ok',
  ...(d.partial ? { marker: { state: 'partial' } } : {}),
})

export default function Reconciliation() {
  const query = useSuspenseQuery(usageQueries.iuReconcile(RECON_WINDOW_DAYS))
  const data = shotState() === 'empty' ? EMPTY : query.data

  if (data.days.length === 0) {
    return (
      <Box data-shot="reconciliation" data-shot-states="empty">
        <Text size="sm" c="dimmed">
          Portal vs tracked · {RECON_NO_PORTAL}
        </Text>
      </Box>
    )
  }

  const days = reconDays(data.days)
  const flagged = days.filter((d) => d.flagged && !d.partial).length
  // Headline and table round once from the same model rows, so the rows add up to the headline.
  const { rows: models, portalUsd, trackedUsd } = wholeDollarTable(modelRows(data.models))

  return (
    <Box data-shot="reconciliation" data-shot-states="empty">
      <ChartCard
        title={`Portal vs tracked · IU spend per day · ${days.length} d`}
        info={INFO}
        facts={[
          { value: fmtUsdWhole(portalUsd), period: 'portal' },
          { value: fmtUsdWhole(trackedUsd), period: 'tracked' },
          {
            value: fmtSignedUsd(trackedUsd - portalUsd),
            period: `${flagged} ${flagged === 1 ? 'day' : 'days'} flagged`,
            tone: flagged > 0 ? 'warn' : 'muted',
          },
        ]}
      >
        <Stack gap="sm">
          <Box data-shot-tooltip>
            <Bars
              ariaLabel={`IU spend per day, ${days.length} days: the portal's figure beside the tracked one`}
              data={days}
              height={BAR_HEIGHT}
              x={(d: ReconDay) => d.date}
              xTicks={5}
              formatX={(d) => shortDay(d)}
              layout="grouped"
              legend={{ placement: 'bottom' }}
              y={{ format: fmtUsdWhole, ticks: 3 }}
              bars={BARS}
              tooltip={{
                formatHeader: (x) => shortDay(x),
                rows: (d) => [
                  { label: 'Delta', value: dayReading(d) },
                  ...(d.partial ? [{ label: 'Partial day', value: 'portal still settling' }] : []),
                ],
              }}
            />
          </Box>
          <BandStrip
            ariaLabel={`Tracked minus portal per day, ${days.length} days: flagged when off by more than the larger of $1 and 20 %`}
            data={days}
            height={STRIP_HEIGHT}
            x={(d: ReconDay) => d.date}
            xTicks={5}
            formatX={(d) => shortDay(d)}
            states={STRIP_STATES}
            getBand={bandOf}
            legend={{ placement: 'bottom' }}
            tooltip={{ formatHeader: (x) => shortDay(x) }}
          />
          <Text fz={VX.text.micro} c="dimmed">
            {RECON_MODELS_NOTE}
          </Text>
          <Table.ScrollContainer minWidth={320}>
            <Table withRowBorders={false} verticalSpacing={4} horizontalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Model</Table.Th>
                  <Table.Th ta="right">Portal</Table.Th>
                  <Table.Th ta="right">Tracked</Table.Th>
                  <Table.Th ta="right">Delta</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {models.map((m) => (
                  <Table.Tr key={m.label}>
                    <Table.Td>{m.label}</Table.Td>
                    <Table.Td ta="right">{fmtUsdWhole(m.portalUsd)}</Table.Td>
                    <Table.Td ta="right">{fmtUsdWhole(m.trackedUsd)}</Table.Td>
                    <Table.Td ta="right" c="dimmed">
                      {fmtSignedUsd(m.trackedUsd - m.portalUsd)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Text fz={VX.text.micro} c="dimmed">
            {unpricedNote(data.unpricedRows)}
          </Text>
        </Stack>
      </ChartCard>
    </Box>
  )
}
