import { memo, useEffect, useRef, useState } from 'react'
import { compile } from 'vega-lite'
import * as vega from 'vega'
import { expressionInterpreter } from 'vega-interpreter'
import { useComputedColorScheme } from '@mantine/core'
import classes from './diagram.module.css'
import { useDebouncedDiagram, DiagramError } from './diagram-shared'

// Bundled inline Vega-Lite renderer (Group 4). Replaces the CDN/iframe path in
// diagram-frame.tsx for vega-lite fences.
//
// Security model (no iframe boundary):
//   1. expressionInterpreter: expressions are evaluated via AST interpretation, no
//      Function/eval. opt: { ast: true } makes vega store expressions as AST nodes
//      rather than compiling them to JS — the interpreter walks those nodes.
//   2. Spec sanitization: specs with data.url are rejected outright (no remote data
//      loading). Only inline-data specs (data.values / data.sequence / generated) pass.
//   3. Vega generates SVG programmatically — no path from user data to <script> tags.
//
// Theme colors read from live CSS vars so diagrams re-theme on color-scheme toggle.
// Source is debounced to avoid thrashing compile+render while a fence is streaming.

// On-palette series hues (same set as the retired diagram-frame.tsx).
const SERIES_VARS = [
  '--vx-hrv',
  '--vx-restingHr',
  '--vx-calories',
  '--vx-vo2max',
  '--vx-squat',
  '--vx-spo2',
]

function readThemeColors() {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  return {
    text: v('--mantine-color-text'),
    dimmed: v('--mantine-color-dimmed'),
    border: v('--mantine-color-default-border'),
    font: v('--mantine-font-family') || 'system-ui, sans-serif',
    series: SERIES_VARS.map(v).filter(Boolean),
  }
}

function buildVegaConfig(colors: ReturnType<typeof readThemeColors>) {
  return {
    background: 'transparent',
    font: colors.font,
    title: { color: colors.text },
    axis: {
      domainColor: colors.border,
      gridColor: colors.border,
      tickColor: colors.border,
      labelColor: colors.dimmed,
      titleColor: colors.text,
    },
    legend: { labelColor: colors.dimmed, titleColor: colors.text },
    view: { stroke: 'transparent' },
    ...(colors.series.length ? { range: { category: colors.series } } : {}),
  }
}

// Recursively scan a parsed Vega-Lite spec for remote data sources.
// Any object with a `url` string property is treated as a remote data spec and
// rejected — Vega-Lite's data.url is the only canonical home for URL strings in
// the spec, and loading arbitrary URLs from LLM-generated specs is unsafe.
function hasRemoteDataUrl(node: unknown, depth = 0): boolean {
  if (depth > 20 || node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some((v) => hasRemoteDataUrl(v, depth + 1))
  const obj = node as Record<string, unknown>
  if (typeof obj['url'] === 'string') return true
  return Object.values(obj).some((v) => hasRemoteDataUrl(v, depth + 1))
}

function VegaLiteDiagramImpl({ source }: { source: string }) {
  // colorScheme is a deliberate dep: readThemeColors() reads live CSS vars that
  // change on theme toggle — the effect must re-run to rebuild the Vega config.
  const colorScheme = useComputedColorScheme('dark')

  const [svg, setSvg] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<{ message: string; raw: string } | null>(null)

  // Keep a ref to the active view so it can be finalized on unmount / re-render.
  const viewRef = useRef<vega.View | null>(null)

  const stableSource = useDebouncedDiagram(source)

  useEffect(() => {
    if (!stableSource.trim()) return

    let cancelled = false

    // Finalize any prior view before creating a new one.
    viewRef.current?.finalize()
    viewRef.current = null

    // 1. Parse JSON
    let rawSpec: unknown
    try {
      rawSpec = JSON.parse(stableSource)
    } catch {
      setRenderError({ message: 'Invalid Vega-Lite JSON.', raw: stableSource })
      return
    }

    // 2. Sanitize: reject remote data sources
    if (hasRemoteDataUrl(rawSpec)) {
      setRenderError({
        message:
          'Remote data sources (data.url) are not allowed. Use inline data (data.values) instead.',
        raw: stableSource,
      })
      return
    }

    void (async () => {
      try {
        const colors = readThemeColors()
        const config = buildVegaConfig(colors)

        // 3. Compile Vega-Lite → Vega spec
        const { spec: vgSpec } = compile(rawSpec as Parameters<typeof compile>[0])

        // 4. Parse Vega spec with config. ast:true stores expressions as AST nodes
        //    so the interpreter can walk them without Function/eval.
        const runtime = vega.parse(vgSpec, config, { ast: true })

        // 5. Create View with the AST expression interpreter (no eval).
        const view = new vega.View(runtime, {
          expr: expressionInterpreter,
          renderer: 'none',
        })
        viewRef.current = view

        // 6. Evaluate dataflow, then render to SVG string.
        await view.runAsync()
        const svgStr = await view.toSVG()

        if (!cancelled) {
          setSvg(svgStr)
          setRenderError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null)
          setRenderError({
            message: err instanceof Error ? err.message : 'Diagram could not be rendered.',
            raw: stableSource,
          })
        }
      }
    })()

    return () => {
      cancelled = true
      viewRef.current?.finalize()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableSource, colorScheme])

  if (svg) {
    return (
      // Vega generates SVG programmatically — no path from user data to <script>.
      // expressionInterpreter prevents expression injection. dangerouslySetInnerHTML
      // is safe here for the same reason mermaid-diagram.tsx uses it.
      // eslint-disable-next-line react/no-danger
      <div className={classes.root} dangerouslySetInnerHTML={{ __html: svg }} />
    )
  }

  if (renderError) {
    return <DiagramError source={renderError.raw} message={renderError.message} />
  }

  return null
}

export const VegaLiteDiagram = memo(VegaLiteDiagramImpl)
