import { Stack } from '@mantine/core'
import { EmptyState } from 'basalt-ui'
import { Bars } from 'basalt-ui/charts'
import type { BarsBar, BarsLine } from 'basalt-ui/charts'
import { date } from 'basalt-ui/format'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { VX } from 'basalt-ui/tokens'
import { useEvents } from '../api/queries'
import type { EventTotal } from '../api/types'
import { FinanceBar } from '../components/finance-bar'
import { EventLink } from '../components/event-link'
import { QueryCard } from '../components/query-card'
import { SignedAmount } from '../components/signed-amount'
import { eur, eurCompact, gainTone, signedEur } from '../lib/format'
import { FINANCE_SPLIT } from '../../../lib/series'

/** Events shown in the chart, newest first; the table below has all of them. */
const CHART_EVENTS = 8
const LABEL_CHARS = 22

const BARS: BarsBar<EventTotal>[] = [
  {
    key: 'paid',
    label: 'Paid',
    color: FINANCE_SPLIT.oneoff,
    getValue: (e) => e.paid_cents,
    formatValue: signedEur,
  },
  {
    key: 'reimbursed',
    label: 'Reimbursed',
    color: FINANCE_SPLIT.leftover,
    getValue: (e) => e.reimbursed_cents,
    formatValue: signedEur,
  },
]

const NET_LINE: BarsLine<EventTotal>[] = [
  { key: 'net', label: 'Net', color: VX.ink, getValue: (e) => e.net_cents, formatValue: signedEur },
]

const short = (label: string): string =>
  label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS - 1)}…` : label

const col = createColumnHelper<EventTotal>()

const columns = [
  col.accessor('label', {
    header: 'Event',
    cell: (c) => <EventLink eventId={c.row.original.event_id}>{c.getValue()}</EventLink>,
  }),
  col.accessor((e) => Date.parse(e.first_day), {
    id: 'first',
    header: 'From',
    sortFn: 'basic',
    cell: (c) => date(c.row.original.first_day),
  }),
  col.accessor((e) => Date.parse(e.last_day), {
    id: 'last',
    header: 'To',
    sortFn: 'basic',
    cell: (c) => date(c.row.original.last_day),
  }),
  col.accessor((e) => Math.abs(e.paid_cents), {
    id: 'paid',
    header: 'Paid',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (c) => eur(c.getValue()),
  }),
  col.accessor('reimbursed_cents', {
    header: 'Reimbursed',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (c) => eur(c.getValue()),
  }),
  col.accessor('net_cents', {
    header: 'Net',
    sortFn: 'basic',
    meta: { align: 'right' },
    cell: (c) => <SignedAmount cents={c.getValue()} />,
  }),
  col.accessor('n', { header: 'Bookings', sortFn: 'basic', meta: { align: 'right' } }),
]

export function EventsPage() {
  const events = useEvents()
  const rows = events.data ?? []
  const recent = rows
    .toSorted((a, b) => b.last_day.localeCompare(a.last_day))
    .slice(0, CHART_EVENTS)
    .toReversed()
  const net = rows.reduce((sum, e) => sum + e.net_cents, 0)
  const paid = rows.reduce((sum, e) => sum + e.paid_cents, 0)
  const reimbursed = rows.reduce((sum, e) => sum + e.reimbursed_cents, 0)

  if (events.isSuccess && rows.length === 0) {
    return (
      <EmptyState
        tier="page"
        title="No events yet"
        description="Group a trip or a shared cost with its reimbursements: `fin tx event add <id> --label <label>`, then `fin tx event assign <id> <booking...>`."
      />
    )
  }

  return (
    <Stack gap="sm">
      <FinanceBar />
      <QueryCard
        title="What did trips and shared costs really cost?"
        info="Per event: what was paid, what came back, and the net cost. Events are kept out of the regular spending so a trip does not read as a bad month."
        query={events}
        empty={false}
        facts={[
          {
            value: eur(Math.abs(net)),
            unit: net <= 0 ? 'net cost' : 'net gain',
            period: `${rows.length} events`,
            tone: gainTone(net) ?? 'muted',
          },
          {
            value: eur(reimbursed),
            unit: 'reimbursed',
            period: `of ${eur(Math.abs(paid))} paid`,
          },
        ]}
      >
        <Bars<EventTotal, string>
          data={recent}
          ariaLabel="Paid, reimbursed and net per event, in euros"
          x={(e) => e.event_id}
          formatX={(id) => {
            const event = recent.find((e) => e.event_id === id)
            return event === undefined
              ? id
              : `${short(event.label)} · ${signedEur(event.net_cents)}`
          }}
          bars={BARS}
          lines={NET_LINE}
          layout="stacked"
          y={{ format: eurCompact }}
          refLines={[{ value: 0, color: VX.muted }]}
          height={{ base: 260, regular: 340 }}
        />
      </QueryCard>
      <BasaltDataTable
        title="All events"
        data={rows}
        columns={columns}
        getRowId={(e) => e.event_id}
        query={events}
        initialSorting={[{ id: 'last', desc: true }]}
      />
    </Stack>
  )
}
