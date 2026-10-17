/**
 * The page's headline strip: Cost, Tokens, Errors, p95 and Cache hit over a fixed 30 d window (the
 * headline endpoint ignores the page filters), then the billing split as a full-width row. Each cell
 * is `caption · period`, a hero value, one micro-visual and a comparison or target. A failed or
 * missing reading is `—`, never 0.
 */
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Box, Skeleton, Text } from '@mantine/core'
import { Meter } from 'basalt-ui'
import { BandStrip, Sparkline } from 'basalt-ui/charts'
import type { BandSpan } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { usageQueries } from '../../lib/queries/usage'
import { USAGE_BILLING } from '../../lib/series'
import { dayToDate } from './constants'
import {
  badDayCount,
  billingParts,
  CACHE_HIT_TARGET,
  deltaPctText,
  deltaSecondsText,
  EM_DASH,
  ERROR_BAD_ABOVE,
  ERROR_WARN_FROM,
  errorDayState,
  fmtPct,
  fmtShare,
  fmtUsdWhole,
  secondsQuantity,
  tokensQuantity,
  type BillingPart,
} from './model'
import classes from './usage.module.css'

/** A reading that is not a verdict: `Meter`'s neutral fill (`VX.line`) is near-white in dark mode. */
const MUTED_FILL = alpha(VX.muted, 0.35)
const SPARK_HEIGHT = 36
const RING_SIZE = 56
const RING_STROKE = 6

type Daily = { date: Date; value: number | null }

type CellProps = {
  id: string
  caption: string
  qualifier: string
  value: string
  unit?: string | undefined
  loading?: boolean
  visual?: ReactNode
  footer?: ReactNode[]
}

function Cell({
  id,
  caption,
  qualifier,
  value,
  unit,
  loading = false,
  visual,
  footer = [],
}: CellProps) {
  return (
    <Box className={classes.cell} data-shot={`strip-${id}`}>
      <Text className={classes.caption}>
        {caption} <span className={classes.qualifier}>· {qualifier}</span>
      </Text>
      {loading ? (
        <Skeleton height={28} width={96} radius="sm" />
      ) : (
        <div className={classes.reading}>
          <span className={classes.value}>{value}</span>
          {unit ? <span className={classes.unit}>{unit}</span> : null}
        </div>
      )}
      {visual ? <div className={classes.visual}>{visual}</div> : null}
      {footer.length > 0 && (
        <div className={classes.footer}>
          {footer.map((line, i) => (
            <span key={i} className={classes.footerLine}>
              {line}
            </span>
          ))}
        </div>
      )}
    </Box>
  )
}

function useDaily(metric: 'cost' | 'tokens' | 'latency_p95' | 'error_rate') {
  const query = useQuery(
    usageQueries.timeseries({ range: '30d', grain: 'day', metric, groupBy: 'none' }),
  )
  const days: Daily[] =
    query.data?.buckets.map((b) => ({
      date: dayToDate(b.bucket),
      value: b.groups['value'] ?? null,
    })) ?? []
  return { days, loading: query.isPending, failed: query.isError }
}

function Trend({
  label,
  days,
  loading,
}: {
  label: string
  days: readonly Daily[]
  loading: boolean
}) {
  const data = days.flatMap((d) => (d.value === null ? [] : [d.value]))
  return (
    <Sparkline
      ariaLabel={label}
      data={data}
      height={SPARK_HEIGHT}
      emphasizeLast
      state={loading ? { pending: true } : { empty: data.length < 2 }}
    />
  )
}

const vsPrior = (delta: string | null) =>
  delta === null ? 'no prior 30 d to compare' : `${delta} vs prior 30 d`

const BAND_STATES = [
  { key: 'ok', label: 'ok', color: alpha(VX.muted, 0.2) },
  { key: 'warn', label: 'warn', color: VX.warn },
  { key: 'bad', label: 'bad', color: VX.bad },
  { key: 'none', label: 'no calls', color: alpha(VX.muted, 0.06) },
] as const

function ErrorBand({ days }: { days: readonly Daily[] }) {
  return (
    <BandStrip
      ariaLabel="Error rate per day over the last 30 days"
      data={days}
      x={(d) => d.date}
      states={BAND_STATES}
      getBand={(d): BandSpan => ({ state: errorDayState(d.value) })}
      legend={false}
      height={28}
    />
  )
}

/** Hand-drawn ring: basalt's `Meter shape="ring"` takes no target, and this one needs the 60 % tick. */
function CacheRing({ ratio }: { ratio: number }) {
  const c = RING_SIZE / 2
  const r = (RING_SIZE - RING_STROKE) / 2
  const circumference = 2 * Math.PI * r
  const angle = CACHE_HIT_TARGET * 2 * Math.PI
  const at = (radius: number) => ({
    x: c + radius * Math.sin(angle),
    y: c - radius * Math.cos(angle),
  })
  const inner = at(r - RING_STROKE)
  const outer = at(r + RING_STROKE)
  return (
    <svg
      className={classes.ring}
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      role="img"
      aria-label={`Cache hit ${fmtPct(ratio)} against a ${fmtPct(CACHE_HIT_TARGET, 0)} target`}
    >
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={alpha(VX.muted, 0.08)}
        strokeWidth={RING_STROKE}
      />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={ratio < CACHE_HIT_TARGET ? VX.warn : MUTED_FILL}
        strokeWidth={RING_STROKE}
        strokeDasharray={`${circumference * Math.min(1, ratio)} ${circumference}`}
        transform={`rotate(-90 ${c} ${c})`}
      />
      <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={VX.ink} strokeWidth={2} />
    </svg>
  )
}

const BILLING_COLOR: Record<BillingPart['key'], string> = {
  max: USAGE_BILLING.max,
  iu: USAGE_BILLING.iu,
  other: USAGE_BILLING.unknown,
}

const partCaption = (p: BillingPart) => `${p.label} ${fmtUsdWhole(p.value)} · ${fmtShare(p.share)}`

export function UsageStrip() {
  const headline = useQuery(usageQueries.headline())
  const cost = useDaily('cost')
  const tokens = useDaily('tokens')
  const p95 = useDaily('latency_p95')
  const errors = useDaily('error_rate')
  const h = headline.data
  const loading = headline.isPending

  const tokenQty = tokensQuantity(h?.tokens30d)
  const p95Qty = secondsQuantity(h?.p95Ms30d)
  const parts = h
    ? billingParts({
        max: h.costMaxBilling30d,
        iu: h.costIuBilling30d,
        openrouter: h.costOpenrouterBilling30d,
        total: h.costUsd30d,
      })
    : []
  const priorErrors = h?.errorRatePrior30d ?? null
  const ratio = h?.cacheHitRatio30d ?? null

  return (
    <section className={classes.strip} aria-label="Usage over the last 30 days">
      <div className={classes.grid}>
        <Cell
          id="cost"
          caption="Cost"
          qualifier="30 d"
          value={fmtUsdWhole(h?.costUsd30d)}
          loading={loading}
          visual={
            <Trend
              label="Cost per day over the last 30 days"
              days={cost.days}
              loading={cost.loading}
            />
          }
          footer={[
            vsPrior(deltaPctText(h?.costUsd30d ?? null, h?.costUsdPrior30d ?? null)),
            `${fmtUsdWhole(h?.costUsd7d)} in the last 7 d`,
          ]}
        />
        <Cell
          id="tokens"
          caption="Tokens"
          qualifier="30 d"
          value={tokenQty.value}
          unit={tokenQty.unit}
          loading={loading}
          visual={
            <Trend
              label="Tokens per day over the last 30 days"
              days={tokens.days}
              loading={tokens.loading}
            />
          }
          footer={[
            vsPrior(deltaPctText(h?.tokens30d ?? null, h?.tokensPrior30d ?? null)),
            h ? `${h.sourcesActive} sources` : EM_DASH,
            'cache reads excluded',
          ]}
        />
        <Cell
          id="errors"
          caption="Errors"
          qualifier="30 d"
          value={fmtPct(h?.errorRate30d)}
          unit="of calls"
          loading={loading}
          visual={
            errors.days.length > 0 ? (
              <ErrorBand days={errors.days} />
            ) : (
              <Text size="sm" c="dimmed">
                {errors.loading
                  ? EM_DASH
                  : errors.failed
                    ? 'Daily error rate failed to load'
                    : 'No daily error rate yet'}
              </Text>
            )
          }
          footer={
            errors.days.length === 0
              ? [
                  priorErrors === null
                    ? 'no prior 30 d to compare'
                    : `vs ${fmtPct(priorErrors)} prior 30 d`,
                ]
              : [
                  `${badDayCount(errors.days.map((d) => d.value))} bad days · > ${fmtPct(ERROR_BAD_ABOVE, 0)}`,
                  priorErrors === null
                    ? 'no prior 30 d to compare'
                    : `vs ${fmtPct(priorErrors)} prior 30 d`,
                  `warn from ${fmtPct(ERROR_WARN_FROM, 0)} a day`,
                ]
          }
        />
        <Cell
          id="p95"
          caption="p95 latency"
          qualifier="30 d"
          value={p95Qty.value}
          unit={p95Qty.unit}
          loading={loading}
          visual={
            <Trend
              label="p95 latency per day over the last 30 days"
              days={p95.days}
              loading={p95.loading}
            />
          }
          footer={[vsPrior(deltaSecondsText(h?.p95Ms30d ?? null, h?.p95MsPrior30d ?? null))]}
        />
        <Cell
          id="cache"
          caption="Cache hit"
          qualifier="30 d"
          value={fmtPct(ratio)}
          loading={loading}
          visual={ratio === null ? undefined : <CacheRing ratio={ratio} />}
          footer={[`target ${fmtPct(CACHE_HIT_TARGET, 0)}`, 'read ÷ (read + input)']}
        />
        <Box className={classes.billing} data-shot="strip-billing">
          <Text className={classes.caption}>
            Billing split <span className={classes.qualifier}>· 30 d</span>
          </Text>
          {loading ? (
            <Skeleton height={28} radius="sm" />
          ) : h === undefined || parts.every((p) => p.value <= 0) ? (
            <Text size="sm" c="dimmed">
              No cost recorded in the last 30 d
            </Text>
          ) : (
            <>
              <Meter
                label="Cost by billing lane over the last 30 days"
                max={h.costUsd30d}
                format={fmtUsdWhole}
                segments={parts
                  .filter((p) => p.value > 0)
                  .map((p) => ({
                    label: partCaption(p),
                    value: p.value,
                    color: BILLING_COLOR[p.key],
                  }))}
                startCaption={null}
                endCaption={null}
              />
              <div className={classes.billingParts}>
                {parts
                  .filter((p) => p.value >= 0.5)
                  .map((p) => (
                    <span key={p.key} className={classes.billingPart}>
                      <Box component="span" className={classes.swatch} bg={BILLING_COLOR[p.key]} />
                      {partCaption(p)}
                    </span>
                  ))}
                <span className={classes.billingTotal}>total {fmtUsdWhole(h.costUsd30d)}</span>
              </div>
            </>
          )}
        </Box>
      </div>
    </section>
  )
}
