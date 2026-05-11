import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ChartCard,
  ChartLegend,
  HoverContext,
  LineSparkline,
  VX,
  ZonedLine,
  type HoverCtx,
} from '@argo/charts'

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

const SPARKLINE_DATA = [45, 52, 48, 61, 55, 59, 63]

function ChartsSmokeRoute() {
  const [hover, setHover] = useState<HoverCtx>({
    date: null,
    source: null,
    setHover: (date, source) => setHover((prev) => ({ ...prev, date, source })),
  })

  if (!import.meta.env.DEV) return null

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <h2 style={{ marginBottom: 16 }}>@argo/charts smoke test</h2>

      {/* Primitive: ChartLegend */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8, fontSize: 14 }}>Primitive: ChartLegend</h3>
        <ChartLegend
          items={[
            { key: 'hrv', label: 'HRV', color: VX.series.hrv, shape: 'line' },
            { key: 'hr', label: 'Resting HR', color: VX.series.restingHr, shape: 'line' },
          ]}
          highlighted={null}
          onHighlight={() => {}}
        />
      </div>

      {/* Sparkline */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8, fontSize: 14 }}>Sparkline: LineSparkline</h3>
        <LineSparkline data={SPARKLINE_DATA} width={200} height={40} color={VX.series.hrv} />
      </div>

      {/* Kind: ZonedLine */}
      <HoverContext.Provider value={hover}>
        <ChartCard title="HRV Trend" tooltip="7-day rolling average HRV from Garmin">
          <ZonedLine
            data={SMOKE_DATA}
            width={700}
            height={200}
            chartId="smoke-zoned-line"
            getX={(d) => d.date}
            getY={(d) => d.value}
            yDomain="auto"
            seriesLabel="HRV"
            formatValue={(v) => `${Math.round(v)} ms`}
            zones={[{ from: 55, to: Infinity, fill: VX.good }]}
          />
        </ChartCard>
      </HoverContext.Provider>
    </div>
  )
}
