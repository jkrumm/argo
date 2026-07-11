import { createFileRoute } from '@tanstack/react-router'
import {
  ChartCard,
  ChartHoverSync,
  ChartLegend,
  LineSparkline,
  MultiLine,
  ZonedLine,
} from 'basalt-ui/charts'
import type { ChartSeries } from 'basalt-ui/charts'
import { SERIES } from '../lib/series'

export const Route = createFileRoute('/charts-smoke')({
  component: ChartsSmokeRoute,
})

const SMOKE_DATA = [
  { date: '2026-04-01', value: 45 },
  { date: '2026-04-02', value: 52 },
  { date: '2026-04-03', value: 48 },
  { date: '2026-04-04', value: 61 },
  { date: '2026-04-05', value: 55 },
  { date: '2026-04-06', value: 59 },
  { date: '2026-04-07', value: 63 },
]

const MULTI_LINE_DATA = [
  { date: '2026-04-01', hrv: 45, restingHr: 58 },
  { date: '2026-04-02', hrv: 52, restingHr: 56 },
  { date: '2026-04-03', hrv: 48, restingHr: 57 },
  { date: '2026-04-04', hrv: 61, restingHr: 54 },
  { date: '2026-04-05', hrv: 55, restingHr: 55 },
  { date: '2026-04-06', hrv: 59, restingHr: 53 },
  { date: '2026-04-07', hrv: 63, restingHr: 52 },
]

const SPARKLINE_DATA = [45, 52, 48, 61, 55, 59, 63]

const MULTI_LINE_SERIES: ChartSeries<(typeof MULTI_LINE_DATA)[number]>[] = [
  { key: 'hrv', label: 'HRV', color: SERIES.hrv, mark: 'line', getValue: (d) => d.hrv },
  {
    key: 'restingHr',
    label: 'Resting HR',
    color: SERIES.restingHr,
    mark: 'line',
    getValue: (d) => d.restingHr,
  },
]

function ChartsSmokeRoute() {
  if (!import.meta.env.DEV) return null

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <h2 style={{ marginBottom: 16 }}>basalt-ui/charts smoke test</h2>

      {/* Primitive: ChartLegend */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8, fontSize: 14 }}>Primitive: ChartLegend</h3>
        <ChartLegend
          items={[
            { key: 'hrv', label: 'HRV', color: SERIES.hrv, shape: 'line' },
            { key: 'hr', label: 'Resting HR', color: SERIES.restingHr, shape: 'line' },
          ]}
          highlighted={null}
          onHighlight={() => {}}
        />
      </div>

      {/* Sparkline */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8, fontSize: 14 }}>Sparkline: LineSparkline</h3>
        <LineSparkline data={SPARKLINE_DATA} width={200} height={40} color={SERIES.hrv} />
      </div>

      <ChartHoverSync>
        {/* Kind: ZonedLine */}
        <div style={{ marginBottom: 24 }}>
          <ChartCard title="HRV Trend" tooltip="7-day rolling average HRV from Garmin">
            <ZonedLine
              data={SMOKE_DATA}
              height={200}
              chartId="smoke-zoned-line"
              getX={(d) => d.date}
              series={[
                {
                  key: 'hrv',
                  label: 'HRV',
                  color: SERIES.hrv,
                  mark: 'line',
                  getValue: (d) => d.value,
                },
              ]}
              yDomain="auto"
              formatValue={(v) => `${Math.round(v)} ms`}
              ariaLabel="HRV trend, smoke test"
            />
          </ChartCard>
        </div>

        {/* Kind: MultiLine */}
        <ChartCard title="HRV vs Resting HR" tooltip="Two series sharing one y-axis">
          <MultiLine
            data={MULTI_LINE_DATA}
            height={200}
            chartId="smoke-multi-line"
            getX={(d) => d.date}
            series={MULTI_LINE_SERIES}
            yDomain="auto"
            formatValue={(v) => `${Math.round(v)} ms`}
            ariaLabel="HRV vs resting HR, smoke test"
          />
        </ChartCard>
      </ChartHoverSync>
    </div>
  )
}
