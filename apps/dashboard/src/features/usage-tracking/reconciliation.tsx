/**
 * Section D, portal vs tracked, for one IU API key: can tracked spend stand in for the IU number, and
 * on which days does it not? One totals line (the portal's figure, ours, the gap) over a delta strip
 * per day (ok within max($1, 20 %), flagged beyond: the API's `flagged`, the newest portal day marked
 * partial). The key's `gapReading` decides what a portal figure above ours means (`GAP_PRESENTATION`).
 * A key IU's portal has not reported for keeps its card, with the cause and the next step inside, so
 * keys side by side read as equal cards.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Stack, Text } from '@mantine/core'
import { BandStrip, ChartCard } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { shotState } from '../../lib/shot-state'
import { usageQueries } from '../../lib/queries/usage'
import type { KeyWallet } from './accounts'
import { answersKey, noPortalNote } from './budget-model'
import { fmtUsdWhole, shortDay } from './model'
import {
  GAP_PRESENTATION,
  RECON_NO_PORTAL,
  RECON_WINDOW_DAYS,
  gapLine,
  reconDays,
  unpricedNote,
  type ReconDay,
} from './reconcile-model'
import classes from './usage.module.css'

const STRIP_HEIGHT = 56

export default function Reconciliation({
  wallet,
  named,
}: {
  wallet: KeyWallet
  /** More than one key's card is on screen: the synthetic empty line then says whose it is. */
  named: boolean
}) {
  const query = useSuspenseQuery(usageQueries.iuReconcile(RECON_WINDOW_DAYS, wallet.iuKey))
  const present = GAP_PRESENTATION[wallet.gapReading]

  // A synthetic empty state (a shot with the data withheld) keeps the section's original line.
  if (shotState() === 'empty') {
    return (
      <Box data-shot={wallet.anchor} data-shot-states="empty">
        <Text size="sm" c="dimmed">
          Portal vs tracked · {named ? `${wallet.title} · ` : ''}
          {RECON_NO_PORTAL}
        </Text>
      </Box>
    )
  }

  // IU's portal has not reported for this key: no portal days, or an answer for another key.
  const data = answersKey(query.data, wallet.iuKey) ? query.data : null
  if (data === null || data.days.length === 0) {
    return (
      <Box data-shot={wallet.anchor} data-shot-states="empty" h="100%">
        <ChartCard
          className={classes.fill}
          title={`Portal vs tracked · ${wallet.spend} · ${RECON_WINDOW_DAYS} d`}
          info={present.info}
          placeholderHeight="content"
        >
          <Text size="sm" c="dimmed">
            {noPortalNote({ target: 'comparison' }).head}
          </Text>
        </ChartCard>
      </Box>
    )
  }

  const days = reconDays(data.days)
  // Whole dollars, and the gap from the rounded figures, so the line adds up as printed.
  const portalUsd = Math.round(data.windowTotals.portalUsd)
  const trackedUsd = Math.round(data.windowTotals.trackedUsd)

  return (
    <Box data-shot={wallet.anchor} data-shot-states="empty" h="100%">
      <ChartCard
        className={classes.fill}
        title={`Portal vs tracked · ${wallet.spend} · ${days.length} d`}
        subtitle="Portal: IU's own billing report · tracked: our estimate"
        info={present.info}
      >
        <Stack gap="sm">
          <Text size="sm">
            Portal {fmtUsdWhole(portalUsd)} · tracked {fmtUsdWhole(trackedUsd)} ·{' '}
            {gapLine(wallet.gapReading, portalUsd, trackedUsd)}
          </Text>
          <BandStrip
            ariaLabel={`Tracked minus portal per day, ${days.length} days: ${present.flagged} than the larger of $1 and 20 %`}
            data={days}
            height={STRIP_HEIGHT}
            x={(d: ReconDay) => d.date}
            xTicks={5}
            formatX={(d) => shortDay(d)}
            states={present.states}
            getBand={present.bandOf}
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
