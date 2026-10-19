/**
 * The page's headline strip: Cost, Tokens, Errors, p95 and Cache hit over a fixed 30 d window (the
 * headline endpoint ignores the page filters), then the billing split as a full-width row. Each cell
 * is `caption · period`, a hero value, one micro-visual and a comparison or target. A failed or
 * missing reading is `—`, never 0.
 */
import { useQuery } from '@tanstack/react-query'
import { Skeleton, Stack, Text } from '@mantine/core'
import { DeltaBadge, Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { NBSP } from '../../lib/format'
import { usageQueries, type Metric } from '../../lib/queries/usage'
import { USAGE_BILLING } from '../../lib/series'
import { useNow } from '../../lib/use-now'
import { dayToDate } from './constants'
import {
  errorDaysLine,
  peakOf,
  billingParts,
  CACHE_HIT_TARGET,
  EM_DASH,
  errorRateReading,
  fmtPct,
  fmtPctBadge,
  fmtPointsBadge,
  fmtSecondsBadge,
  fmtSeconds,
  shortDay,
  fmtShare,
  tokensFormatterFor,
  fmtTokensDay,
  fmtUsdWhole,
  meanOf,
  NO_USAGE_CELL,
  NO_USAGE_STRIP,
  pctDelta,
  errorComparison,
  pointsDelta,
  priorNote,
  recentMean,
  cacheUnderLine,
  D30,
  PRIOR_30D,
  slowerDaysLine,
  dropPartialBucket,
  fullDays,
  STRIP_WINDOW_DAYS,
  windowDays,
  D7,
  secondsDelta,
  secondsQuantity,
  tokensQuantity,
  type BillingPart,
  type Prior,
} from './model'

import { useUsageHeadline } from './use-headline'
import { ErrorBand, Trend, type Daily } from './usage-visuals'

type Headline = NonNullable<ReturnType<typeof useUsageHeadline>['data']>

type Series = { days: Daily[]; loading: boolean; failed: boolean }

/**
 * One metric's last 30 days, full days only: today is still running and would draw as a drop, so
 * every trend, mean, peak and day count below leaves it out. The headline figures are a rolling
 * window and include today.
 */
function useDaily(metric: Metric, now: number): Series {
  const query = useQuery(
    usageQueries.timeseries({ range: '30d', grain: 'day', metric, groupBy: 'none' }),
  )
  const all: Daily[] =
    query.data?.buckets.map((b) => ({
      date: dayToDate(b.bucket),
      value: b.groups['value'] ?? null,
    })) ?? []
  const days = dropPartialBucket(all, now, 'day')
  return { days, loading: query.isPending, failed: query.isError }
}

/** The cell with its readings replaced by the one empty reason. */
const emptied = ({ key, caption, qualifier, info }: StatStripCell): StatStripCell => ({
  key,
  caption,
  ...(qualifier === undefined ? {} : { qualifier }),
  ...(info === undefined ? {} : { info }),
  state: { kind: 'empty', reason: NO_USAGE_CELL },
})

/** What every cell builder reads: the headline (undefined until it loads) and the loading flag. */
type Ctx = { h: Headline | undefined; loading: boolean; now: number }

/** Footer lines, one per row, as the strip's single footer node; a `null` line is skipped. */
const footerOf = (lines: readonly (string | null)[]) => (
  <Stack gap={0}>
    {lines
      .filter((line): line is string => line !== null)
      .map((line, i) => (
        // eslint-disable-next-line react/no-array-index-key -- lines can repeat; order is the identity
        <span key={i}>{line}</span>
      ))}
  </Stack>
)

const meanLine = (text: string | null) =>
  text === null ? 'mean —' : `mean ${text}, full${NBSP}days`

/** `peak day $12, 3 Oct`: the busiest day of the series, or `null` without a reading. */
function peakLine(days: readonly Daily[], format: (v: number) => string): string | null {
  const peak = peakOf(days)
  return peak === null || peak.value === null
    ? null
    : `peak day ${format(peak.value)}, ${shortDay(peak.date)}`
}

/**
 * One comparison against the prior window: the badge carries the delta (glyph, verdict ink, period),
 * the footer note only the states where there is no badge to read.
 */
function compare({
  h,
  current,
  prior,
  delta,
  format,
  polarity,
}: {
  h: Headline | undefined
  current: number | null | undefined
  prior: Prior
  delta: (current: number | null, prior: number | null) => number | null
  format: (v: number) => string
  polarity: 'up-bad' | 'neutral'
}) {
  const value = h === undefined ? null : delta(current ?? null, prior ?? null)
  return {
    delta:
      value === null ? undefined : (
        <DeltaBadge value={value} format={format} polarity={polarity} period={PRIOR_30D} />
      ),
    note: h === undefined ? EM_DASH : priorNote(current, prior, delta),
  }
}

function costCell({ h, loading, now }: Ctx, cost: Series): StatStripCell {
  const full = fullDays(cost.days, now)
  const mean = meanOf(full.map((d) => d.value))
  const vs = compare({
    h,
    current: h?.costUsd30d,
    prior: h?.costUsdPrior30d,
    delta: pctDelta,
    format: fmtPctBadge,
    polarity: 'up-bad',
  })
  return {
    key: 'cost',
    caption: 'Cost',
    qualifier: D30,
    info: 'Spend in US dollars over the last 30 days against the 30 days before.',
    value: fmtUsdWhole(h?.costUsd30d),
    delta: vs.delta,
    loading,
    visual: (
      <Trend
        label="Cost per day over the last 30 days"
        days={windowDays(cost.days, now, STRIP_WINDOW_DAYS)}
        loading={cost.loading}
        format={fmtUsdWhole}
      />
    ),
    footer: footerOf([
      meanLine(mean === null ? null : `${fmtUsdWhole(mean)} a day`),
      peakLine(full, fmtUsdWhole),
      vs.note,
    ]),
  }
}

function tokensCell({ h, loading, now }: Ctx, tokens: Series): StatStripCell {
  const qty = tokensQuantity(h?.tokens30d)
  const full = fullDays(tokens.days, now)
  const mean = meanOf(full.map((d) => d.value))
  // Mean and peak are compared by eye: one magnitude, taken from the larger of the two.
  const perDay = tokensFormatterFor(Math.max(mean ?? 0, peakOf(full)?.value ?? 0))
  const vs = compare({
    h,
    current: h?.tokens30d,
    prior: h?.tokensPrior30d,
    delta: pctDelta,
    format: fmtPctBadge,
    polarity: 'neutral',
  })
  return {
    key: 'tokens',
    caption: 'Tokens',
    qualifier: D30,
    info: 'Tokens the models read and wrote over the last 30 days; tokens re-read from the cache are not counted.',
    value: qty.value,
    ...(qty.unit ? { unit: qty.unit } : {}),
    delta: vs.delta,
    loading,
    visual: (
      <Trend
        label="Tokens per day over the last 30 days"
        days={windowDays(tokens.days, now, STRIP_WINDOW_DAYS)}
        loading={tokens.loading}
        format={fmtTokensDay}
      />
    ),
    footer: footerOf([
      meanLine(mean === null ? null : `${perDay(mean)} a day`),
      peakLine(full, perDay),
      vs.note,
    ]),
  }
}

function errorsCell({ h, loading, now }: Ctx, errors: Series): StatStripCell {
  const vs =
    h === undefined
      ? { value: null, note: EM_DASH }
      : errorComparison({
          current: h.errorRate30d,
          prior: h.errorRatePrior30d,
          calls: h.calls30d,
        })
  return {
    key: 'errors',
    caption: 'Errors',
    qualifier: D30,
    value: errorRateReading(h?.errorRate30d, h?.calls30d),
    ...(h?.calls30d === 0 ? {} : { unit: 'of calls' }),
    delta:
      vs.value === null ? undefined : (
        <DeltaBadge value={vs.value} format={fmtPointsBadge} polarity="up-bad" period={PRIOR_30D} />
      ),
    loading,
    visual:
      errors.days.length > 0 ? (
        <ErrorBand days={windowDays(errors.days, now, STRIP_WINDOW_DAYS)} />
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
        ? [vs.note]
        : [errorDaysLine(fullDays(errors.days, now).map((d) => d.value)), vs.note],
    ),
  }
}

function p95Cell({ h, loading, now }: Ctx, p95: Series): StatStripCell {
  const qty = secondsQuantity(h?.p95Ms30d)
  const full = fullDays(p95.days, now)
  const worst = peakOf(full)
  const p95Window = h?.p95Ms30d ?? null
  const vs = compare({
    h,
    current: h?.p95Ms30d,
    prior: h?.p95MsPrior30d,
    delta: secondsDelta,
    format: fmtSecondsBadge,
    polarity: 'up-bad',
  })
  return {
    key: 'p95',
    caption: 'p95 latency',
    qualifier: D30,
    info: '95 % of calls finish faster than this; only calls that report a duration count.',
    value: qty.value,
    ...(qty.unit ? { unit: qty.unit } : {}),
    delta: vs.delta,
    loading,
    visual: (
      <Trend
        label="p95 latency per day over the last 30 days"
        days={windowDays(p95.days, now, STRIP_WINDOW_DAYS)}
        loading={p95.loading}
        format={fmtSeconds}
        reference={p95Window ?? undefined}
      />
    ),
    footer: footerOf([
      slowerDaysLine(p95.days, p95Window, now),
      worst === null || worst.value === null
        ? null
        : `slowest day ${fmtSeconds(worst.value)}, ${shortDay(worst.date)}`,
      vs.note,
    ]),
  }
}

function cacheCell({ h, loading, now }: Ctx, cache: Series): StatStripCell {
  const ratio = h?.cacheHitRatio30d ?? null
  const recent = recentMean(cache.days.map((d) => d.value))
  const delta = pointsDelta(recent, ratio)
  const underLine = cache.failed ? 'daily trend failed to load' : cacheUnderLine(cache.days, now)
  return {
    key: 'cache',
    caption: 'Cache hit',
    qualifier: D30,
    info: 'The share of input tokens served from the prompt cache instead of read fresh; higher is cheaper.',
    value: fmtPct(ratio),
    delta:
      ratio === null || delta === null ? undefined : (
        <DeltaBadge
          value={delta}
          format={fmtPointsBadge}
          polarity="up-good"
          period={`last ${D7} vs ${D30}`}
          periodPrefix=""
        />
      ),
    loading,
    visual:
      ratio === null ? undefined : (
        <Trend
          label="Cache hit ratio per day over the last 30 days"
          days={windowDays(cache.days, now, STRIP_WINDOW_DAYS)}
          loading={cache.loading}
          format={(v) => fmtPct(v)}
          reference={CACHE_HIT_TARGET}
        />
      ),
    footer: footerOf([`target ${fmtPct(CACHE_HIT_TARGET, 0)}`, underLine]),
  }
}

/** A 30 d window without a single call: every cell empties, as the charts do. */
const noUsage = (h: Headline | undefined) => h?.calls30d === 0

const BILLING_COLOR: Record<BillingPart['key'], string> = {
  max: USAGE_BILLING.max,
  iu: USAGE_BILLING.iu,
  other: USAGE_BILLING.unknown,
}

function billingFooter({ h, loading }: Ctx) {
  const parts = h
    ? billingParts({
        max: h.costMaxBilling30d,
        iu: h.costIuBilling30d,
        openrouter: h.costOpenrouterBilling30d,
        total: h.costUsd30d,
      })
    : []
  return {
    key: 'billing',
    content: (
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          Billing split · {D30}
        </Text>
        {loading ? (
          <Skeleton height={28} radius="sm" />
        ) : h === undefined || parts.every((p) => p.value <= 0) ? (
          <Text size="sm" c="dimmed">
            {noUsage(h) ? NO_USAGE_STRIP : `No cost recorded in the last ${D30}`}
          </Text>
        ) : (
          <Meter
            label="Cost by billing lane over the last 30 days"
            max={h.costUsd30d}
            format={(v) => `${fmtUsdWhole(v)} · ${fmtShare(v / h.costUsd30d)}`}
            segments={parts
              .filter((p) => p.value > 0)
              .map((p) => ({ label: p.label, value: p.value, color: BILLING_COLOR[p.key] }))}
          />
        )}
      </Stack>
    ),
  }
}

export function UsageStrip() {
  const headline = useUsageHeadline()
  const now = useNow()
  const cost = useDaily('cost', now)
  const tokens = useDaily('tokens', now)
  const p95 = useDaily('latency_p95', now)
  const errors = useDaily('error_rate', now)
  const cache = useDaily('cache_ratio', now)
  const ctx: Ctx = { h: headline.data, loading: headline.isPending, now }
  const cells = [
    costCell(ctx, cost),
    tokensCell(ctx, tokens),
    errorsCell(ctx, errors),
    p95Cell(ctx, p95),
    cacheCell(ctx, cache),
  ]

  return (
    <StatGroup
      variant="strip"
      label="Usage over the last 30 days"
      cols={5}
      cells={noUsage(ctx.h) ? cells.map(emptied) : cells}
      footer={[billingFooter(ctx)]}
    />
  )
}
