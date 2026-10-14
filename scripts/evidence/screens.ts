/** Screens lane — every route × light/dark × desktop/mobile, DPR 1, PNGs into `<rawDir>/screens/`. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import type { Lane } from './types'

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
] as const
const SCHEMES = ['light', 'dark'] as const
const NAV_TIMEOUT_MS = 30_000

/** `/garmin-health` → `garmin-health`; `/` → `root`. */
const routeSlug = (route: string): string => route.replace(/^\/|\/$/g, '') || 'root'

export const screens: Lane = async ({ baseUrl, rawDir, routes }) => {
  const dir = join(rawDir, 'screens')
  await mkdir(dir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  const failed: Array<{ name: string; error: string }> = []
  let count = 0
  try {
    for (const scheme of SCHEMES) {
      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
          colorScheme: scheme,
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
        })
        // Mantine's default storage key — the provider reads it before first paint.
        await context.addInitScript(
          (value) => localStorage.setItem('mantine-color-scheme-value', value),
          scheme,
        )
        const page = await context.newPage()
        page.setDefaultTimeout(NAV_TIMEOUT_MS)
        for (const route of routes) {
          const name = `${routeSlug(route)}--${scheme}--${vp.name}`
          try {
            await page.goto(baseUrl + route, { waitUntil: 'networkidle' })
            await page.evaluate(() => document.fonts.ready.then(() => undefined))
            await page.screenshot({
              path: join(dir, `${name}.png`),
              animations: 'disabled',
              caret: 'hide',
            })
            count++
          } catch (error) {
            failed.push({ name, error: error instanceof Error ? error.message : String(error) })
          }
        }
        await context.close()
      }
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  return {
    rows: [
      { metric: 'routes', value: routes.length },
      { metric: 'screenshots', value: count },
      { metric: 'failed', value: failed.length },
      {
        metric: 'viewports',
        value: VIEWPORTS.map((v) => `${v.name} ${v.width}x${v.height}`).join(', '),
      },
    ],
    detail: { routes, failed },
  }
}
