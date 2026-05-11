import { curveMonotoneX } from '@visx/curve'
import { GridRows } from '@visx/grid'
import { Group } from '@visx/group'
import { ParentSize } from '@visx/responsive'
import { scaleLinear, scalePoint } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { useCreate, useDelete } from '@refinedev/core'
import { DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  InputNumber,
  Popconfirm,
  Row,
  Space,
  Spin,
  Table,
  Tooltip as AntTooltip,
  Typography,
} from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import {
  AxisBottomDate,
  AxisLeftNumeric,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  HoverOverlay,
  type LegendEntry,
  TooltipBody,
  TooltipHeader,
  TooltipRow,
  VX,
  smartTicks,
  useHoverSync,
  useTooltipStyles,
  useVxTheme,
} from '../../charts'
import { type WeightLogEntry, useUserProfile, useWeightLog } from './body-weight'

const MARGIN = VX.margin

// ── Analytics ─────────────────────────────────────────────────────────────

// Entries sorted ascending by date — the canonical orientation for analytics.
function sortAsc(entries: WeightLogEntry[]): WeightLogEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date))
}

// Linear regression on (daysFromFirst, weight). Returns kg/day slope, or null
// if fewer than two points span at least 3 days (signal needs a base to stand on).
function linearSlope(entries: WeightLogEntry[]): number | null {
  if (entries.length < 2) return null
  const base = dayjs(entries[0]!.date)
  const xs = entries.map((e) => dayjs(e.date).diff(base, 'day'))
  const span = xs[xs.length - 1]! - xs[0]!
  if (span < 3) return null
  const ys = entries.map((e) => e.weight_kg)
  const n = entries.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my)
    den += (xs[i]! - mx) ** 2
  }
  if (den === 0) return null
  return num / den
}

// Rate from the trailing window — what's the body actually doing right now.
// Uses up to 28 days of entries; falls back to all-time slope when sparse.
function trailingRateKgPerWeek(entries: WeightLogEntry[]): number | null {
  if (entries.length < 2) return null
  const sorted = sortAsc(entries)
  const last = dayjs(sorted[sorted.length - 1]!.date)
  const cutoff = last.subtract(28, 'day')
  // Inclusive — entries exactly 28 days before `last` belong in the window.
  const window = sorted.filter((e) => !dayjs(e.date).isBefore(cutoff))
  const slope = linearSlope(window.length >= 2 ? window : sorted)
  return slope === null ? null : slope * 7
}

// Centered 7-day moving average over the available entries. Sparse-data friendly:
// we average every entry within ±3 days, so a single entry per week still
// produces a visible smoothed curve.
function centeredMA(entries: WeightLogEntry[], halfWindowDays = 3): Map<string, number> {
  const out = new Map<string, number>()
  if (entries.length === 0) return out
  const sorted = sortAsc(entries)
  for (const e of sorted) {
    const center = dayjs(e.date)
    const lo = center.subtract(halfWindowDays, 'day')
    const hi = center.add(halfWindowDays, 'day')
    const window = sorted.filter((x) => {
      const d = dayjs(x.date)
      return !d.isBefore(lo) && !d.isAfter(hi)
    })
    const sum = window.reduce((acc, x) => acc + x.weight_kg, 0)
    out.set(e.date, sum / window.length)
  }
  return out
}

type Phase = 'losing' | 'gaining' | 'maintaining'

function classifyPhase(kgPerWeek: number | null): { phase: Phase; intensity: string } {
  if (kgPerWeek === null) return { phase: 'maintaining', intensity: 'No trend' }
  const abs = Math.abs(kgPerWeek)
  if (abs < 0.1) return { phase: 'maintaining', intensity: 'Maintenance' }
  if (kgPerWeek < 0) {
    if (abs < 0.4) return { phase: 'losing', intensity: 'Lean cut' }
    if (abs < 0.8) return { phase: 'losing', intensity: 'Standard cut' }
    return { phase: 'losing', intensity: 'Aggressive cut' }
  }
  if (abs < 0.3) return { phase: 'gaining', intensity: 'Lean bulk' }
  if (abs < 0.6) return { phase: 'gaining', intensity: 'Standard bulk' }
  return { phase: 'gaining', intensity: 'Aggressive bulk' }
}

// Days until current weight intersects goal at trailing rate.
// Returns null if no goal, rate too small to project, or trending away from goal.
function projectGoalDays(
  latest: number,
  goal: number | null,
  kgPerWeek: number | null,
): number | null {
  if (goal === null || kgPerWeek === null) return null
  const delta = goal - latest
  if (Math.abs(delta) < 0.1) return 0
  if (Math.abs(kgPerWeek) < 0.05) return null
  if (Math.sign(delta) !== Math.sign(kgPerWeek)) return null // diverging
  return Math.round((delta / kgPerWeek) * 7)
}

function formatEta(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'reached'
  if (days < 14) return `${days}d`
  if (days < 90) return `${Math.round(days / 7)}w`
  return `${Math.round(days / 30)}mo`
}

function formatAge(date: string): string {
  const d = dayjs(date)
  const days = dayjs().startOf('day').diff(d.startOf('day'), 'day')
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.round(days / 7)}w ago`
  return `${Math.round(days / 30)}mo ago`
}

// ── Tooltips ──────────────────────────────────────────────────────────────

const TOOLTIPS = {
  current:
    'Most recent logged weight and how stale the entry is. Daily fluctuation of 1–2 kg from food and water is normal — trust the 7-day average more than any single reading.',
  rate: 'Trailing 28-day linear regression of weight over time, in kg/week. Lean cut: <0.4 kg/wk loss · Standard cut: 0.4–0.8 · Aggressive: >0.8. Bulk thresholds halved.',
  goal: 'Distance to goal_weight_kg from user_profile, with an ETA projected from the current trailing rate. Hidden when no goal is set or when trending away from it.',
} as const

// ── Hero ──────────────────────────────────────────────────────────────────

function InfoIcon({ text }: { text: string }) {
  return (
    <AntTooltip title={text} placement="bottom">
      <InfoCircleOutlined
        style={{ fontSize: 11, marginLeft: 4, color: 'rgba(128,128,128,0.45)', cursor: 'help' }}
      />
    </AntTooltip>
  )
}

function phaseColor(phase: Phase): string {
  if (phase === 'maintaining') return VX.warnSolid
  return VX.goodSolid // any deliberate movement is treated as on-purpose; goal-relative direction is shown separately
}

function HeroCard({
  label,
  tooltip,
  value,
  valueColor,
  caption,
}: {
  label: string
  tooltip: string
  value: React.ReactNode
  valueColor?: string
  caption: string
}) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <div style={{ fontSize: 12, color: 'rgba(128,128,128,0.65)', marginBottom: 4 }}>
        {label}
        <InfoIcon text={tooltip} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: valueColor, lineHeight: 1 }}>
          {value}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'rgba(128,128,128,0.55)', marginTop: 4 }}>{caption}</div>
    </Card>
  )
}

function WeightHero({ entries, goal }: { entries: WeightLogEntry[]; goal: number | null }) {
  const sorted = useMemo(() => sortAsc(entries), [entries])
  const latest = sorted.length > 0 ? sorted[sorted.length - 1]! : null
  const rate = useMemo(() => trailingRateKgPerWeek(sorted), [sorted])
  const { phase, intensity } = useMemo(() => classifyPhase(rate), [rate])

  const goalDays = useMemo(
    () => (latest === null ? null : projectGoalDays(latest.weight_kg, goal, rate)),
    [latest, goal, rate],
  )

  const rateLabel = rate === null ? '—' : `${rate >= 0 ? '+' : ''}${rate.toFixed(2)} kg/wk`

  const goalCaption = (() => {
    if (goal === null) return 'No goal set in user profile'
    if (latest === null) return 'Log an entry to see distance'
    const delta = goal - latest.weight_kg
    const dist = `${Math.abs(delta).toFixed(1)} kg to ${goal.toFixed(1)} kg`
    if (Math.abs(delta) < 0.1) return 'Goal reached'
    if (goalDays === null) return `${dist} · trending away`
    if (goalDays === 0) return 'Goal reached'
    return `${dist} · ${formatEta(goalDays)} at current pace`
  })()

  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      <Col xs={24} sm={8}>
        <HeroCard
          label="Current"
          tooltip={TOOLTIPS.current}
          value={latest === null ? '—' : `${latest.weight_kg.toFixed(2)} kg`}
          caption={latest === null ? 'No entries yet' : `Logged ${formatAge(latest.date)}`}
        />
      </Col>
      <Col xs={24} sm={8}>
        <HeroCard
          label="Rate of Change"
          tooltip={TOOLTIPS.rate}
          value={rateLabel}
          valueColor={rate === null ? undefined : phaseColor(phase)}
          caption={intensity}
        />
      </Col>
      <Col xs={24} sm={8}>
        <HeroCard
          label="Goal"
          tooltip={TOOLTIPS.goal}
          value={goal === null ? '—' : `${goal.toFixed(1)} kg`}
          caption={goalCaption}
        />
      </Col>
    </Row>
  )
}

// ── Trend Chart ────────────────────────────────────────────────────────────

type ChartPoint = {
  date: string
  weight_kg: number
  ma: number | null
  delta: number | null // vs previous entry
  daysSincePrev: number | null
}

function buildChartData(entries: WeightLogEntry[]): ChartPoint[] {
  const sorted = sortAsc(entries)
  const ma = centeredMA(sorted)
  return sorted.map((e, i) => {
    const prev = i > 0 ? sorted[i - 1]! : null
    return {
      date: e.date,
      weight_kg: e.weight_kg,
      ma: ma.get(e.date) ?? null,
      delta: prev === null ? null : e.weight_kg - prev.weight_kg,
      daysSincePrev: prev === null ? null : dayjs(e.date).diff(dayjs(prev.date), 'day'),
    }
  })
}

function WeightTrendChartInner({
  data,
  width,
  height,
  goal,
}: {
  data: ChartPoint[]
  width: number
  height: number
  goal: number | null
}) {
  const { line } = useVxTheme()
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = useMemo(
    () => scalePoint<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.4 }),
    [data, xMax],
  )

  const yScale = useMemo(() => {
    const vals: number[] = []
    for (const pt of data) {
      vals.push(pt.weight_kg)
      if (pt.ma !== null) vals.push(pt.ma)
    }
    if (goal !== null) vals.push(goal)
    if (vals.length === 0) return scaleLinear<number>({ domain: [0, 100], range: [yMax, 0] })
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.2, 0.5)
    return scaleLinear<number>({ domain: [min - pad, max + pad], range: [yMax, 0], nice: true })
  }, [data, goal, yMax])

  const tooltipStyles = useTooltipStyles()
  const { tip, tooltipRef, syncedPoint, isDirectHover, handleMouse, handleLeave } =
    useHoverSync<ChartPoint>({
      data,
      chartId: 'body-weight-trend',
      getX: (d) => d.date,
      xScale,
      marginLeft: MARGIN.left,
    })

  const tickValues = useMemo(
    () =>
      smartTicks(
        data.map((d) => d.date),
        xMax,
      ),
    [data, xMax],
  )

  const dotR = data.length > 60 ? 2.5 : data.length > 20 ? 3.5 : 4.5

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={5} />

          {/* Goal reference */}
          {goal !== null && (
            <line
              x1={0}
              x2={xMax}
              y1={yScale(goal)}
              y2={yScale(goal)}
              stroke={VX.goodSolid}
              strokeWidth={1.5}
              strokeDasharray="6 6"
              strokeOpacity={0.55}
            />
          )}

          {/* Centered 7-day moving average */}
          {data.some((d) => d.ma !== null) && (
            <LinePath<ChartPoint>
              data={data.filter((d) => d.ma !== null)}
              x={(d) => xScale(d.date) ?? 0}
              y={(d) => yScale(d.ma!)}
              stroke={line}
              strokeWidth={1.5}
              strokeDasharray="5 5"
              strokeOpacity={0.55}
              curve={curveMonotoneX}
            />
          )}

          {/* Raw entries — connected by a thicker line */}
          <LinePath<ChartPoint>
            data={data}
            x={(d) => xScale(d.date) ?? 0}
            y={(d) => yScale(d.weight_kg)}
            stroke={line}
            strokeWidth={2.25}
            curve={curveMonotoneX}
          />

          {/* Dot per entry */}
          {data.map((d) => (
            <circle
              key={`dot-${d.date}`}
              cx={xScale(d.date) ?? 0}
              cy={yScale(d.weight_kg)}
              r={dotR}
              fill={line}
              stroke={VX.dotStroke}
              strokeWidth={1.5}
            />
          ))}

          {/* Crosshair */}
          {syncedPoint !== null &&
            (() => {
              const sx = xScale(syncedPoint.date) ?? 0
              return (
                <>
                  <line x1={sx} x2={sx} y1={0} y2={yMax} stroke={VX.crosshair} strokeWidth={1} />
                  <circle
                    cx={sx}
                    cy={yScale(syncedPoint.weight_kg)}
                    r={VX.dotR}
                    fill={line}
                    stroke={VX.dotStroke}
                    strokeWidth={2}
                  />
                </>
              )
            })()}

          <AxisLeftNumeric scale={yScale} numTicks={5} />
          <AxisBottomDate top={yMax} scale={xScale} tickValues={tickValues} />
          <HoverOverlay width={xMax} height={yMax} onMove={handleMouse} onLeave={handleLeave} />
        </Group>
      </svg>
      <ChartTooltip tip={isDirectHover ? tip : null} tooltipRef={tooltipRef} styles={tooltipStyles}>
        {tip && isDirectHover && (
          <>
            <TooltipHeader date={tip.data.date} />
            <TooltipBody>
              <TooltipRow
                color={line}
                label="Weight"
                value={`${tip.data.weight_kg.toFixed(2)} kg`}
                shape="line"
                strokeWidth={2.25}
              />
              {tip.data.ma !== null && (
                <TooltipRow
                  color={line}
                  label="7-day avg"
                  value={`${tip.data.ma.toFixed(2)} kg`}
                  shape="line"
                  strokeWidth={1.5}
                />
              )}
              {tip.data.delta !== null && tip.data.daysSincePrev !== null && (
                <TooltipRow
                  color={
                    tip.data.delta < 0
                      ? VX.goodSolid
                      : tip.data.delta > 0
                        ? VX.warnSolid
                        : 'rgba(128,128,128,0.5)'
                  }
                  label={`Δ over ${tip.data.daysSincePrev}d`}
                  value={`${tip.data.delta >= 0 ? '+' : ''}${tip.data.delta.toFixed(2)} kg`}
                  shape="line"
                />
              )}
              {goal !== null && (
                <TooltipRow
                  color={VX.goodSolid}
                  label="Goal"
                  value={`${goal.toFixed(1)} kg`}
                  shape="line"
                />
              )}
            </TooltipBody>
          </>
        )}
      </ChartTooltip>
    </div>
  )
}

function WeightTrendChart({ entries, goal }: { entries: WeightLogEntry[]; goal: number | null }) {
  const { line } = useVxTheme()
  const data = useMemo(() => buildChartData(entries), [entries])
  const hasMa = useMemo(() => data.some((d) => d.ma !== null), [data])

  const legendItems = useMemo<LegendEntry[]>(() => {
    const items: LegendEntry[] = [
      { key: 'weight', label: 'Weight', color: line, strokeWidth: 2.25, shape: 'line' },
    ]
    if (hasMa) {
      items.push({
        key: 'ma',
        label: '7-day avg',
        color: line,
        strokeWidth: 1.5,
        shape: 'line',
        dashed: true,
      })
    }
    if (goal !== null) {
      items.push({
        key: 'goal',
        label: 'Goal',
        color: VX.goodSolid,
        strokeWidth: 1.5,
        shape: 'line',
        dashed: true,
      })
    }
    return items
  }, [line, hasMa, goal])

  if (data.length === 0) {
    return (
      <ChartCard
        title="Weight Trend"
        subtitle="What's my body actually doing?"
        tooltip="Raw daily entries (solid line) with a centered 7-day average (dashed). Goal weight overlaid when set in user profile. Hover for delta vs previous entry."
        extra={null}
      >
        <div
          style={{
            height: 320,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.4,
            fontSize: 13,
          }}
        >
          Add your first weight entry to start the trend
        </div>
        <ChartLegend items={legendItems} highlighted={null} onHighlight={() => {}} />
      </ChartCard>
    )
  }

  return (
    <ChartCard
      title="Weight Trend"
      subtitle="What's my body actually doing?"
      tooltip="Raw daily entries (solid line) with a centered 7-day average (dashed). Goal weight overlaid when set in user profile. Hover for delta vs previous entry."
      extra={null}
    >
      <ParentSize>
        {({ width }) => (
          <WeightTrendChartInner data={data} width={width} height={320} goal={goal} />
        )}
      </ParentSize>
      <ChartLegend items={legendItems} highlighted={null} onHighlight={() => {}} />
    </ChartCard>
  )
}

// ── Form ──────────────────────────────────────────────────────────────────

function WeightForm({ entries, onSuccess }: { entries: WeightLogEntry[]; onSuccess: () => void }) {
  const { message } = App.useApp()
  const { mutate, mutation } = useCreate()

  const sorted = useMemo(() => sortAsc(entries), [entries])
  const latest = sorted[sorted.length - 1]

  const [date, setDate] = useState<Dayjs>(dayjs())
  const [weight, setWeight] = useState<number | null>(latest?.weight_kg ?? null)

  const dateStr = date.format('YYYY-MM-DD')
  const existing = useMemo(
    () => entries.find((e) => e.date === dateStr) ?? null,
    [entries, dateStr],
  )

  const handleSubmit = () => {
    if (weight === null || Number.isNaN(weight)) {
      void message.error('Enter a weight')
      return
    }
    if (weight < 30 || weight > 300) {
      void message.error('Weight must be between 30 and 300 kg')
      return
    }
    mutate(
      { resource: 'weight-log', values: { date: dateStr, weight_kg: weight } },
      {
        onSuccess: () => {
          void message.success(`Logged ${weight.toFixed(2)} kg for ${dateStr}`)
          onSuccess()
        },
        onError: (err) => void message.error(`Failed: ${String(err)}`),
      },
    )
  }

  return (
    <Card title="Log Weight" size="small">
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Date
          </Typography.Text>
          <DatePicker
            value={date}
            onChange={(d) => d && setDate(d)}
            style={{ width: '100%', marginTop: 4 }}
            allowClear={false}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            size="large"
          />
        </div>

        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Weight (kg)
          </Typography.Text>
          <InputNumber
            value={weight}
            onChange={(v) => setWeight(v)}
            min={30}
            max={300}
            step={0.05}
            precision={2}
            style={{ width: '100%', marginTop: 4 }}
            size="large"
            placeholder={latest ? latest.weight_kg.toFixed(2) : '70.00'}
          />
        </div>

        {existing !== null && (
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            ⚠ An entry already exists for {dateStr} ({existing.weight_kg.toFixed(2)} kg). Delete the
            row from the table first if you want to replace it.
          </Typography.Text>
        )}

        {latest && weight !== null && (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            Δ vs last ({formatAge(latest.date)}):{' '}
            <span
              style={{
                color:
                  Math.abs(weight - latest.weight_kg) < 0.005
                    ? undefined
                    : weight < latest.weight_kg
                      ? VX.goodSolid
                      : VX.warnSolid,
              }}
            >
              {weight - latest.weight_kg >= 0 ? '+' : ''}
              {(weight - latest.weight_kg).toFixed(2)} kg
            </span>
          </Typography.Text>
        )}

        <Button
          type="primary"
          onClick={handleSubmit}
          loading={mutation.isPending}
          disabled={weight === null || existing !== null}
          style={{ width: '100%' }}
        >
          {existing !== null ? 'Delete existing entry first' : 'Log Entry'}
        </Button>
      </Space>
    </Card>
  )
}

// ── Table ─────────────────────────────────────────────────────────────────

interface TableRow {
  id: number
  date: string
  weight_kg: number
  delta: number | null
  daysSincePrev: number | null
}

function WeightTable({
  entries,
  isLoading,
  onMutate,
}: {
  entries: WeightLogEntry[]
  isLoading: boolean
  onMutate: () => void
}) {
  const { message } = App.useApp()
  const { mutate: deleteMutate } = useDelete()

  const rows = useMemo<TableRow[]>(() => {
    const asc = sortAsc(entries)
    const withDeltas = asc.map((e, i) => {
      const prev = i > 0 ? asc[i - 1]! : null
      return {
        id: e.id,
        date: e.date,
        weight_kg: e.weight_kg,
        delta: prev === null ? null : e.weight_kg - prev.weight_kg,
        daysSincePrev: prev === null ? null : dayjs(e.date).diff(dayjs(prev.date), 'day'),
      }
    })
    return withDeltas.reverse()
  }, [entries])

  const handleDelete = useCallback(
    (id: number) => {
      deleteMutate(
        { resource: 'weight-log', id },
        {
          onSuccess: () => {
            void message.success('Entry deleted')
            onMutate()
          },
          onError: (err) => void message.error(`Failed: ${String(err)}`),
        },
      )
    },
    [deleteMutate, message, onMutate],
  )

  const columns = [
    {
      title: 'Date',
      dataIndex: 'date',
      sorter: (a: TableRow, b: TableRow) => a.date.localeCompare(b.date),
      defaultSortOrder: 'descend' as const,
      render: (date: string) => (
        <Space size={6}>
          <span>{dayjs(date).format('MMM D, YYYY')}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {formatAge(date)}
          </Typography.Text>
        </Space>
      ),
      width: 200,
    },
    {
      title: 'Weight',
      dataIndex: 'weight_kg',
      render: (v: number) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(2)} kg</span>
      ),
      sorter: (a: TableRow, b: TableRow) => a.weight_kg - b.weight_kg,
      width: 110,
    },
    {
      title: 'Δ',
      dataIndex: 'delta',
      render: (v: number | null) => {
        if (v === null) return <Typography.Text type="secondary">—</Typography.Text>
        const color = v < 0 ? VX.goodSolid : v > 0 ? VX.warnSolid : 'rgba(128,128,128,0.6)'
        return (
          <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
            {v >= 0 ? '+' : ''}
            {v.toFixed(2)} kg
          </span>
        )
      },
      width: 110,
    },
    {
      title: 'Gap',
      dataIndex: 'daysSincePrev',
      render: (v: number | null) =>
        v === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text type={v > 7 ? 'warning' : undefined} style={{ fontSize: 12 }}>
            {v}d
          </Typography.Text>
        ),
      width: 80,
    },
    {
      title: '',
      width: 50,
      render: (_: unknown, record: TableRow) => (
        <Popconfirm
          title={`Delete ${record.weight_kg.toFixed(2)} kg from ${dayjs(record.date).format('MMM D')}?`}
          onConfirm={() => handleDelete(record.id)}
          okText="Delete"
          okType="danger"
        >
          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ]

  return (
    <Card size="small" title="History">
      <Table<TableRow>
        dataSource={rows}
        columns={columns}
        rowKey="id"
        size="small"
        loading={isLoading}
        pagination={{ pageSize: 15, size: 'small', showSizeChanger: false }}
        scroll={{ x: 540 }}
        locale={{ emptyText: 'No entries yet — use the form to add your first one.' }}
      />
    </Card>
  )
}

// ── Top-level view ────────────────────────────────────────────────────────

export function BodyWeightView() {
  const { entries, isLoading, refetch } = useWeightLog()
  const profile = useUserProfile()
  const goal = profile?.goal_weight_kg ?? null

  return (
    <Spin spinning={isLoading}>
      <WeightHero entries={entries} goal={goal} />
      <div style={{ marginBottom: 16 }}>
        <WeightTrendChart entries={entries} goal={goal} />
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <WeightForm entries={entries} onSuccess={refetch} />
        </Col>
        <Col xs={24} lg={16}>
          <WeightTable entries={entries} isLoading={isLoading} onMutate={refetch} />
        </Col>
      </Row>
    </Spin>
  )
}
