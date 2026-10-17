import { ColorSwatch } from '@mantine/core'

/**
 * Local copy of basalt's internal `StatusDot` (a 6px round mark that carries colour and nothing
 * else — the meaning always travels as a word beside it). basalt keeps it off every barrel, so
 * argo builds the same mark from a Mantine `ColorSwatch` until it is exported.
 */
export function StatusDot({ color }: { color: string }) {
  return <ColorSwatch size={6} color={color} withShadow={false} aria-hidden />
}
