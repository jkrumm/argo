import { Text, UnstyledButton } from '@mantine/core'
import type { MouseEvent, ReactNode } from 'react'
import classes from './app-mobile-nav.module.css'

/**
 * Mobile bottom tab bar for the primary destinations. Rendered inside an `AppShell.Footer`
 * (`hiddenFrom="sm"`, height collapsed to 0 on desktop) so it only appears below the navbar
 * breakpoint. Reuses the typed nav handlers from `__root.tsx`; active state is a neutral fill, never
 * the identity blue ("ink earns its color", DESIGN.md). The full grouped nav still lives in the
 * burger drawer.
 */

export type MobileNavItem = {
  key: string
  short: string
  icon: ReactNode
  href?: string
  active?: boolean
  onClick?: (e: MouseEvent) => void
}

export function MobileNav({ items }: { items: MobileNavItem[] }) {
  return (
    <nav className={classes.bar}>
      {items.map((item) => {
        const inner = (
          <>
            {item.icon}
            <Text className={classes.label}>{item.short}</Text>
          </>
        )
        // Route tabs are anchors (preloadable, right-click-able); the "Menu" opener is a plain button.
        return item.href ? (
          <UnstyledButton
            key={item.key}
            component="a"
            href={item.href}
            onClick={item.onClick}
            className={classes.tab}
            data-active={item.active || undefined}
            aria-label={item.short}
          >
            {inner}
          </UnstyledButton>
        ) : (
          <UnstyledButton
            key={item.key}
            onClick={item.onClick}
            className={classes.tab}
            data-active={item.active || undefined}
            aria-label={item.short}
          >
            {inner}
          </UnstyledButton>
        )
      })}
    </nav>
  )
}
