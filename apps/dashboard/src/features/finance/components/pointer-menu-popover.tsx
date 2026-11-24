import { Menu } from '@mantine/core'
import type { MenuAt } from '../lib/use-menu-trigger'
import classes from './depot-menu.module.css'

export type MenuEntry =
  | {
      kind: 'item'
      key: string
      label: string
      onClick: () => void
      danger?: boolean
      disabled?: boolean
    }
  | { kind: 'sub'; key: string; label: string; items: readonly MenuEntry[]; disabled?: boolean }
  | { kind: 'divider'; key: string }

function Entries({ items }: { items: readonly MenuEntry[] }) {
  return (
    <>
      {items.map((entry) => {
        if (entry.kind === 'divider') return <Menu.Divider key={entry.key} />
        if (entry.kind === 'sub') {
          return (
            <Menu.Sub key={entry.key}>
              <Menu.Sub.Target>
                <Menu.Sub.Item disabled={entry.disabled === true}>{entry.label}</Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <Entries items={entry.items} />
              </Menu.Sub.Dropdown>
            </Menu.Sub>
          )
        }
        return (
          <Menu.Item
            key={entry.key}
            disabled={entry.disabled === true}
            {...(entry.danger === true && { color: 'red' })}
            onClick={entry.onClick}
          >
            {entry.label}
          </Menu.Item>
        )
      })}
    </>
  )
}

/**
 * A menu that opens at a point: the right-click, the long-press or the keyboard's menu key of a row. The anchor is an
 * invisible box placed at the point (as CSS variables), so Mantine's own menu does the focus, the keys and the dismissal.
 */
export function PointerMenu({
  at,
  items,
  label,
  onClose,
}: {
  at: MenuAt | null
  items: readonly MenuEntry[]
  label: string
  onClose: () => void
}) {
  return (
    <Menu
      opened={at !== null}
      onChange={(opened) => {
        if (!opened) onClose()
      }}
      position="bottom-start"
      withinPortal
      closeOnItemClick
      trapFocus
      returnFocus
    >
      <Menu.Target>
        <span
          aria-hidden
          className={classes.anchor}
          ref={(element) => {
            if (element === null || at === null) return
            element.style.setProperty('--menu-x', `${at.x}px`)
            element.style.setProperty('--menu-y', `${at.y}px`)
          }}
        />
      </Menu.Target>
      <Menu.Dropdown aria-label={label}>
        <Entries items={items} />
      </Menu.Dropdown>
    </Menu>
  )
}
