/**
 * Lighthouse lane — score, LCP, TBT, CLS for three routes, mobile and desktop, median of 3.
 * Drives its own headless Chrome through chrome-launcher (Lighthouse needs a plain CDP port).
 */
import { launch } from 'chrome-launcher'
import { median, withTimeout } from './types'
import type { Lane, Row } from './types'

// Fixed trio, not routes.txt: one landing route and the two heaviest data pages, to bound run time.
const ROUTES = ['/', '/garmin-health', '/strength-tracker']
const RUNS = 3
const RUN_TIMEOUT_MS = 120_000
const METRICS = ['score', 'lcp', 'tbt', 'cls'] as const
type Metric = (typeof METRICS)[number]
/** null = Lighthouse reported no value; never fabricated as 0. */
type Sample = Record<Metric, number | null>

export const lighthouse: Lane = async ({ baseUrl }) => {
  const { default: run } = await import('lighthouse')
  const { default: desktopConfig } = await import('lighthouse/core/config/desktop-config.js')
  const presets = [
    { name: 'mobile', config: undefined },
    { name: 'desktop', config: desktopConfig },
  ] as const

  const chrome = await launch({ chromeFlags: ['--headless=new'] })
  const rows: Row[] = []
  const raw: Record<string, unknown[]> = {}
  try {
    for (const route of ROUTES) {
      for (const preset of presets) {
        const samples: Sample[] = []
        const lhrs: unknown[] = []
        for (let i = 0; i < RUNS; i++) {
          const result = await withTimeout(
            run(
              baseUrl + route,
              {
                port: chrome.port,
                output: 'json',
                logLevel: 'error',
                onlyCategories: ['performance'],
              },
              preset.config,
            ),
            RUN_TIMEOUT_MS,
            `lighthouse ${preset.name} ${route}`,
          )
          const lhr = result?.lhr
          if (!lhr) throw new Error(`lighthouse returned no result for ${route}`)
          lhrs.push(lhr)
          samples.push({
            score:
              lhr.categories['performance']?.score == null
                ? null
                : lhr.categories['performance'].score * 100,
            lcp: lhr.audits['largest-contentful-paint']?.numericValue ?? null,
            tbt: lhr.audits['total-blocking-time']?.numericValue ?? null,
            cls: lhr.audits['cumulative-layout-shift']?.numericValue ?? null,
          })
        }
        const med = (m: Metric): number | null => {
          const present = samples.flatMap((s) => (s[m] === null ? [] : [s[m]]))
          return present.length ? median(present) : null
        }
        const fmt = (v: number | null, digits: number): number | string =>
          v === null ? 'n/a' : Number(v.toFixed(digits))
        const prefix = `${route} ${preset.name}`
        rows.push(
          { metric: `${prefix} score`, value: fmt(med('score'), 0) },
          { metric: `${prefix} LCP`, value: fmt(med('lcp'), 0), unit: 'ms' },
          { metric: `${prefix} TBT`, value: fmt(med('tbt'), 0), unit: 'ms' },
          { metric: `${prefix} CLS`, value: fmt(med('cls'), 3) },
        )
        raw[prefix] = lhrs
      }
    }
  } finally {
    await chrome.kill()
  }
  rows.push({ metric: 'runs per cell (median of)', value: RUNS })
  return { rows, detail: raw }
}
