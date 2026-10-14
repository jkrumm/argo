/**
 * Lighthouse lane — score, LCP, TBT, CLS for three routes, mobile and desktop, median of 3.
 * Drives its own headless Chrome through chrome-launcher (Lighthouse needs a plain CDP port).
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launch } from 'chrome-launcher'
import { median, withTimeout } from './types'
import type { Lane, Row } from './types'

const ROUTES = ['/', '/garmin-health', '/strength-tracker']
const RUNS = 3
const RUN_TIMEOUT_MS = 120_000
const METRICS = ['score', 'lcp', 'tbt', 'cls'] as const
type Sample = Record<(typeof METRICS)[number], number>

export const lighthouse: Lane = async ({ baseUrl, rawDir }) => {
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
            score: (lhr.categories['performance']?.score ?? 0) * 100,
            lcp: lhr.audits['largest-contentful-paint']?.numericValue ?? 0,
            tbt: lhr.audits['total-blocking-time']?.numericValue ?? 0,
            cls: lhr.audits['cumulative-layout-shift']?.numericValue ?? 0,
          })
        }
        const med = (m: (typeof METRICS)[number]): number => median(samples.map((s) => s[m]))
        const prefix = `${route} ${preset.name}`
        rows.push(
          { metric: `${prefix} score`, value: Math.round(med('score')) },
          { metric: `${prefix} LCP`, value: Math.round(med('lcp')), unit: 'ms' },
          { metric: `${prefix} TBT`, value: Math.round(med('tbt')), unit: 'ms' },
          { metric: `${prefix} CLS`, value: Number(med('cls').toFixed(3)) },
        )
        raw[prefix] = lhrs
      }
    }
  } finally {
    chrome.kill()
  }
  await writeFile(join(rawDir, 'lighthouse.json'), JSON.stringify(raw))
  rows.push({ metric: 'runs per cell (median of)', value: RUNS })
  return { rows }
}
