import { ActionIcon, Group, Menu, ScrollArea, Text, TextInput, UnstyledButton } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { overlays } from 'basalt-ui/commands'
import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useListWrites } from '../api/lists'
import { reportWriteError } from '../api/mutations'
import type { WatchList } from '../api/types'
import { listTabId, neighbourListPosition, TAB_PANEL_ID, tabDomId } from '../lib/depot-nav'
import type { NavTab } from '../lib/depot-nav'
import { useMenuTrigger } from '../lib/use-menu-trigger'
import type { MenuAt } from '../lib/use-menu-trigger'
import { PointerMenu } from './pointer-menu-popover'
import type { MenuEntry } from './pointer-menu-popover'
import classes from './depot-nav.module.css'

/** Focus for an inline field that opens on its own (no `autoFocus`, which the a11y lint refuses). */
const focusOnMount = (element: HTMLInputElement | null) => element?.focus()

function TabButton({
  tab,
  selected,
  onSelect,
  onMenu,
}: {
  tab: NavTab
  selected: boolean
  onSelect: () => void
  onMenu: (at: MenuAt) => void
}) {
  const trigger = useMenuTrigger(onMenu)
  return (
    <UnstyledButton
      id={tabDomId(tab.id)}
      role="tab"
      aria-selected={selected}
      aria-controls={TAB_PANEL_ID}
      aria-haspopup="menu"
      tabIndex={selected ? 0 : -1}
      className={classes.tab}
      data-active={selected}
      onClick={onSelect}
      {...trigger}
    >
      <Text span size="sm" fw={500}>
        {tab.label}
      </Text>
    </UnstyledButton>
  )
}

/**
 * The tabs across the top of the page: the built-in In depot and Crypto, and one per list of the owner's. A tab's menu
 * (right-click, long-press) renames, moves and deletes a list and hides a built-in; the plus creates a list and
 * brings a hidden built-in back.
 */
export function DepotTabsPanel({
  tabs,
  active,
  lists,
  hidden,
  onSelect,
  onHide,
  onShow,
}: {
  tabs: readonly NavTab[]
  active: string
  lists: readonly WatchList[]
  hidden: readonly NavTab[]
  onSelect: (id: string) => void
  onHide: (id: string) => void
  onShow: (id: string) => void
}) {
  const writes = useListWrites()
  const [menu, setMenu] = useState<{ at: MenuAt; tab: NavTab } | null>(null)
  const [naming, setNaming] = useState<{ listId: number | null } | null>(null)
  const [draft, setDraft] = useState('')

  const onTabKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const at = tabs.findIndex((t) => t.id === active)
    const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    if (next === undefined) return
    onSelect(next.id)
    document.getElementById(tabDomId(next.id))?.focus()
  }

  const save = async () => {
    const name = draft.trim()
    const target = naming
    setNaming(null)
    if (target === null || name === '') return
    try {
      if (target.listId === null) {
        const created = await writes.createList(name)
        onSelect(listTabId(created.id))
      } else if (name !== lists.find((l) => l.id === target.listId)?.name) {
        await writes.renameList(target.listId, name)
      }
    } catch (failure) {
      reportWriteError(failure)
    }
  }

  const onNameKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') setNaming(null)
    if (event.key === 'Enter') void save()
  }

  const confirmDelete = (list: WatchList) => {
    void overlays.confirm({
      title: `Delete the list ${list.name}?`,
      body: <Text size="sm">The list and its entries go. Prices and trades are kept.</Text>,
      confirmLabel: 'Delete list',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        try {
          await writes.deleteList(list.id)
          if (listTabId(list.id) === active) onSelect('')
        } catch (failure) {
          reportWriteError(failure)
        }
      },
    })
  }

  const menuItems = (tab: NavTab): MenuEntry[] => {
    const list = lists.find((l) => l.id === tab.listId)
    if (list === undefined) {
      return [
        { kind: 'item', key: 'hide', label: `Hide ${tab.label}`, onClick: () => onHide(tab.id) },
      ]
    }
    const left = neighbourListPosition(lists, list.id, -1)
    const right = neighbourListPosition(lists, list.id, 1)
    const move = (position: number | null) => () => {
      if (position !== null) void writes.moveList(list.id, position).catch(reportWriteError)
    }
    return [
      {
        kind: 'item',
        key: 'rename',
        label: 'Rename list',
        onClick: () => {
          setDraft(list.name)
          setNaming({ listId: list.id })
        },
      },
      {
        kind: 'item',
        key: 'left',
        label: 'Move left',
        disabled: left === null,
        onClick: move(left),
      },
      {
        kind: 'item',
        key: 'right',
        label: 'Move right',
        disabled: right === null,
        onClick: move(right),
      },
      ...(list.is_default
        ? []
        : [
            { kind: 'divider', key: 'rule' } as const,
            {
              kind: 'item',
              key: 'delete',
              label: 'Delete list',
              danger: true,
              onClick: () => confirmDelete(list),
            } as const,
          ]),
    ]
  }

  return (
    <div className={classes.tabStrip}>
      <ScrollArea type="hover" scrollbars="x" className={classes.tabScroll}>
        <Group role="tablist" aria-label="Lists" wrap="nowrap" gap={2} onKeyDown={onTabKey}>
          {tabs.map((tab) =>
            naming?.listId === tab.listId && tab.listId !== null ? (
              <TextInput
                key={tab.id}
                ref={focusOnMount}
                aria-label="List name"
                maxLength={60}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={onNameKey}
                onBlur={() => setNaming(null)}
              />
            ) : (
              <TabButton
                key={tab.id}
                tab={tab}
                selected={tab.id === active}
                onSelect={() => onSelect(tab.id)}
                onMenu={(at) => setMenu({ at, tab })}
              />
            ),
          )}
        </Group>
      </ScrollArea>
      {naming?.listId === null && (
        <TextInput
          ref={focusOnMount}
          aria-label="New list name"
          placeholder="List name (Enter creates)"
          maxLength={60}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onNameKey}
          onBlur={() => setNaming(null)}
        />
      )}
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" aria-label="New list or show a tab" title="New list">
            <IconPlus size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            onClick={() => {
              setDraft('')
              setNaming({ listId: null })
            }}
          >
            New list
          </Menu.Item>
          {hidden.map((tab) => (
            <Menu.Item key={tab.id} onClick={() => onShow(tab.id)}>
              Show {tab.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      <PointerMenu
        at={menu?.at ?? null}
        items={menu === null ? [] : menuItems(menu.tab)}
        label={menu === null ? 'Tab' : `${menu.tab.label} tab`}
        onClose={() => setMenu(null)}
      />
    </div>
  )
}
