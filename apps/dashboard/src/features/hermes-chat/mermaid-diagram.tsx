import { memo, useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { Code, Stack, Text, useComputedColorScheme } from '@mantine/core'
import classes from './mermaid-diagram.module.css'

// Bundled inline mermaid renderer (Group 3). Replaces the CDN/iframe path in
// diagram-frame.tsx for mermaid fences. securityLevel:'strict' runs mermaid's
// built-in DOMPurify pass before the SVG is returned, so inline injection is safe
// without an iframe origin boundary. Colors read from live CSS vars so the diagram
// re-themes automatically on color-scheme toggle. Source is debounced to avoid
// thrashing mermaid while a fence is still streaming.

function readMermaidColors() {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  return {
    primaryColor: v('--mantine-color-default-hover'),
    primaryBorderColor: v('--mantine-color-default-border'),
    primaryTextColor: v('--mantine-color-text'),
    lineColor: v('--mantine-color-dimmed'),
    fontFamily: v('--mantine-font-family') || 'system-ui, sans-serif',
  }
}

function MermaidDiagramImpl({ source }: { source: string }) {
  // colorScheme is a deliberate dep: readMermaidColors() reads live CSS vars that
  // change on theme toggle. The effect must re-run so mermaid re-initializes with
  // the new palette — the linter cannot see that DOM read.
  const colorScheme = useComputedColorScheme('dark')

  // Strip non-alphanumeric chars from React's :r0: style id — mermaid uses the
  // render id as a CSS selector internally and chokes on colons.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '')

  // Counter gives each render() call a unique id to avoid DOM id collisions when
  // the effect re-fires before a prior async render completes.
  const renderCounter = useRef(0)

  const [svg, setSvg] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<{ message: string; raw: string } | null>(null)

  // Debounce source so partial streaming fences don't thrash mermaid on every token.
  const [stableSource, setStableSource] = useState(source)
  useEffect(() => {
    const t = setTimeout(() => setStableSource(source), 250)
    return () => clearTimeout(t)
  }, [source])

  useEffect(() => {
    if (!stableSource.trim()) return
    let cancelled = false
    const renderId = `mmd${instanceId}r${String(++renderCounter.current)}`

    const colors = readMermaidColors()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: colors.fontFamily,
      themeVariables: {
        background: 'transparent',
        primaryColor: colors.primaryColor,
        primaryBorderColor: colors.primaryBorderColor,
        primaryTextColor: colors.primaryTextColor,
        secondaryColor: colors.primaryColor,
        tertiaryColor: colors.primaryColor,
        lineColor: colors.lineColor,
        textColor: colors.primaryTextColor,
        fontSize: '14px',
      },
    })

    void (async () => {
      try {
        const { svg: rendered } = await mermaid.render(renderId, stableSource)
        if (!cancelled) {
          setSvg(rendered)
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, stableSource, colorScheme])

  if (svg) {
    return (
      // securityLevel:'strict' sanitizes via mermaid's built-in DOMPurify pass.
      // eslint-disable-next-line react/no-danger
      <div className={classes.root} dangerouslySetInnerHTML={{ __html: svg }} />
    )
  }

  if (renderError) {
    return (
      <Stack gap="xs" className={classes.error}>
        <Text size="xs" c="dimmed">
          {renderError.message}
        </Text>
        <Code block>{renderError.raw.replace(/\n$/, '')}</Code>
      </Stack>
    )
  }

  return null
}

export const MermaidDiagram = memo(MermaidDiagramImpl)
