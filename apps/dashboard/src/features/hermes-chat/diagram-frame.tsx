import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useComputedColorScheme } from '@mantine/core'
import classes from './diagram-frame.module.css'

// Mermaid + Vega-Lite, rendered inside a sandboxed `<iframe sandbox="allow-scripts">`
// (no `allow-same-origin` → opaque/null origin: the frame cannot reach this app's
// DOM, cookies, or storage). The diagram library is imported from a pinned CDN
// *inside* the frame, so a malicious diagram (Mermaid CVE-2025-12029 / Vega
// GHSA-7f2v-3qq3-vvjf) executes only in the isolated origin. Theme colors are read
// from the live CSS variables and injected as literals — never raw hex in source.
// The frame reports its content height back via postMessage (the only channel a
// null-origin frame has); we match on `event.source` since the origin reads "null".
// See docs/HERMES-CHAT-PRD.md → Security (sandboxing).

type DiagramKind = 'mermaid' | 'vega-lite'

// Pinned to the versions installed in package.json (Group 1). `vega-embed@7/+esm`
// bundles vega + vega-lite for a single import.
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.esm.min.mjs'
const VEGA_EMBED_URL = 'https://cdn.jsdelivr.net/npm/vega-embed@7.1.0/+esm'

// Distinct, on-palette series hues (read from the VX palette CSS vars) for a
// multi-series Vega chart's categorical range. Blue-anchored + warm accents.
const SERIES_VARS = [
  '--vx-hrv',
  '--vx-restingHr',
  '--vx-calories',
  '--vx-vo2max',
  '--vx-squat',
  '--vx-spo2',
]

type ThemeColors = {
  text: string
  dimmed: string
  border: string
  surface: string
  primary: string
  font: string
  series: string[]
}

function readThemeColors(): ThemeColors {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  return {
    text: v('--mantine-color-text'),
    dimmed: v('--mantine-color-dimmed'),
    border: v('--mantine-color-default-border'),
    surface: v('--mantine-color-default-hover'),
    primary: v('--mantine-primary-color-filled'),
    font: v('--mantine-font-family') || 'system-ui, sans-serif',
    series: SERIES_VARS.map(v).filter(Boolean),
  }
}

function buildSrcDoc(
  kind: DiagramKind,
  source: string,
  frameId: string,
  colors: ThemeColors,
): string {
  // JSON, with `<` escaped so the payload can never break out of the <script>.
  const data = JSON.stringify({ kind, source, frameId, colors }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font-family: ${colors.font || 'system-ui, sans-serif'}; color: ${colors.text}; overflow: hidden; }
  #root { padding: 8px; }
  #root svg { max-width: 100%; height: auto; }
  .diagram-error { padding: 8px 10px; font-size: 13px; color: ${colors.dimmed}; }
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
const DATA = ${data}
const root = document.getElementById('root')

function report() {
  const height = Math.ceil(document.documentElement.scrollHeight)
  parent.postMessage({ source: 'hermes-diagram', frameId: DATA.frameId, height }, '*')
}
function fail(msg) {
  root.innerHTML = ''
  const el = document.createElement('div')
  el.className = 'diagram-error'
  el.textContent = msg
  root.appendChild(el)
  report()
}

async function renderMermaid() {
  const mermaid = (await import(${JSON.stringify(MERMAID_URL)})).default
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: DATA.colors.font,
    themeVariables: {
      background: 'transparent',
      primaryColor: DATA.colors.surface,
      primaryBorderColor: DATA.colors.border,
      primaryTextColor: DATA.colors.text,
      secondaryColor: DATA.colors.surface,
      tertiaryColor: DATA.colors.surface,
      lineColor: DATA.colors.dimmed,
      textColor: DATA.colors.text,
      fontSize: '14px',
    },
  })
  const { svg } = await mermaid.render('d_' + Date.now(), DATA.source)
  root.innerHTML = svg
  report()
}

async function renderVega() {
  let spec
  try {
    spec = JSON.parse(DATA.source)
  } catch {
    fail('Invalid Vega-Lite JSON.')
    return
  }
  const vegaEmbed = (await import(${JSON.stringify(VEGA_EMBED_URL)})).default
  const config = {
    background: 'transparent',
    font: DATA.colors.font,
    title: { color: DATA.colors.text },
    axis: {
      domainColor: DATA.colors.border,
      gridColor: DATA.colors.border,
      tickColor: DATA.colors.border,
      labelColor: DATA.colors.dimmed,
      titleColor: DATA.colors.text,
    },
    legend: { labelColor: DATA.colors.dimmed, titleColor: DATA.colors.text },
    view: { stroke: 'transparent' },
    ...(DATA.colors.series.length ? { range: { category: DATA.colors.series } } : {}),
  }
  await vegaEmbed(root, spec, { actions: false, renderer: 'svg', config })
  report()
}

new ResizeObserver(report).observe(document.documentElement)
window.addEventListener('load', report)
;(DATA.kind === 'mermaid' ? renderMermaid() : renderVega()).catch((e) =>
  fail('Diagram could not be rendered: ' + (e && e.message ? e.message : 'error')),
)
</script>
</body>
</html>`
}

function DiagramFrameImpl({ kind, source }: { kind: DiagramKind; source: string }) {
  const colorScheme = useComputedColorScheme('dark')
  const frameId = useId()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)

  // Debounce the source so a streaming diagram doesn't reload the CDN module on
  // every token (and so partial syntax doesn't flash an error before the fence
  // finishes). `remend` keeps the fence closed mid-stream; this waits for it to settle.
  const [stableSource, setStableSource] = useState(source)
  useEffect(() => {
    const t = setTimeout(() => setStableSource(source), 250)
    return () => clearTimeout(t)
  }, [source])

  // Rebuild when the settled source or the theme flips. `colorScheme` is a
  // deliberate dep: the colors are read from live CSS vars inside readThemeColors,
  // so a theme toggle must re-bake the srcDoc — the linter can't see that DOM read.
  const srcDoc = useMemo(
    () => buildSrcDoc(kind, stableSource, frameId, readThemeColors()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, stableSource, frameId, colorScheme],
  )

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { source?: string; frameId?: string; height?: number }
      if (data?.source !== 'hermes-diagram' || data.frameId !== frameId) return
      if (typeof data.height === 'number' && data.height > 0) {
        setHeight(Math.min(Math.max(data.height, 60), 2000))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [frameId])

  return (
    <iframe
      ref={iframeRef}
      title={`${kind} diagram`}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className={classes.frame}
      style={{ height }}
    />
  )
}

export const DiagramFrame = memo(DiagramFrameImpl)
