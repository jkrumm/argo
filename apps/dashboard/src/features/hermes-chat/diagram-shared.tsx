import { useEffect, useState, type ReactNode } from 'react'
import { Code, Stack, Text } from '@mantine/core'
import classes from './diagram.module.css'

/** Debounce a diagram source string with EXACT 250ms delay (preserves existing
 *  streaming-fence throttle behavior). Do NOT switch to useDeferredValue. */
export function useDebouncedDiagram(source: string, delayMs = 250): string {
  const [stable, setStable] = useState(source)
  useEffect(() => {
    const t = setTimeout(() => setStable(source), delayMs)
    return () => clearTimeout(t)
  }, [source, delayMs])
  return stable
}

/** Shared error display for diagram components — dimmed message + raw source in a
 *  Code block. Matches the existing renderError branches in mermaid-diagram.tsx and
 *  vega-lite-diagram.tsx exactly. */
export function DiagramError({
  source,
  message,
  children,
}: {
  source: string
  message: string
  children?: ReactNode
}) {
  return (
    <Stack gap="xs" className={classes.error}>
      <Text size="xs" c="dimmed">
        {message}
      </Text>
      <Code block>{source.replace(/\n$/, '')}</Code>
      {children}
    </Stack>
  )
}
