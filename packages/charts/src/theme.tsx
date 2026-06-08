import { createContext, useContext, useMemo, type ReactNode } from 'react'

type ColorScheme = 'light' | 'dark'

export type VxTheme = {
  colorScheme: ColorScheme
  line: string
  line2: string
  axis: string
  axisStroke: string
  tooltipBg: string
  tooltipText: string
  tooltipMuted: string
  tooltipBorder: string
  tooltipShadow: string
}

/**
 * Theme-resolved neutrals are now CSS custom properties (see theme-vars.ts). They resolve per
 * Mantine color scheme in CSS, so these are static var refs — the provider keeps `colorScheme`
 * only for any non-color branching a chart may need.
 */
const REFS = {
  line: 'var(--vx-line)',
  line2: 'var(--vx-line2)',
  axis: 'var(--vx-axis)',
  axisStroke: 'var(--vx-axisStroke)',
  tooltipBg: 'var(--vx-tooltipBg)',
  tooltipText: 'var(--vx-tooltipText)',
  tooltipMuted: 'var(--vx-tooltipMuted)',
  tooltipBorder: 'var(--vx-tooltipBorder)',
  tooltipShadow: 'var(--vx-tooltipShadow)',
} as const

const VxThemeContext = createContext<VxTheme | null>(null)

export function VxThemeProvider({
  colorScheme,
  children,
}: {
  colorScheme: ColorScheme
  children: ReactNode
}) {
  const value = useMemo<VxTheme>(() => ({ colorScheme, ...REFS }), [colorScheme])
  return <VxThemeContext.Provider value={value}>{children}</VxThemeContext.Provider>
}

export function useVxTheme(): VxTheme {
  const ctx = useContext(VxThemeContext)
  if (!ctx) throw new Error('useVxTheme must be used inside <VxThemeProvider>')
  return ctx
}
