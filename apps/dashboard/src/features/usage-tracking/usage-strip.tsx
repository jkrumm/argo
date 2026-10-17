/**
 * The page's headline strip: Cost, Tokens, Errors, p95 and Cache hit over a fixed 30 d window (the
 * headline endpoint ignores the page filters), then the billing split as a full-width row. Each cell
 * is `caption · period`, a hero value, one micro-visual and a comparison or target. A failed or
 * missing reading is `—`, never 0.
 */
import { useQuery } from '@tanstack/react-query'
import { Skeleton, Stack, Text } from '@mantine/core'
import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
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
  errorRateReading,
  fmtPct,
  fmtShare,
  fmtTokens,
  fmtUsdWhole,
  meanOf,
  priorErrorLine,
  priorLine,
  secondsQuantity,
  tokensQuantity,
  type BillingPart,
  type Prior,
} from './model'
import { CacheRing, ErrorBand, Trend, type Daily } from './usage-visuals'

const useHeadline = () => useQuery(usageQueries.headline())
type Headline = NonNullable<ReturnType<typeof useHeadline>['data']>

type Series = { days: Daily[]; loading: boolean; failed: boolean }

function useDaily(metric: 'cost' | 'tokens' | 'latency_p95' | 'error_rate'): Series {
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

/** What every cell builder reads: the headline (undefined until it loads) and the loading flag. */
type Ctx = { h: Headline | undefined; loading: boolean }

/** Footer lines, one per row, as the strip's single footer node. */
const footerOf = (lines: readonly string[]) => (
  <Stack gap={0}>
    {lines.map((line, i) => (
      <span key={i}>{line}</span>
    ))}
  </Stack>
)

const meanLine = (text: string | null, noun = 'mean') =>
  text === null ? `${noun} —` : `30 d ${noun} ${text}`

const priorOf = (
  h: Headline | undefined,
  current: number | null | undefined,
  prior: Prior,
  delta: (c: number | null, p: number | null) => string | null,
) => (h === undefined ? EM_DASH : priorLine(current, prior, delta))

function costCell({ h, loading }: Ctx, cost: Series): StatStripCell {
  const mean = meanOf(cost.days.map((d) => d.value))
  return {
    key: 'cost',
    caption: 'Cost',
    qualifier: '30 d',
    value: fmtUsdWhole(h?.costUsd30d),
    loading,
    visual: (
      <Trend label="Cost per day over the last 30 days" days={cost.days} loading={cost.loading} />
    ),
    footer: footerOf([
      meanLine(mean === null ? null : `${fmtUsdWhole(mean)} a day`),
      priorOf(h, h?.costUsd30d, h?.costUsdPrior30d, deltaPctText),
      `${fmtUsdWhole(h?.costUsd7d)} in the last 7 d`,
    ]),
  }
}

function tokensCell({ h, loading }: Ctx, tokens: Series): StatStripCell {
  const qty = tokensQuantity(h?.tokens30d)
  const mean = meanOf(tokens.days.map((d) => d.value))
  return {
    key: 'tokens',
    caption: 'Tokens',
    qualifier: '30 d',
    value: qty.value,
    ...(qty.unit ? { unit: qty.unit } : {}),
    loading,
    visual: (
      <Trend
        label="Tokens per day over the last 30 days"
        days={tokens.days}
        loading={tokens.loading}
      />
    ),
    footer: footerOf([
      meanLine(mean === null ? null : `${fmtTokens(mean)} a day`),
      priorOf(h, h?.tokens30d, h?.tokensPrior30d, deltaPctText),
      h ? `${h.sourcesActive} sources` : EM_DASH,
      'cache reads excluded',
    ]),
  }
}

function errorsCell({ h, loading }: Ctx, errors: Series): StatStripCell {
  const priorError = h === undefined ? EM_DASH : priorErrorLine(h.errorRatePrior30d)
  return {
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
  }
}

function p95Cell({ h, loading }: Ctx, p95: Series): StatStripCell {
  const qty = secondsQuantity(h?.p95Ms30d)
  const mean = meanOf(p95.days.map((d) => d.value))
  return {
    key: 'p95',
    caption: 'p95 latency',
    qualifier: '30 d',
    value: qty.value,
    ...(qty.unit ? { unit: qty.unit } : {}),
    loading,
    visual: (
      <Trend
        label="p95 latency per day over the last 30 days"
        days={p95.days}
        loading={p95.loading}
      />
    ),
    footer: footerOf([
      meanLine(mean === null ? null : `${secondsQuantity(mean).value} s`, 'mean daily p95'),
      priorOf(h, h?.p95Ms30d, h?.p95MsPrior30d, deltaSecondsText),
    ]),
  }
}

function cacheCell({ h, loading }: Ctx): StatStripCell {
  const ratio = h?.cacheHitRatio30d ?? null
  return {
    key: 'cache',
    caption: 'Cache hit',
    qualifier: '30 d',
    value: fmtPct(ratio),
    loading,
    visual: ratio === null ? undefined : <CacheRing ratio={ratio} />,
    footer: footerOf([`target ${fmtPct(CACHE_HIT_TARGET, 0)}`, 'read ÷ (read + input)']),
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
            startCaption={`total ${fmtUsdWhole(h.costUsd30d)}`}
          />
        )}
      </Stack>
    ),
  }
}

export function UsageStrip() {
  const headline = useHeadline()
  const cost = useDaily('cost')
  const tokens = useDaily('tokens')
  const p95 = useDaily('latency_p95')
  const errors = useDaily('error_rate')
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
        cacheCell(ctx),
      ]}
      footer={[billingFooter(ctx)]}
    />
  )
}
