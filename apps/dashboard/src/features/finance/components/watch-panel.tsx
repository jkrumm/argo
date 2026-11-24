import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Menu,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconDots, IconPencil, IconPlus, IconSearch, IconX } from '@tabler/icons-react'
import { EmptyState } from 'basalt-ui'
import { overlays } from 'basalt-ui/commands'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { useListWrites, useLists, useSearch } from '../api/lists'
import { reportWriteError } from '../api/mutations'
import type {
  DepotPosition,
  SearchHit,
  SeriesInfo,
  WatchList,
  WatchListEntry,
  WatchlistEntry,
} from '../api/types'
import { eur } from '../lib/format'
import { heldRows, priceText, signedPercent } from '../lib/depot-chart'
import type { IndexSeries } from '../lib/index-series'
import {
  addTargetList,
  CRYPTO_TAB,
  cryptoRows,
  DEPOT_TAB,
  defaultTabId,
  depotLines,
  entryLabel,
  INDICES_TAB,
  listTabId,
  resolveTab,
  watchTabs,
} from '../lib/watch-panel'
import { useField } from '../../../lib/use-field'
import { finStore } from '../../../lib/window-stores'
import classes from './watch-panel.module.css'

export type WatchPanelProps = {
  /** Rows of GET /market/watchlist (sync set + held + BTC-USD). */
  entries: readonly WatchlistEntry[]
  /** GET /depot/positions rows; a coin row stands for several instruments. */
  positions: readonly DepotPosition[]
  /** The stored index series the Indices tab lists (already filtered by the page) and what the store holds of each. */
  indices: readonly IndexSeries[]
  catalog: readonly SeriesInfo[]
  /** The isin or index id the chart shows now. */
  active: string | null
  /** Loading / error state of the watchlist query. */
  pending: boolean
  error: Error | null
  /** Choose an instrument, a coin symbol or an index series id (same ids the URL ?isin= takes). */
  onPick(symbol: string): void
}

const PANEL_ID = 'watch-tab-panel'
const RESULTS_ID = 'watch-search-results'
const tabDomId = (id: string) => `watch-tab-${id}`
const hitDomId = (index: number) => `watch-hit-${index}`

/** Focus for an inline field that opens on its own (no `autoFocus`, which the a11y lint refuses). */
const focusOnMount = (element: HTMLInputElement | null) => element?.focus()

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  instrument: 'Instrument',
  coin: 'Coin',
  series: 'Index',
}

/** The first-day caption of an index row, as the depot page names its source. */
const sinceText = (firstDay: string | null | undefined): string =>
  firstDay == null ? '—' : `MSCI · EUR · since ${firstDay.slice(0, 4)}`

export function WatchPanel(props: WatchPanelProps) {
  const { entries, positions, indices, catalog, active, pending, error, onPick } = props
  const lists = useLists()
  const writes = useListWrites()
  const [requested, setTab] = useField(finStore.field.tab)
  const userLists = lists.data ?? []
  const lines = depotLines(entries, positions)
  const held = heldRows(entries, positions)
  const tabs = watchTabs(userLists)
  const tab = resolveTab(tabs, requested, defaultTabId(userLists, lines.length > 0))

  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
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

  useEffect(() => {
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
  }, [])

  const onTabKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const at = tabs.findIndex((t) => t.id === tab)
    const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    if (next === undefined) return
    setTab(next.id)
    document.getElementById(tabDomId(next.id))?.focus()
  }

  const pick = async (hit: SearchHit) => {
    const target = addTargetList(userLists, tab)
    if (target !== undefined && !target.entries.some((e) => e.symbol === hit.symbol)) {
      try {
        await writes.addEntry(target.id, { symbol: hit.symbol })
      } catch (failure) {
        reportWriteError(failure)
        return
      }
    }
    if (target !== undefined) setTab(listTabId(target.id))
    setQuery('')
    setOpen(false)
    onPick(hit.symbol)
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

  const create = async (name: string) => {
    try {
      const list = await writes.createList(name)
      setCreating(false)
      setTab(listTabId(list.id))
    } catch (failure) {
      reportWriteError(failure)
    }
  }

  const onCreateKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') setCreating(false)
    if (event.key !== 'Enter') return
    const name = draft.trim()
    if (name === '') {
      setCreating(false)
      return
    }
    void create(name)
  }

  const body = (() => {
    if (tab === DEPOT_TAB) {
      if (lines.length === 0)
        return (
          <Text size="sm" c="dimmed">
            Nothing held in the depot.
          </Text>
        )
      return (
        <RowsArea label="Held instruments: value and share of the depot">
          {lines.map((line) => (
            <PickRow
              key={line.key}
              label={line.name}
              selected={line.key === active}
              onPick={() => onPick(line.key)}
            >
              <Box className={classes.figures}>
                <Text span size="xs">
                  {line.value_cents === null ? '—' : eur(line.value_cents)}
                </Text>
                <Text span size="xs" c="dimmed">
                  {line.share === null ? '—' : `${(line.share * 100).toFixed(1)} %`}
                </Text>
              </Box>
              <Text span size="xs" c="dimmed">
                {`${line.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} units`}
              </Text>
            </PickRow>
          ))}
        </RowsArea>
      )
    }
    if (tab === CRYPTO_TAB) {
      const coins = cryptoRows(entries)
      if (coins.length === 0)
        return (
          <Text size="sm" c="dimmed">
            No coins on the watchlist.
          </Text>
        )
      return (
        <RowsArea label="Crypto: last close and change on the day">
          {coins.map((coin) => (
            <PickRow
              key={coin.isin}
              label={coin.name ?? coin.isin}
              selected={coin.isin === active}
              aside={held.has(coin.isin) ? 'held' : undefined}
              onPick={() => onPick(coin.isin)}
            >
              <QuoteFigures quote={coin} />
            </PickRow>
          ))}
        </RowsArea>
      )
    }
    if (tab === INDICES_TAB) {
      if (indices.length === 0)
        return (
          <Text size="sm" c="dimmed">
            No index series stored.
          </Text>
        )
      return (
        <RowsArea label="Indices: MSCI net return in euros">
          {indices.map((series) => (
            <PickRow
              key={series.id}
              label={series.name}
              selected={series.id === active}
              onPick={() => onPick(series.id)}
            >
              <Text span size="xs" c="dimmed">
                {sinceText(catalog.find((info) => info.id === series.id)?.first_day)}
              </Text>
            </PickRow>
          ))}
        </RowsArea>
      )
    }
    const list = userLists.find((l) => listTabId(l.id) === tab)
    if (list === undefined) return null
    return (
      <ListBody
        key={tab}
        list={list}
        held={held}
        active={active}
        onPick={onPick}
        onDeleted={() => setTab('')}
      />
    )
  })()

  return (
    <Stack gap="xs" className={classes.panel}>
      <Group wrap="nowrap" gap="xs" align="center">
        <ScrollArea type="hover" scrollbars="x" className={classes.tabScroll}>
          <Group role="tablist" aria-label="Watchlist" wrap="nowrap" gap="xs" onKeyDown={onTabKey}>
            {tabs.map((t) => {
              const selected = t.id === tab
              return (
                <UnstyledButton
                  key={t.id}
                  id={tabDomId(t.id)}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={PANEL_ID}
                  tabIndex={selected ? 0 : -1}
                  className={classes.tab}
                  data-active={selected}
                  onClick={() => setTab(t.id)}
                >
                  <Text span size="sm" fw={500}>
                    {t.label}
                  </Text>
                </UnstyledButton>
              )
            })}
          </Group>
        </ScrollArea>
        <ActionIcon
          variant="subtle"
          aria-label="New list"
          title="New list"
          onClick={() => {
            setDraft('')
            setCreating(true)
          }}
        >
          <IconPlus size={16} />
        </ActionIcon>
      </Group>

      {creating && (
        <TextInput
          ref={focusOnMount}
          aria-label="New list name"
          placeholder="List name (Enter creates, Escape cancels)"
          maxLength={60}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onCreateKey}
        />
      )}

      <Popover
        opened={open && term.length >= 2}
        onClose={() => setOpen(false)}
        position="bottom-start"
        width="target"
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
            placeholder="Search (press /)"
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
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text size="sm" fw={500} className={classes.name}>
                        {hit.name ?? hit.symbol}
                      </Text>
                      <Badge size="sm" variant="light" color="gray">
                        {KIND_LABEL[hit.kind]}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed" className={classes.name}>
                      {[hit.symbol, hit.wkn, hit.ticker, hit.detail].filter(Boolean).join(' · ')}
                    </Text>
                  </UnstyledButton>
                ))}
              </Stack>
            </ScrollArea>
          )}
        </Popover.Dropdown>
      </Popover>

      <Box role="tabpanel" id={PANEL_ID} aria-labelledby={tabDomId(tab)} className={classes.panel}>
        {lists.error !== null && (
          <EmptyState
            tier="section"
            title="The lists did not load"
            description={lists.error.message}
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
            {body}
          </>
        )}
      </Box>
    </Stack>
  )
}

/** A user list: its entries in list order, with rename and removal of the list and of each entry. */
function ListBody({
  list,
  held,
  active,
  onPick,
  onDeleted,
}: {
  list: WatchList
  held: ReadonlySet<string>
  active: string | null
  onPick(symbol: string): void
  onDeleted(): void
}) {
  const writes = useListWrites()
  const [renaming, setRenaming] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const saveListName = () => {
    const name = draft.trim()
    setRenaming(false)
    if (name === '' || name === list.name) return
    void writes.renameList(list.id, name).catch(reportWriteError)
  }

  const saveEntryName = (entry: WatchListEntry) => {
    const next = draft.trim()
    const displayName = next === '' ? null : next
    setEditing(null)
    if (displayName === entry.display_name) return
    void writes.renameEntry(list.id, entry.symbol, displayName).catch(reportWriteError)
  }

  const confirmDelete = () => {
    void overlays.confirm({
      title: 'Delete this list?',
      body: <Text size="sm">The list and its entries go. Prices and trades are kept.</Text>,
      confirmLabel: 'Delete list',
      cancelLabel: 'Cancel',
      onConfirm: () => writes.deleteList(list.id).then(onDeleted, reportWriteError),
    })
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap" gap="xs">
        {renaming ? (
          <TextInput
            ref={focusOnMount}
            aria-label="List name"
            maxLength={60}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Escape') setRenaming(false)
              if (event.key === 'Enter') saveListName()
            }}
          />
        ) : (
          <Text
            size="xs"
            c="dimmed"
          >{`${list.entries.length} ${list.entries.length === 1 ? 'instrument' : 'instruments'}`}</Text>
        )}
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              aria-label={`Options for ${list.name}`}
              title="List options"
            >
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={() => {
                setDraft(list.name)
                setRenaming(true)
              }}
            >
              Rename list
            </Menu.Item>
            {!list.is_default && (
              <Menu.Item color="red" onClick={confirmDelete}>
                Delete list
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>

      {list.entries.length === 0 ? (
        <Text size="sm" c="dimmed">
          Empty. Press / and search to add an instrument.
        </Text>
      ) : (
        <RowsArea label={`${list.name}: last close and change on the day`}>
          {list.entries.map((entry) => {
            const label = entryLabel(entry)
            if (editing === entry.symbol) {
              return (
                <TextInput
                  key={entry.symbol}
                  ref={focusOnMount}
                  aria-label={`Name of ${label}`}
                  placeholder={entry.quote.name ?? entry.symbol}
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return
                    if (event.key === 'Escape') setEditing(null)
                    if (event.key === 'Enter') saveEntryName(entry)
                  }}
                />
              )
            }
            return (
              <Box key={entry.symbol} className={classes.row}>
                <PickRow
                  label={label}
                  selected={entry.symbol === active}
                  aside={held.has(entry.quote.isin) ? 'held' : undefined}
                  onPick={() => onPick(entry.symbol)}
                >
                  <QuoteFigures quote={entry.quote} />
                </PickRow>
                <Group gap={2} wrap="nowrap" className={classes.actions}>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    aria-label={`Rename ${label}`}
                    title="Rename"
                    onClick={() => {
                      setDraft(entry.display_name ?? '')
                      setEditing(entry.symbol)
                    }}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    aria-label={`Remove ${label} from list (prices and trades are kept)`}
                    title="Remove from list (prices and trades are kept)"
                    onClick={() => {
                      void writes.removeEntry(list.id, entry.symbol).catch(reportWriteError)
                    }}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              </Box>
            )
          })}
        </RowsArea>
      )}
    </Stack>
  )
}

/** A scroll region of rows: two columns on a narrow container, one on a wide one. */
function RowsArea({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ScrollArea type="auto" scrollbars="y" className={classes.scroll} aria-label={label}>
      <Box className={classes.grid}>{children}</Box>
    </ScrollArea>
  )
}

function PickRow({
  label,
  selected,
  aside,
  onPick,
  children,
}: {
  label: string
  selected: boolean
  aside?: string | undefined
  onPick(): void
  children: ReactNode
}) {
  return (
    <UnstyledButton
      className={classes.item}
      data-active={selected}
      aria-pressed={selected}
      onClick={onPick}
    >
      <Box className={classes.head}>
        <Text size="sm" fw={500} className={classes.name}>
          {label}
        </Text>
        {aside !== undefined && (
          <Text span size="xs" c="dimmed">
            {aside}
          </Text>
        )}
      </Box>
      {children}
    </UnstyledButton>
  )
}

function QuoteFigures({ quote }: { quote: WatchlistEntry }) {
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
