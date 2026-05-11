import { useMantineColorScheme } from '@mantine/core'
import { VxThemeProvider } from '@argo/charts'
import type { ReactNode } from 'react'

/**
 * Single bridge between Mantine's color scheme and the theme-agnostic @argo/charts package.
 * This is the ONLY file allowed to import both @mantine/* and @argo/charts.
 */
export function VxBridge({ children }: { children: ReactNode }) {
  const { colorScheme } = useMantineColorScheme()
  const resolved = colorScheme === 'auto' ? 'dark' : colorScheme
  return <VxThemeProvider colorScheme={resolved}>{children}</VxThemeProvider>
}
