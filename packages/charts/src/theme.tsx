import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { VX } from './tokens'

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

const VxThemeContext = createContext<VxTheme | null>(null)

export function VxThemeProvider({
  colorScheme,
  children,
}: {
  colorScheme: ColorScheme
  children: ReactNode
}) {
  const value = useMemo<VxTheme>(() => {
    const isDark = colorScheme === 'dark'
    return {
      colorScheme,
      line: isDark ? VX.lineDark : VX.lineLight,
      line2: isDark ? VX.line2Dark : VX.line2Light,
      axis: isDark ? VX.axisDark : VX.axisLight,
      axisStroke: isDark ? VX.axisStrokeDark : VX.axisStrokeLight,
      tooltipBg: isDark ? VX.tooltipBgDark : VX.tooltipBgLight,
      tooltipText: isDark ? VX.tooltipTextDark : VX.tooltipTextLight,
      tooltipMuted: isDark ? VX.tooltipMutedDark : VX.tooltipMutedLight,
      tooltipBorder: isDark ? 'none' : `1px solid ${VX.tooltipBorderLight}`,
      tooltipShadow: isDark ? VX.tooltipShadowDark : VX.tooltipShadowLight,
    }
  }, [colorScheme])
  return <VxThemeContext.Provider value={value}>{children}</VxThemeContext.Provider>
}

export function useVxTheme(): VxTheme {
  const ctx = useContext(VxThemeContext)
  if (!ctx) throw new Error('useVxTheme must be used inside <VxThemeProvider>')
  return ctx
}
