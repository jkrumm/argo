/** Card/table crop discovery, run in the page. Returns document-space boxes in reading order. */
import type { Page } from 'playwright-core'

export type CropBox = { x: number; y: number; width: number; height: number; title: string }

const MAX_CROPS = 40

export function findCrops(page: Page): Promise<CropBox[]> {
  return page.evaluate((max) => {
    const SELECTOR = '.mantine-Card-root, .mantine-Paper-root, [data-basalt-chart-card], table'
    const MIN_W = 160
    const MIN_H = 80
    const main = document.querySelector('main')
    const mainWidth = (main ?? document.documentElement).getBoundingClientRect().width

    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return (
        s.display !== 'none' && s.visibility !== 'hidden' && r.width >= MIN_W && r.height >= MIN_H
      )
    }
    const pick = (scope: ParentNode): Element[] => {
      const cands = Array.from(scope.querySelectorAll(SELECTOR)).filter(visible)
      const top = cands.filter((c) => !cands.some((o) => o !== c && o.contains(c)))
      return top.flatMap((el) => {
        if (el.getBoundingClientRect().width < mainWidth * 0.9) return [el]
        const inner = pick(el)
        return inner.length ? inner : [el]
      })
    }
    const kebab = (text: string): string =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/g, '')

    return pick(document)
      .slice(0, max)
      .map((el) => {
        const r = el.getBoundingClientRect()
        const heading = el.querySelector('h1, h2, h3, h4, h5, h6, caption, [class*="Title"]')
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          title: kebab(heading?.textContent ?? '') || 'card',
        }
      })
  }, MAX_CROPS)
}
