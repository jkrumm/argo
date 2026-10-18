/**
 * The page's headline strip: Cost, Tokens, Errors, p95 and Cache hit over a fixed 30 d window (the
 * headline endpoint ignores the page filters), then the billing split as a full-width row. Each cell
 * is `caption · period`, a hero value, one micro-visual and a comparison or target. A failed or
 * missing reading is `—`, never 0.
 */
import { useQuery } from '@tanstack/react-query'
import { Skeleton, Stack, Text } from '@mantine/core'
import { DeltaBadge, Meter, StatGroup, type StatStripCell } from 'basalt-ui'
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
  fmtSecondsDay,
  shortDay,
  fmtShare,
  fmtTokens,
  fmtTokensDay,
  fmtUsdDay,
  fmtUsdWhole,
  meanOf,
  pctDelta,
  errorComparison,
  pointsDelta,
  priorNote,
  recentMean,
  countAgainst,
  dropPartialDay,
  secondsDelta,
  secondsQuantity,
  tokensQuantity,
  type BillingPart,
  type Prior,
} from './model'

import { ErrorBand, Trend, type Daily } from './usage-visuals'

const useHeadline = () => useQuery(usageQueries.headline())
type Headline = NonNullable<ReturnType<typeof useHeadline>['data']>

type Series = { days: Daily[]; loading: boolean; failed: boolean }

/**
 * One metric's last 30 days. A volume metric (given `now`) leaves today out: the running day would
 * draw as a drop and drag the mean down. Ratios and percentiles are not volumes, so they keep it.
 */
function useDaily(metric: Metric, now: number | null = null): Series {
  const query = useQuery(
    usageQueries.timeseries({ range: '30d', grain: 'day', metric, groupBy: 'none' }),
  )
  const all: Daily[] =
    query.data?.buckets.map((b) => ({
      date: dayToDate(b.bucket),
      value: b.groups['value'] ?? null,
    })) ?? []
  const days = now === null ? all : dropPartialDay(all, now)
  return { days, loading: query.isPending, failed: query.isError }
}

/** What every cell builder reads: the headline (undefined until it loads) and the loading flag. */
type Ctx = { h: Headline | undefined; loading: boolean }

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

const meanLine = (text: string | null) => (text === null ? 'mean —' : `30 d mean ${text}`)

/** `peak day $12, 3 Oct`: the busiest day of the series, or `null` without a reading. */
function peakLine(days: readonly Daily[], format: (v: number) => string): string | null {
  const peak = peakOf(days)
  return peak === null || peak.value === null
    ? null
    : `peak day ${format(peak.value)}, ${shortDay.format(peak.date)}`
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
        <DeltaBadge value={value} format={format} polarity={polarity} period="prior 30 d" />
      ),
    note: h === undefined ? EM_DASH : priorNote(current, prior, delta),
  }
}

function costCell({ h, loading }: Ctx, cost: Series): StatStripCell {
  const mean = meanOf(cost.days.map((d) => d.value))
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
    qualifier: '30 d',
    info: 'Spend in US dollars over the last 30 days against the 30 days before. The daily trend and the daily mean leave today out until the day is over.',
    value: fmtUsdWhole(h?.costUsd30d),
    delta: vs.delta,
    loading,
    visual: (
      <Trend
        label="Cost per day over the last 30 days"
        days={cost.days}
        loading={cost.loading}
        format={fmtUsdDay}
      />
    ),
    footer: footerOf([
      meanLine(mean === null ? null : `${fmtUsdWhole(mean)} a day`),
      peakLine(cost.days, fmtUsdWhole),
      vs.note,
    ]),
  }
}

function tokensCell({ h, loading }: Ctx, tokens: Series): StatStripCell {
  const qty = tokensQuantity(h?.tokens30d)
  const mean = meanOf(tokens.days.map((d) => d.value))
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
    qualifier: '30 d',
    info: 'Tokens the models read and wrote over the last 30 days; tokens re-read from the cache are not counted. The daily trend and the daily mean leave today out until the day is over.',
    value: qty.value,
    ...(qty.unit ? { unit: qty.unit } : {}),
    delta: vs.delta,
    loading,
    visual: (
      <Trend
        label="Tokens per day over the last 30 days"
        days={tokens.days}
        loading={tokens.loading}
        format={fmtTokensDay}
      />
    ),
    footer: footerOf([
      meanLine(mean === null ? null : `${fmtTokens(mean)} a day`),
      peakLine(tokens.days, fmtTokens),
      vs.note,
    ]),
  }
}

function errorsCell({ h, loading }: Ctx, errors: Series): StatStripCell {
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
    qualifier: '30 d',
    value: errorRateReading(h?.errorRate30d, h?.calls30d),
    ...(h?.calls30d === 0 ? {} : { unit: 'of calls' }),
    delta:
      vs.value === null ? undefined : (
        <DeltaBadge
          value={vs.value}
          format={fmtPointsBadge}
          polarity="up-bad"
          period="prior 30 d"
        />
      ),
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
        ? [vs.note]
        : [errorDaysLine(errors.days.map((d) => d.value)), vs.note],
    ),
  }
}

function p95Cell({ h, loading }: Ctx, p95: Series): StatStripCell {
  const qty = secondsQuantity(h?.p95Ms30d)
  const worst = peakOf(p95.days)
  const slower =
    h?.p95Ms30d == null
      ? null
      : countAgainst(
          p95.days.map((d) => d.value),
          h.p95Ms30d,
          'above',
        )
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
    qualifier: '30 d',
    info: '95 % of calls finish faster than this; only calls that report a duration count. The big figure covers every call in the 30 days. The trend plots each day’s own p95 against it, the dashed line.',
    value: qty.value,
    ...(qty.unit ? { unit: qty.unit } : {}),
    delta: vs.delta,
    loading,
    visual: (
      <Trend
        label="p95 latency per day over the last 30 days"
        days={p95.days}
        loading={p95.loading}
        format={fmtSecondsDay}
        reference={h?.p95Ms30d ?? undefined}
      />
    ),
    footer: footerOf([
      slower === null || slower.of === 0
        ? null
        : `${slower.count} of ${slower.of} days slower than the 30 d p95`,
      worst === null || worst.value === null
        ? null
        : `slowest day ${secondsQuantity(worst.value).value} s, ${shortDay.format(worst.date)}`,
      vs.note,
    ]),
  }
}

function cacheCell({ h, loading }: Ctx, cache: Series): StatStripCell {
  const ratio = h?.cacheHitRatio30d ?? null
  const recent = recentMean(cache.days.map((d) => d.value))
  const delta = pointsDelta(recent, ratio)
  const under = cache.failed
    ? null
    : countAgainst(
        cache.days.map((d) => d.value),
        CACHE_HIT_TARGET,
        'below',
      )
  return {
    key: 'cache',
    caption: 'Cache hit',
    qualifier: '30 d',
    info: 'The share of input tokens served from the prompt cache instead of read fresh; higher is cheaper. The dashed line is the target.',
    value: fmtPct(ratio),
    delta:
      ratio === null || delta === null ? undefined : (
        <DeltaBadge
          value={delta}
          format={fmtPointsBadge}
          polarity="up-good"
          period="last 7 d vs 30 d"
          periodPrefix=""
        />
      ),
    loading,
    visual:
      ratio === null ? undefined : (
        <Trend
          label="Cache hit ratio per day over the last 30 days"
          days={cache.days}
          loading={cache.loading}
          format={(v) => fmtPct(v)}
          reference={CACHE_HIT_TARGET}
        />
      ),
    footer: footerOf([
      `target ${fmtPct(CACHE_HIT_TARGET, 0)}`,
      cache.failed
        ? 'daily trend failed to load'
        : under === null || under.of === 0
          ? null
          : `${under.count} of ${under.of} days under it`,
    ]),
  }
}

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
              .map((p) => ({ label: p.label, value: p.value, color: BILLING_COLOR[p.key] }))}
            startCaption={`${fmtUsdWhole(h.costUsd30d)} total spend, last 30 d`}
          />
        )}
      </Stack>
    ),
  }
}

export function UsageStrip() {
  const headline = useHeadline()
  const now = useNow()
  const cost = useDaily('cost', now)
  const tokens = useDaily('tokens', now)
  const p95 = useDaily('latency_p95')
  const errors = useDaily('error_rate')
  const cache = useDaily('cache_ratio')
  const ctx: Ctx = { h: headline.data, loading: headline.isPending }

  return (
    <StatGroup
      variant="strip"
      label="Usage over the last 30 days"
      cols={5}
      cells={[
        costCell(ctx, cost),
        tokensCell(ctx, tokens),
        errorsCell(ctx, errors),
        p95Cell(ctx, p95),
        cacheCell(ctx, cache),
      ]}
      footer={[billingFooter(ctx)]}
    />
  )
}
