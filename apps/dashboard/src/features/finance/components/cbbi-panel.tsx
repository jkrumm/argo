import { Switch, Text } from '@mantine/core'
import { Lines } from 'basalt-ui/charts'
import type { ChartFact, ChartSeries } from 'basalt-ui/charts'
import { useIndexSeries } from '../api/queries'
import { FINANCE_INDEX } from '../../../lib/series'
import { isoDayDe } from '../lib/depot-number'
import { useCbbiLine } from '../lib/depot-prefs'
import { QueryCard } from './query-card'

/** The stored series of the Colin Talks Crypto Bitcoin Bull Run Index; the service serves it from 0 to 100. */
const CBBI_ID = 'cbbi-confidence'

type Point = { day: string; value: number }

const asDate = (day: string): Date => new Date(`${day}T00:00:00Z`)

/** The CBBI under the Bitcoin chart: the latest reading and, while the switch is on, a thin line of its history. */
export function CbbiPanel({ today }: { today: string }) {
  const [line, setLine] = useCbbiLine()
  const query = useIndexSeries(CBBI_ID, { to: today })
  const points: Point[] = query.data?.points ?? []
  const last = points.at(-1)
  const facts: ChartFact[] =
    last === undefined
      ? []
      : [{ value: String(Math.round(last.value)), unit: 'of 100', period: isoDayDe(last.day) }]
  const series: ChartSeries<Point>[] = [
    {
      key: 'cbbi',
      label: 'CBBI',
      color: FINANCE_INDEX.index,
      strokeWidth: 1.5,
      getValue: (p) => p.value,
      formatValue: (value) => String(Math.round(value)),
    },
  ]
  return (
    <QueryCard
      shot="depot-cbbi"
      title="CBBI"
      info="The Colin Talks Crypto Bitcoin Bull Run Index blends a dozen Bitcoin cycle indicators into one reading from 0 to 100; high readings have come near the tops of earlier cycles and low ones near the bottoms. Daily, from the market store."
      query={query}
      empty={points.length === 0 ? 'The market store holds no CBBI readings.' : false}
      facts={facts}
      ghost="line"
      actions={
        <Switch
          label="Line"
          checked={line}
          onChange={(event) => setLine(event.currentTarget.checked)}
        />
      }
    >
      {line ? (
        <Lines<Point, Date>
          data={points}
          ariaLabel="CBBI, 0 to 100"
          x={(p) => asDate(p.day)}
          formatX={(d) => String(d.getUTCFullYear())}
          series={series}
          y={{ format: (v) => String(Math.round(v)), domain: [0, 100], ticks: [0, 50, 100] }}
          height={{ base: 96, regular: 120 }}
          legend={false}
        />
      ) : (
        <Text size="sm" c="dimmed">
          The line is hidden; the latest reading stays above.
        </Text>
      )}
    </QueryCard>
  )
}
