import { Badge, Group, Text, Tooltip } from '@mantine/core'
import type { ChartBar, MarketQuote } from '../api/types'
import { signedPercent } from '../lib/depot-chart'
import { asOfText, candleNote, quoteStatus } from '../lib/depot-live'

/**
 * Beside the live price in the chart's header: its change against the previous close, where the price stands (live,
 * delayed, after hours, closed) and, on hover or tap, when it was made. A running candle that lags the price says so.
 */
export function QuoteState({
  quote,
  coin,
  bar,
}: {
  quote: MarketQuote
  coin: boolean
  /** The newest bar of the chart. */
  bar: ChartBar | undefined
}) {
  const status = quoteStatus(quote)
  const lag = candleNote(bar)
  return (
    <Group component="span" display="inline-flex" gap="xs" align="center" data-shot="depot-quote">
      {quote.change_pct !== null && (
        <Text span size="sm" c={quote.change_pct >= 0 ? 'green' : 'red'}>
          {signedPercent(quote.change_pct)}
        </Text>
      )}
      <Tooltip
        label={asOfText(quote, coin)}
        withArrow
        events={{ hover: true, focus: true, touch: true }}
      >
        <Badge
          size="sm"
          variant={status.live ? 'light' : 'outline'}
          color="gray"
          tabIndex={0}
          data-shot="depot-quote-status"
        >
          {status.label}
        </Badge>
      </Tooltip>
      {lag !== null && (
        <Text span size="xs" c="dimmed" data-shot="depot-candle-lag">
          {lag}
        </Text>
      )}
    </Group>
  )
}
