/**
 * A PDF drawn in the page with pdf.js, one canvas per page. An `<iframe>` is not enough: iOS Safari
 * shows one page of it and Android none. pdf.js is imported on first use, so only a page that shows
 * a PDF loads it; its decoder and font files are served under `/pdfjs/` (`vite.config.ts`).
 */
import { Box, Loader, Center, Stack, Text } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
// Vite's `?url` import: the default export is the emitted worker's address.
// oxlint-disable-next-line import/default
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import classes from './pdf-viewer.module.css'

/** A canvas is never drawn wider than this: iOS caps the memory all canvases of a page may hold. */
const MAX_CANVAS_PX = 1600

async function openPdf(blob: Blob) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    wasmUrl: '/pdfjs/wasm/',
    cMapUrl: '/pdfjs/cmaps/',
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    iccUrl: '/pdfjs/iccs/',
  })
}

type Opened = { blob: Blob; pdf: PDFDocumentProxy | null; ratio: number }

export function PdfViewer({ blob, title }: { blob: Blob; title: string }) {
  const [opened, setOpened] = useState<Opened | null>(null)
  const { ref, width } = useElementSize()
  // What an earlier blob left behind never shows under a new one.
  const current = opened?.blob === blob ? opened : null
  const failed = current !== null && current.pdf === null
  const pdf = current?.pdf ?? null

  useEffect(() => {
    let stopped = false
    let destroy: (() => Promise<void>) | undefined
    void (async () => {
      try {
        const task = await openPdf(blob)
        destroy = () => task.destroy()
        if (stopped) return void destroy()
        const pdf = await task.promise
        // The first page's shape holds the place of every page until it is drawn.
        const view = (await pdf.getPage(1)).getViewport({ scale: 1 })
        if (!stopped) setOpened({ blob, pdf, ratio: view.height / view.width })
      } catch {
        if (!stopped) setOpened({ blob, pdf: null, ratio: 1 })
      }
    })()
    return () => {
      stopped = true
      void destroy?.()
    }
  }, [blob])

  return (
    <Box ref={ref}>
      {failed ? (
        <Text size="sm" c="dimmed">
          This file could not be shown here. Download it instead.
        </Text>
      ) : pdf === null || current === null || width === 0 ? (
        <Center mih={200}>
          <Loader size="sm" aria-label="Loading the PDF" />
        </Center>
      ) : (
        <Stack gap="xs">
          {Array.from({ length: pdf.numPages }, (_, index) => (
            <PdfPage
              key={index}
              pdf={pdf}
              number={index + 1}
              width={width}
              ratio={current.ratio}
              label={`${title}, page ${index + 1} of ${pdf.numPages}`}
            />
          ))}
        </Stack>
      )}
    </Box>
  )
}

/** One page: drawn while it is near the viewport, its pixels released when it is far from it. */
function PdfPage({
  pdf,
  number,
  width,
  ratio,
  label,
}: {
  pdf: PDFDocumentProxy
  number: number
  width: number
  ratio: number
  label: string
}) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [shape, setShape] = useState(ratio)

  useEffect(() => {
    const node = holder.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '100% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    if (!near) {
      target.width = 0
      target.height = 0
      return
    }
    let stopped = false
    let render: RenderTask | undefined
    void (async () => {
      try {
        const page = await pdf.getPage(number)
        if (stopped) return
        const natural = page.getViewport({ scale: 1 })
        const pixels = Math.min(width * window.devicePixelRatio, MAX_CANVAS_PX)
        const viewport = page.getViewport({ scale: pixels / natural.width })
        target.width = Math.floor(viewport.width)
        target.height = Math.floor(viewport.height)
        setShape(natural.height / natural.width)
        render = page.render({ canvas: target, viewport })
        await render.promise
      } catch {
        // A render cancelled by a resize or by leaving the page: the next one draws it.
      }
    })()
    return () => {
      stopped = true
      render?.cancel()
    }
  }, [near, pdf, number, width])

  return (
    <Box ref={holder} className={classes['page']} style={{ aspectRatio: `1 / ${shape}` }}>
      <canvas ref={canvas} className={classes['canvas']} role="img" aria-label={label} />
    </Box>
  )
}
