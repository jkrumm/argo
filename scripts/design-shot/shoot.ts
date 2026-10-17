/** One route × scheme × device: full-height shot, plus card/table crops on desktop. */
import { resolve, sep } from 'node:path'
import type { Browser, Page } from 'playwright-core'
import { findCrops } from './crops'
import type { Device, RouteResult, Scheme } from './types'

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, mobile: false },
  mobile: { width: 390, height: 844, mobile: true },
} as const
export const SCHEMES: Scheme[] = ['dark', 'light']
export const DEVICES: Device[] = ['desktop', 'mobile']
const NAV_TIMEOUT_MS = 30_000
// DPR 2 × 8000 CSS px = 16000 device px, just under Chromium's ~16384 texture limit.
const MAX_PAGE_HEIGHT = 8000
const MAX_GROW_PASSES = 5

/** Page height needed to show the app's whole scroll region; falls back to the tallest scroll container. */
const measureContent = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const port = document.querySelector<HTMLElement>('[data-basalt-scrollport]')
    if (port) {
      // Page-space bottom of the content: the port sits below the header, and once the viewport
      // outgrows it `scrollHeight` collapses to `clientHeight`, so read the children instead.
      const top = port.getBoundingClientRect().top
      const kids = Math.max(
        0,
        ...Array.from(port.children).map((c) => c.getBoundingClientRect().bottom + port.scrollTop),
      )
      const overflow = port.scrollHeight > port.clientHeight ? top + port.scrollHeight : 0
      return Math.ceil(
        Math.max(kids + parseFloat(getComputedStyle(port).paddingBottom || '0'), overflow),
      )
    }
    return Math.max(
      document.documentElement.scrollHeight,
      ...Array.from(document.querySelectorAll<HTMLElement>('*'))
        .filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY))
        .map((el) => el.scrollHeight),
    )
  })

/** `/garmin-health` → `garmin-health`; `/a?tab=b` → `a-tab-b`; `/` → `root`. Filesystem-safe. */
export const routeSlug = (route: string): string =>
  route.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root'

/** `rel` joined onto `outDir`, refusing anything that resolves outside it. */
function outPath(outDir: string, rel: string): string {
  const root = resolve(outDir)
  const file = resolve(root, rel)
  if (!file.startsWith(root + sep)) throw new Error(`output path escapes the out dir: ${rel}`)
  return file
}

export async function shootAll(
  browser: Browser,
  baseUrl: string,
  routes: string[],
  outDir: string,
): Promise<RouteResult[]> {
  const seen = new Map<string, number>()
  const uniqueSlug = (route: string): string => {
    const base = routeSlug(route)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }
  const results = routes.map<RouteResult>((route) => ({
    route,
    slug: uniqueSlug(route),
    full: {},
    crops: [],
    failures: [],
    notes: [],
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
      try {
        const page = await context.newPage()
        page.setDefaultTimeout(NAV_TIMEOUT_MS)
        for (const result of results) {
          const name = `${result.slug}--${scheme}--${device}`
          try {
            const response = await page.goto(baseUrl + result.route, { waitUntil: 'networkidle' })
            if (!response?.ok()) {
              result.failures.push(`${name}: page responded ${response?.status() ?? 'nothing'}`)
              continue
            }
            await page.evaluate(() => document.fonts.ready.then(() => undefined))
            await page.setViewportSize({ width: vp.width, height: vp.height })
            // The app scrolls inside an inner container, so `fullPage` captures one viewport: grow the
            // viewport to the scroll region. Lower sections mount lazily once the viewport grows, so
            // re-measure until the height settles.
            let height: number = vp.height
            let settled = false
            for (let pass = 0; pass < MAX_GROW_PASSES && !settled; pass++) {
              const next = Math.min(
                Math.max(await measureContent(page), vp.height),
                MAX_PAGE_HEIGHT,
              )
              settled = next === height
              height = next
              await page.setViewportSize({ width: vp.width, height })
              await page.waitForTimeout(800)
            }
            if (!settled)
              result.notes.push(`${name}: height never settled after ${MAX_GROW_PASSES} passes`)
            if ((await measureContent(page)) > MAX_PAGE_HEIGHT) {
              result.failures.push(`${name}: truncated at ${MAX_PAGE_HEIGHT}px`)
            }
            await page.waitForTimeout(1500)
            const shot = { animations: 'disabled', caret: 'hide' } as const
            await page.screenshot({ path: outPath(outDir, `${name}.png`), ...shot })
            result.full[`${scheme}--${device}`] = `${name}.png`
            if (device !== 'desktop') continue

            const { boxes, total } = await findCrops(page)
            if (total > boxes.length) {
              result.notes.push(
                `${name}: ${total - boxes.length} crop(s) dropped by the ${boxes.length} cap`,
              )
            }
            for (const [i, box] of boxes.entries()) {
              if (box.y >= height) {
                result.notes.push(`${name}: crop ${i + 1} (${box.title}) is below the shot height`)
                continue
              }
              const file = `crops/${result.slug}--${scheme}--${String(i + 1).padStart(2, '0')}-${box.title}.png`
              await page.screenshot({
                path: outPath(outDir, file),
                clip: {
                  x: box.x,
                  y: box.y,
                  width: box.width,
                  height: Math.min(box.height, height - box.y),
                },
                ...shot,
              })
              result.crops.push({ scheme, file })
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            result.failures.push(`${name}: ${message.split('\n')[0]}`)
          }
        }
      } finally {
        await context.close()
      }
    }
  }
  return results
}
