/**
 * The page's headline strip: Cost, Tokens, Errors, p95 and Cache hit over a fixed 30 d window (the
 * headline endpoint ignores the page filters), then the billing split as a full-width row. Each cell
 * is `caption · period`, a hero value, one micro-visual and a comparison or target. A failed or
 * missing reading is `—`, never 0.
 */
import { useQuery } from '@tanstack/react-query'
import { Skeleton, Stack, Text } from '@mantine/core'
import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
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
  fmtTokens,
  errorRateReading,
  meanOf,
  priorErrorLine,
  priorLine,
  type Prior,
  fmtUsdWhole,
  secondsQuantity,
  tokensQuantity,
  type BillingPart,
} from './model'
import classes from './usage.module.css'

/** The ring's progress arc: not a verdict, and `VX.line` is near-white in dark mode. */
const MUTED_FILL = alpha(VX.muted, 0.35)
const SPARK_HEIGHT = 36
const RING_SIZE = 56
const RING_STROKE = 6

type Daily = { date: Date; value: number | null }

/** Footer lines in one muted line; a stat-strip cell footer is a single node. */
const footerOf = (lines: readonly string[]): string => lines.join(' · ')

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
  const priorOf = (
    current: number | null | undefined,
    prior: Prior,
    delta: (c: number | null, p: number | null) => string | null,
  ) => (h === undefined ? EM_DASH : priorLine(current, prior, delta))
  const costMean = meanOf(cost.days.map((d) => d.value))
  const tokensMean = meanOf(tokens.days.map((d) => d.value))
  const p95Mean = meanOf(p95.days.map((d) => d.value))
  const priorError = h === undefined ? EM_DASH : priorErrorLine(h.errorRatePrior30d)
  const meanLine = (text: string | null, noun = 'mean') =>
    text === null ? `${noun} —` : `30 d ${noun} ${text}`
  const ratio = h?.cacheHitRatio30d ?? null

  const cells: StatStripCell[] = [
    {
      key: 'cost',
      caption: 'Cost',
      qualifier: '30 d',
      value: fmtUsdWhole(h?.costUsd30d),
      loading,
      visual: (
        <Trend label="Cost per day over the last 30 days" days={cost.days} loading={cost.loading} />
      ),
      footer: footerOf([
        meanLine(costMean === null ? null : `${fmtUsdWhole(costMean)} a day`),
        priorOf(h?.costUsd30d, h?.costUsdPrior30d, deltaPctText),
        `${fmtUsdWhole(h?.costUsd7d)} in the last 7 d`,
      ]),
    },
    {
      key: 'tokens',
      caption: 'Tokens',
      qualifier: '30 d',
      value: tokenQty.value,
      ...(tokenQty.unit ? { unit: tokenQty.unit } : {}),
      loading,
      visual: (
        <Trend
          label="Tokens per day over the last 30 days"
          days={tokens.days}
          loading={tokens.loading}
        />
      ),
      footer: footerOf([
        meanLine(tokensMean === null ? null : `${fmtTokens(tokensMean)} a day`),
        priorOf(h?.tokens30d, h?.tokensPrior30d, deltaPctText),
        h ? `${h.sourcesActive} sources` : EM_DASH,
        'cache reads excluded',
      ]),
    },
    {
      key: 'errors',
      caption: 'Errors',
      qualifier: '30 d',
      value: errorRateReading(h?.errorRate30d, h?.calls30d),
      ...(h?.calls30d === 0 ? {} : { unit: 'of calls' }),
      loading,
      visual:
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
        ),
      footer: footerOf(
        errors.days.length === 0
          ? [priorError]
          : [
              `${badDayCount(errors.days.map((d) => d.value))} bad days · > ${fmtPct(ERROR_BAD_ABOVE, 0)}`,
              priorError,
              `warn from ${fmtPct(ERROR_WARN_FROM, 0)} a day`,
            ],
      ),
    },
    {
      key: 'p95',
      caption: 'p95 latency',
      qualifier: '30 d',
      value: p95Qty.value,
      ...(p95Qty.unit ? { unit: p95Qty.unit } : {}),
      loading,
      visual: (
        <Trend
          label="p95 latency per day over the last 30 days"
          days={p95.days}
          loading={p95.loading}
        />
      ),
      footer: footerOf([
        meanLine(p95Mean === null ? null : `${secondsQuantity(p95Mean).value} s`, 'mean daily p95'),
        priorOf(h?.p95Ms30d, h?.p95MsPrior30d, deltaSecondsText),
      ]),
    },
    {
      key: 'cache',
      caption: 'Cache hit',
      qualifier: '30 d',
      value: fmtPct(ratio),
      loading,
      visual: ratio === null ? undefined : <CacheRing ratio={ratio} />,
      footer: footerOf([`target ${fmtPct(CACHE_HIT_TARGET, 0)}`, 'read ÷ (read + input)']),
    },
  ]

  return (
    <StatGroup
      variant="strip"
      label="Usage over the last 30 days"
      cols={5}
      cells={cells}
      footer={[
        {
          key: 'billing',
          content: (
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                Billing split · 30 d
              </Text>
              {loading ? (
                <Skeleton height={28} radius="sm" />
              ) : h === undefined || parts.every((p) => p.value <= 0) ? (
                <Text size="sm" c="dimmed">
                  No cost recorded in the last 30 d
                </Text>
              ) : (
                <Meter
                  label="Cost by billing lane over the last 30 days"
                  max={h.costUsd30d}
                  format={(v) => `${fmtUsdWhole(v)} · ${fmtShare(v / h.costUsd30d)}`}
                  segments={parts
                    .filter((p) => p.value > 0)
                    .map((p) => ({
                      label: p.label,
                      value: p.value,
                      color: BILLING_COLOR[p.key],
                    }))}
                  startCaption={`total ${fmtUsdWhole(h.costUsd30d)}`}
                />
              )}
            </Stack>
          ),
        },
      ]}
    />
  )
}
