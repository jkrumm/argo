// theme-allow-file in-body-page-title — dev-only chart smoke route: it is not a nav destination,
// has no breadcrumb of its own, and the <Title order={2}> IS its only name.
import { createFileRoute } from '@tanstack/react-router'
import { Box, Stack, Title } from '@mantine/core'
import { ChartCard, Lines, Sparkline } from 'basalt-ui/charts'
import type { ChartSeries } from 'basalt-ui/charts'
import { VX } from 'basalt-ui/tokens'
import { SERIES } from '../lib/series'

export const Route = createFileRoute('/charts-smoke')({
  component: ChartsSmokeRoute,
})

const HRV = [45, 52, 48, 61, 55, 59, 63]
const RESTING_HR = [58, 56, 57, 54, 55, 53, 52]

type Row = { date: Date; hrv: number; restingHr: number }

const ROWS: Row[] = HRV.map((hrv, i) => ({
  date: new Date(Date.UTC(2026, 3, i + 1)),
  hrv,
  restingHr: RESTING_HR[i] ?? 0,
}))

const HRV_SERIES: ChartSeries<Row> = {
  key: 'hrv',
  label: 'HRV',
  color: SERIES.hrv,
  getValue: (d) => d.hrv,
}

const RESTING_HR_SERIES: ChartSeries<Row> = {
  key: 'restingHr',
  label: 'Resting HR',
  color: SERIES.restingHr,
  getValue: (d) => d.restingHr,
}

const formatMs = (v: number) => `${Math.round(v)} ms`

function ChartsSmokeRoute() {
  if (!import.meta.env.DEV) return null

  return (
    <Box p={24} maw={800}>
      <Title order={2} mb="md">
        basalt-ui/charts smoke test
      </Title>

      <Stack gap={24}>
        <Box>
          <Title order={3} mb={8} fz={VX.text.md}>
            Sparkline
          </Title>
          <Sparkline
            ariaLabel="HRV sparkline, smoke test"
            data={HRV}
            width={200}
            height={40}
            color={SERIES.hrv}
          />
        </Box>

        <ChartCard title="HRV Trend" info="Single series with a shaded zone band">
          <Lines
            ariaLabel="HRV trend with zone, smoke test"
            data={ROWS}
            height={200}
            x={(d) => d.date}
            series={[HRV_SERIES]}
            zones={[{ from: 50, to: 60, fill: VX.goodSolid }]}
            y={{ domain: 'auto', format: formatMs }}
          />
        </ChartCard>

        <ChartCard title="HRV vs Resting HR" info="Two series sharing one y-axis">
          <Lines
            ariaLabel="HRV vs resting HR, smoke test"
            data={ROWS}
            height={200}
            x={(d) => d.date}
            series={[HRV_SERIES, RESTING_HR_SERIES]}
            y={{ domain: 'auto', format: formatMs }}
          />
        </ChartCard>
      </Stack>
    </Box>
  )
}
