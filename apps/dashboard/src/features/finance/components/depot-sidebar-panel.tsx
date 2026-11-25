import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconDots, IconGripVertical, IconSearch } from '@tabler/icons-react'
import { EmptyState } from 'basalt-ui'
import { useEffect, useRef, useState } from 'react'
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from 'react'
import { useBackfill, useListWrites, useSearch } from '../api/lists'
import { reportWriteError } from '../api/mutations'
import type { SearchHit, WatchList, WatchlistEntry } from '../api/types'
import { eur } from '../lib/format'
import { priceText, signedPercent } from '../lib/depot-chart'
import { quantityDe } from '../lib/depot-number'
import {
  addTargetList,
  awaitsHistory,
  backfillText,
  CRYPTO_TAB,
  groupByKind,
  KIND_WORD,
  kindGroup,
  listTabId,
  neighbourPosition,
  TAB_PANEL_ID,
  tabDomId,
} from '../lib/depot-nav'
import type { KindGroup, NavTab, SidebarItem } from '../lib/depot-nav'
import { useMenuTrigger } from '../lib/use-menu-trigger'
import type { MenuAt } from '../lib/use-menu-trigger'
import { PointerMenu } from './pointer-menu-popover'
import type { MenuEntry } from './pointer-menu-popover'
import classes from './depot-nav.module.css'

const RESULTS_ID = 'depot-search-results'
const hitDomId = (index: number) => `depot-hit-${index}`

/** Focus for an inline field that opens on its own (no `autoFocus`, which the a11y lint refuses). */
const focusOnMount = (element: HTMLInputElement | null) => element?.focus()

const hitDetail = (hit: SearchHit): string =>
  [hit.ticker ?? hit.mnemonic, hit.symbol, hit.detail].filter(Boolean).join(' · ')

type Drag = { symbol: string; group: KindGroup }

export type DepotSidebarProps = {
  tab: NavTab
  lists: readonly WatchList[]
  /** The rows of the tab, as the tab derives them. */
  items: readonly SidebarItem[]
  /** The symbol the main area shows. */
  active: string | null
  pending: boolean
  error: Error | null
  listsError: Error | null
  onPick(symbol: string): void
  /** Open the board of the tab with this row selected. */
  onBoard(symbol: string): void
  /** A search hit was added to a list: show that list's tab with the new row selected. */
  onAdded(symbol: string, tabId: string): void
}

/**
 * The rows of the active tab under their kind headers, a search that adds, and the menu of a row (right-click or
 * long-press): rename, move, remove, open in the board. Rows of a list are dragged by their handle to reorder.
 */
export function DepotSidebarPanel(props: DepotSidebarProps) {
  const { tab, lists, items, active, pending, error, listsError, onPick, onBoard, onAdded } = props
  const writes = useListWrites()
  const list = lists.find((l) => l.id === tab.listId)
  const searchable = tab.id !== CRYPTO_TAB

  const [query, setQuery] = useState('')
  const [debounced] = useDebouncedValue(query, 200)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const search = useSearch(debounced)
  const term = query.trim()
  const hits = debounced.trim().length >= 2 ? (search.data ?? []) : []
  const index = Math.min(highlight, Math.max(hits.length - 1, 0))
  const busy = term !== debounced.trim() || search.isFetching
  const target = addTargetList(lists, tab.id)

  const [menu, setMenu] = useState<{ at: MenuAt; item: SidebarItem } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [over, setOver] = useState<string | null>(null)

  useEffect(() => {
    if (!searchable) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const focused = document.activeElement
      if (
        focused instanceof HTMLElement &&
        (focused.isContentEditable || focused.matches('input, textarea, select'))
      ) {
        return
      }
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchable])

  const pick = async (hit: SearchHit) => {
    if (target === undefined) return
    if (!target.entries.some((e) => e.symbol === hit.symbol)) {
      try {
        await writes.addEntry(target.id, { symbol: hit.symbol })
      } catch (failure) {
        reportWriteError(failure)
        return
      }
    }
    setQuery('')
    setOpen(false)
    onAdded(hit.symbol, listTabId(target.id))
  }

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'Escape') {
      setQuery('')
      setOpen(false)
      return
    }
    if (hits.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight(Math.min(Math.max(index + step, 0), hits.length - 1))
      return
    }
    const hit = hits[index]
    if (event.key === 'Enter' && hit !== undefined) {
      event.preventDefault()
      void pick(hit)
    }
  }

  const saveName = (item: SidebarItem) => {
    const next = draft.trim()
    const displayName = next === '' ? null : next
    setRenaming(null)
    if (list === undefined || displayName === (item.entry?.display_name ?? null)) return
    void writes.renameEntry(list.id, item.symbol, displayName).catch(reportWriteError)
  }

  const moveBy = (item: SidebarItem, step: -1 | 1) => {
    if (list === undefined) return
    const position = neighbourPosition(list.entries, item.symbol, step)
    if (position !== null)
      void writes.moveEntry(list.id, item.symbol, position).catch(reportWriteError)
  }

  const moveToList = async (item: SidebarItem, to: WatchList) => {
    try {
      await writes.addEntry(to.id, {
        symbol: item.symbol,
        ...(item.entry?.display_name != null && { display_name: item.entry.display_name }),
      })
      if (list !== undefined) await writes.removeEntry(list.id, item.symbol)
    } catch (failure) {
      reportWriteError(failure)
    }
  }

  const menuItems = (item: SidebarItem): MenuEntry[] => {
    const others = lists.filter(
      (l) => l.id !== list?.id && !l.entries.some((e) => e.symbol === item.symbol),
    )
    const chooser: MenuEntry = {
      kind: 'sub',
      key: 'to-list',
      label: list === undefined ? 'Add to list' : 'Move to list',
      disabled: others.length === 0,
      items: others.map((l) => ({
        kind: 'item' as const,
        key: `list-${l.id}`,
        label: l.name,
        onClick: () => void moveToList(item, l),
      })),
    }
    const board: MenuEntry = {
      kind: 'item',
      key: 'board',
      label: 'Open in board',
      onClick: () => onBoard(item.symbol),
    }
    if (list === undefined || item.entry === null) return [chooser, board]
    const up = neighbourPosition(list.entries, item.symbol, -1)
    const down = neighbourPosition(list.entries, item.symbol, 1)
    return [
      {
        kind: 'item',
        key: 'rename',
        label: 'Rename',
        onClick: () => {
          setDraft(item.entry?.display_name ?? '')
          setRenaming(item.symbol)
        },
      },
      chooser,
      {
        kind: 'item',
        key: 'up',
        label: 'Move up',
        disabled: up === null,
        onClick: () => moveBy(item, -1),
      },
      {
        kind: 'item',
        key: 'down',
        label: 'Move down',
        disabled: down === null,
        onClick: () => moveBy(item, 1),
      },
      board,
      { kind: 'divider', key: 'rule' },
      {
        kind: 'item',
        key: 'remove',
        label: 'Remove from list',
        danger: true,
        onClick: () => void writes.removeEntry(list.id, item.symbol).catch(reportWriteError),
      },
    ]
  }

  const dropOn = (dest: SidebarItem) => {
    const moving = drag
    setDrag(null)
    setOver(null)
    if (moving === null || list === undefined || dest.entry === null) return
    if (moving.symbol === dest.symbol || moving.group !== kindGroup(dest.kind)) return
    void writes.moveEntry(list.id, moving.symbol, dest.entry.position).catch(reportWriteError)
  }

  const groups = groupByKind(items, (item) => item.kind)
  const emptyText =
    tab.id === 'depot'
      ? 'Nothing held in the depot.'
      : list === undefined
        ? 'No coin stored yet.'
        : 'Empty. Press / and search to add an instrument.'

  return (
    <Stack gap="xs" className={classes.panel} data-depot-sidebar="">
      {searchable && (
        <Popover
          opened={open && term.length >= 2}
          onClose={() => setOpen(false)}
          position="bottom-start"
          width={340}
          trapFocus={false}
          returnFocus={false}
        >
          <Popover.Target>
            <TextInput
              ref={searchRef}
              role="combobox"
              aria-label="Search instruments"
              aria-expanded={open && term.length >= 2}
              aria-controls={RESULTS_ID}
              aria-autocomplete="list"
              aria-activedescendant={hits.length > 0 ? hitDomId(index) : undefined}
              placeholder="Search to add (press /)"
              leftSection={<IconSearch size={16} />}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value)
                setHighlight(0)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onSearchKey}
            />
          </Popover.Target>
          <Popover.Dropdown>
            {search.error !== null && !busy && (
              <Text size="sm" c="red">
                {search.error.message}
              </Text>
            )}
            {busy && hits.length === 0 && (
              <Text size="sm" c="dimmed">
                Searching…
              </Text>
            )}
            {!busy && search.error === null && hits.length === 0 && (
              <Text size="sm" c="dimmed">
                Nothing found
              </Text>
            )}
            {hits.length > 0 && (
              <ScrollArea type="auto" scrollbars="y" className={classes.results}>
                <Stack gap={0} id={RESULTS_ID} role="listbox" aria-label="Search results">
                  {hits.map((hit, i) => (
                    <UnstyledButton
                      key={`${hit.kind}:${hit.symbol}`}
                      id={hitDomId(i)}
                      role="option"
                      aria-selected={i === index}
                      data-active={i === index}
                      className={classes.hit}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void pick(hit)}
                    >
                      <Text size="sm" fw={500} className={classes.name}>
                        {hit.name ?? hit.symbol}
                      </Text>
                      <Group gap="xs" wrap="nowrap">
                        <Badge size="sm" variant="light" color="gray">
                          {KIND_WORD[kindGroup(hit.kind)]}
                        </Badge>
                        <Text size="xs" c="dimmed" className={classes.name}>
                          {hitDetail(hit)}
                          {target?.entries.some((e) => e.symbol === hit.symbol) === true &&
                            ' · on this list'}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  ))}
                </Stack>
              </ScrollArea>
            )}
          </Popover.Dropdown>
        </Popover>
      )}

      <Box
        role="tabpanel"
        id={TAB_PANEL_ID}
        aria-labelledby={tabDomId(tab.id)}
        className={classes.rows}
      >
        {listsError !== null && (
          <EmptyState
            tier="section"
            title="The lists did not load"
            description={listsError.message}
          />
        )}
        {error !== null ? (
          <EmptyState
            tier="section"
            title="The watchlist did not load"
            description={error.message}
          />
        ) : (
          <>
            {pending && (
              <Text size="sm" c="dimmed">
                Loading…
              </Text>
            )}
            {!pending && items.length === 0 && (
              <Text size="sm" c="dimmed">
                {emptyText}
              </Text>
            )}
            {groups.length > 0 && (
              <ScrollArea
                type="auto"
                scrollbars="y"
                className={classes.scroll}
                data-depot-scroll=""
              >
                <Stack gap="xs" aria-label={`${tab.label}: last close and change on the day`}>
                  {groups.map((group) => (
                    <Box key={group.group} role="group" aria-label={group.header}>
                      <Group justify="space-between" className={classes.groupHeader}>
                        <Text span size="xs" fw={600} c="dimmed" tt="uppercase">
                          {group.header}
                        </Text>
                        <Text span size="xs" c="dimmed">
                          {group.items.length}
                        </Text>
                      </Group>
                      <Box className={classes.grid}>
                        {group.items.map((item) =>
                          renaming === item.symbol ? (
                            <TextInput
                              key={item.symbol}
                              ref={focusOnMount}
                              aria-label={`Name of ${item.label}`}
                              placeholder={item.quote.name ?? item.symbol}
                              value={draft}
                              onChange={(event) => setDraft(event.currentTarget.value)}
                              onBlur={() => setRenaming(null)}
                              onKeyDown={(event) => {
                                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                                if (event.key === 'Escape') setRenaming(null)
                                if (event.key === 'Enter') saveName(item)
                              }}
                            />
                          ) : (
                            <EntryRow
                              key={item.symbol}
                              item={item}
                              selected={item.symbol === active}
                              dragging={drag?.symbol === item.symbol}
                              dropTarget={over === item.symbol ? over : null}
                              dropBefore={
                                over === item.symbol &&
                                drag !== null &&
                                (list?.entries.find((e) => e.symbol === drag.symbol)?.position ??
                                  0) > (item.entry?.position ?? 0)
                              }
                              onPick={() => onPick(item.symbol)}
                              onMenu={(at) => setMenu({ at, item })}
                              onMove={(step) => moveBy(item, step)}
                              onDragStart={() =>
                                setDrag({ symbol: item.symbol, group: kindGroup(item.kind) })
                              }
                              onDragEnd={() => {
                                setDrag(null)
                                setOver(null)
                              }}
                              onDragOver={() => {
                                if (drag !== null && drag.group === kindGroup(item.kind))
                                  setOver(item.symbol)
                              }}
                              onDrop={() => dropOn(item)}
                            />
                          ),
                        )}
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </ScrollArea>
            )}
          </>
        )}
      </Box>
      <PointerMenu
        at={menu?.at ?? null}
        items={menu === null ? [] : menuItems(menu.item)}
        label={menu === null ? 'Row' : `Options for ${menu.item.label}`}
        onClose={() => setMenu(null)}
      />
    </Stack>
  )
}

function EntryRow({
  item,
  selected,
  dragging,
  dropTarget,
  dropBefore,
  onPick,
  onMenu,
  onMove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  item: SidebarItem
  selected: boolean
  dragging: boolean
  dropTarget: string | null
  dropBefore: boolean
  onPick(): void
  onMenu(at: MenuAt): void
  onMove(step: -1 | 1): void
  onDragStart(): void
  onDragEnd(): void
  onDragOver(): void
  onDrop(): void
}) {
  const trigger = useMenuTrigger(onMenu)
  const reorderable = item.entry !== null

  const handleStart = (event: ReactDragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.symbol)
    const row = event.currentTarget.closest('[data-row]')
    if (row instanceof HTMLElement) event.dataTransfer.setDragImage(row, 16, 16)
    onDragStart()
  }

  const onKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!reorderable || !event.altKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    onMove(event.key === 'ArrowUp' ? -1 : 1)
  }

  return (
    <Box
      data-row
      data-dragging={dragging}
      data-drop={dropTarget === null ? undefined : dropBefore ? 'before' : 'after'}
      className={classes.row}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      {...trigger}
    >
      {reorderable && (
        <span
          className={classes.handle}
          draggable
          title="Drag to reorder"
          aria-hidden
          onDragStart={handleStart}
          onDragEnd={onDragEnd}
        >
          <IconGripVertical size={14} />
        </span>
      )}
      <UnstyledButton
        className={classes.item}
        data-active={selected}
        aria-pressed={selected}
        aria-haspopup="menu"
        onClick={onPick}
        onKeyDown={onKey}
      >
        <Box className={classes.head}>
          <Text size="sm" fw={500} className={classes.name}>
            {item.label}
          </Text>
          {item.held && item.line === null && (
            <Text span size="xs" c="dimmed">
              held
            </Text>
          )}
        </Box>
        {item.line === null ? (
          <QuoteFigures quote={item.quote} />
        ) : (
          <DepotFigures line={item.line} />
        )}
        <HistoryProgress symbol={item.symbol} quote={item.quote} />
      </UnstyledButton>
      <ActionIcon
        className={classes.more}
        variant="subtle"
        size="sm"
        aria-label={`Options for ${item.label}`}
        aria-haspopup="menu"
        title="Options"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onMenu({ x: rect.left, y: rect.bottom })
        }}
      >
        <IconDots size={14} />
      </ActionIcon>
    </Box>
  )
}

/** The row's own words while the service loads its history: where it stands, in the entry until bars exist. */
function HistoryProgress({ symbol, quote }: { symbol: string; quote: WatchlistEntry }) {
  const missing = awaitsHistory(quote)
  const backfill = useBackfill(missing ? symbol : null, missing)
  if (!missing) return null
  const failed = backfill.data?.state === 'failed'
  return (
    <Text
      span
      size="xs"
      c={failed ? 'red' : 'dimmed'}
      className={classes.name}
      data-shot="depot-backfill"
      aria-live="polite"
    >
      {backfillText(backfill.data)}
    </Text>
  )
}

function DepotFigures({ line }: { line: NonNullable<SidebarItem['line']> }) {
  return (
    <>
      <Box className={classes.figures}>
        <Text span size="xs">
          {line.value_cents === null ? '—' : eur(line.value_cents)}
        </Text>
        <Text span size="xs" c="dimmed">
          {line.share === null ? '—' : `${(line.share * 100).toFixed(1)} %`}
        </Text>
      </Box>
      <Text span size="xs" c="dimmed">
        {`${quantityDe(line.quantity)} units`}
      </Text>
    </>
  )
}

function QuoteFigures({ quote }: { quote: WatchlistEntry }): ReactNode {
  return (
    <Box className={classes.figures}>
      <Text span size="xs" c="dimmed">
        {quote.last_close === null ? '—' : priceText(quote.last_close)}
      </Text>
      <Text
        span
        size="xs"
        {...(quote.day_change_pct !== null && { c: quote.day_change_pct >= 0 ? 'green' : 'red' })}
      >
        {signedPercent(quote.day_change_pct)}
      </Text>
    </Box>
  )
}
