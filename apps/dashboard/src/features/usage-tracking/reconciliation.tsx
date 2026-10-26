/**
 * Section D, portal vs tracked: can tracked spend stand in for the IU number, and on which days does
 * it not? One totals line (the portal's figure, ours, the gap) over a delta strip per day (ok within
 * max($1, 20 %), warn beyond: the API's `flagged`, the newest portal day marked partial). No portal
 * data collapses the section to one line.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Stack, Text } from '@mantine/core'
import { BandStrip, ChartCard } from 'basalt-ui/charts'
import type { BandSpan } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { shotState } from '../../lib/shot-state'
import { usageQueries, type IuReconcile } from '../../lib/queries/usage'
import { fmtUsdWhole, shortDay } from './model'
import {
  RECON_NO_PORTAL,
  RECON_WINDOW_DAYS,
  dayReading,
  fmtSignedUsd,
  reconDays,
  unpricedNote,
  type ReconDay,
} from './reconcile-model'

const EMPTY: IuReconcile = {
  days: [],
  models: [],
  unpricedRows: 0,
  windowTotals: { portalUsd: 0, trackedUsd: 0 },
}

const STRIP_HEIGHT = 56

const INFO =
  "Portal is what IU's own billing report says the API cost; tracked is our estimate, priced from the usage-tracker rows billed to IU. The strip flags a UTC day when the two differ by more than the larger of $1 and 20 % of the portal figure. The newest portal day is still settling and is marked partial. Tracking prices some models at far less than the portal does, and rows without a recorded cost count as zero."

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
  // Whole dollars, and the gap from the rounded figures, so the line adds up as printed.
  const portalUsd = Math.round(data.windowTotals.portalUsd)
  const trackedUsd = Math.round(data.windowTotals.trackedUsd)

  return (
    <Box data-shot="reconciliation" data-shot-states="empty">
      <ChartCard
        title={`Portal vs tracked · IU spend · ${days.length} d`}
        subtitle="Portal: IU's own billing report · tracked: our estimate"
        info={INFO}
      >
        <Stack gap="sm">
          <Text size="sm">
            Portal {fmtUsdWhole(portalUsd)} · tracked {fmtUsdWhole(trackedUsd)} ·{' '}
            {fmtSignedUsd(trackedUsd - portalUsd)}
          </Text>
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
            {unpricedNote(data.unpricedRows)}
          </Text>
        </Stack>
      </ChartCard>
    </Box>
  )
}
