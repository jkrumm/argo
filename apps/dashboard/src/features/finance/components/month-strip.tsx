import { Group, Text } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { VX } from 'basalt-ui/tokens'
import type { CashflowMonthV2 } from '../api/types'
import { monthTick } from '../lib/months'
import { finStore } from '../../../lib/window-stores'

/**
 * One link per month under the chart, the way into a month's page. A loss month carries a marker
 * besides its colour, so the strip reads without hue.
 */
export function MonthStrip({ months }: { months: readonly CashflowMonthV2[] }) {
  const filters = finStore.useValues()
  return (
    <Group gap="xs" wrap="wrap" component="nav" aria-label="Open a month">
      <Text size="xs" c="dimmed">
        Open a month
      </Text>
      {months.map((m) => (
        <Link key={m.month} to="/finance/month/$month" params={{ month: m.month }} search={filters}>
          <Text span size="xs" c={m.net_cents < 0 ? VX.status.bad : VX.ink2}>
            {monthTick(m.month)}
            {m.net_cents < 0 ? ' ▼' : ''}
          </Text>
        </Link>
      ))}
      <Text size="xs" c="dimmed">
        ▼ month with a loss
      </Text>
    </Group>
  )
}
