/** One route × scheme × device: full-height shot, plus card/table crops on desktop. */
import { join } from 'node:path'
import type { Browser } from 'playwright-core'
import { findCrops } from './crops'
import type { Device, RouteResult, Scheme } from './types'

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, mobile: false },
  mobile: { width: 390, height: 844, mobile: true },
} as const
export const SCHEMES: Scheme[] = ['dark', 'light']
export const DEVICES: Device[] = ['desktop', 'mobile']
const NAV_TIMEOUT_MS = 30_000
const MAX_PAGE_HEIGHT = 12_000

/** `/garmin-health` → `garmin-health`; `/` → `root`. */
export const routeSlug = (route: string): string =>
  route.replace(/^\/|\/$/g, '').replace(/[?=]/g, '-') || 'root'

export async function shootAll(
  browser: Browser,
  baseUrl: string,
  routes: string[],
  outDir: string,
): Promise<RouteResult[]> {
  const results = routes.map<RouteResult>((route) => ({
    route,
    slug: routeSlug(route),
    full: {},
    crops: [],
    failures: [],
  }))
  for (const scheme of SCHEMES) {
    for (const device of DEVICES) {
      const vp = VIEWPORTS[device]
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
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
      for (const result of results) {
        const name = `${result.slug}--${scheme}--${device}`
        try {
          await page.goto(baseUrl + result.route, { waitUntil: 'networkidle' })
          await page.evaluate(() => document.fonts.ready.then(() => undefined))
          await page.setViewportSize({ width: vp.width, height: vp.height })
          // The app scrolls inside an inner container, so `fullPage` captures one viewport:
          // grow the viewport to the tallest scroll container instead.
          const contentHeight = await page.evaluate(() =>
            Math.max(
              document.documentElement.scrollHeight,
              ...Array.from(document.querySelectorAll<HTMLElement>('*'))
                .filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY))
                .map((el) => el.scrollHeight),
            ),
          )
          const height = Math.min(Math.max(contentHeight, vp.height), MAX_PAGE_HEIGHT)
          await page.setViewportSize({ width: vp.width, height })
          await page.waitForTimeout(1500)
          const shot = { animations: 'disabled', caret: 'hide' } as const
          await page.screenshot({ path: join(outDir, `${name}.png`), ...shot })
          result.full[`${scheme}--${device}`] = `${name}.png`
          if (device !== 'desktop') continue

          const boxes = await findCrops(page)
          for (const [i, box] of boxes.entries()) {
            if (box.y >= height) continue
            const file = `crops/${result.slug}--${scheme}--${String(i + 1).padStart(2, '0')}-${box.title}.png`
            await page.screenshot({
              path: join(outDir, file),
              clip: { ...box, height: Math.min(box.height, height - box.y) },
              ...shot,
            })
            result.crops.push({ scheme, file })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          result.failures.push(`${name}: ${message.split('\n')[0]}`)
        }
      }
      await context.close()
    }
  }
  return results
}
