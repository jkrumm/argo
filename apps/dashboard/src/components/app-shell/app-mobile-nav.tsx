import { Drawer, NavLink, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconDotsCircleHorizontal } from '@tabler/icons-react'
import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import classes from './app-mobile-nav.module.css'

/**
 * Mobile bottom tab bar for the primary nav groups. Rendered inside an `AppShell.Footer`
 * (`hiddenFrom="sm"`, height collapsed to 0 on desktop) so it only appears below the navbar
 * breakpoint. One tab per group plus a trailing "More" opener; tapping a group tab raises a
 * bottom sheet listing that group's destinations as large tap rows. Active state is a neutral
 * fill, never the identity blue ("ink earns its color", DESIGN.md).
 */

export type MobileNavItem = {
  key: string
  label: string
  icon: ReactNode
  href?: string
  active?: boolean
  onClick?: (e: MouseEvent) => void
}

export type MobileNavSection = {
  key: string
  label: string
  icon: ReactNode
  active: boolean
  items: MobileNavItem[]
}

export function MobileNav({
  sections,
  onOpenMore,
}: {
  sections: MobileNavSection[]
  onOpenMore: () => void
}) {
  // The open group sheet; null = closed. A single Drawer is reused across all groups.
  const [openSection, setOpenSection] = useState<MobileNavSection | null>(null)

  return (
    <>
      <nav className={classes.bar}>
        {sections.map((section) => (
          <UnstyledButton
            key={section.key}
            onClick={() => setOpenSection(section)}
            className={classes.tab}
            data-active={section.active || undefined}
            aria-label={section.label}
          >
            {section.icon}
            <Text className={classes.label}>{section.label}</Text>
          </UnstyledButton>
        ))}
        <UnstyledButton onClick={onOpenMore} className={classes.tab} aria-label="More">
          <IconDotsCircleHorizontal size={22} />
          <Text className={classes.label}>More</Text>
        </UnstyledButton>
      </nav>

      <Drawer
        opened={openSection !== null}
        onClose={() => setOpenSection(null)}
        position="bottom"
        size="auto"
        padding="md"
        title={openSection?.label}
        classNames={{ content: classes.sheet }}
      >
        <Stack gap={2}>
          {openSection?.items.map((item) => {
            const handleClick = (e: MouseEvent) => {
              item.onClick?.(e)
              setOpenSection(null)
            }
            // Items with an href stay anchors so the router can preload them (mirrors the sidebar).
            return item.href ? (
              <NavLink
                key={item.key}
                classNames={{ root: classes.row }}
                component="a"
                href={item.href}
                label={item.label}
                leftSection={item.icon}
                active={item.active}
                onClick={handleClick}
              />
            ) : (
              <UnstyledButton
                key={item.key}
                onClick={handleClick}
                className={classes.row}
                data-active={item.active || undefined}
              >
                {item.icon}
                <Text className={classes.rowLabel}>{item.label}</Text>
              </UnstyledButton>
            )
          })}
        </Stack>
      </Drawer>
    </>
  )
}
