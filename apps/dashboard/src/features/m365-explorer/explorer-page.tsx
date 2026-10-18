import { PageBar, Section, useSizeClass, PageSummary } from 'basalt-ui'
import { FilterSet, SearchFilter, ViewTabs } from 'basalt-ui/controls'
import { Card } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconTag } from '@tabler/icons-react'
import {
  useIsFetching,
  useMutation,
  useQueries,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { m365Mutations, m365Queries } from '../../lib/queries/m365'
import { shotState } from '../../lib/shot-state'
import { FeedPane } from './feed-pane'
import { LabeledPane } from './labeled-pane'
import {
  CHAT_TYPE_LABEL,
  channelSourceId,
  CHATS_TOP,
  chatKindCounts,
  chatsCapped as isCapped,
  chatSourceId,
  chatTitle,
  chipCounts,
  visibleChipCounts,
  showTagChips,
  coverageOf,
  headlineOf,
  labeledPaneTitle,
  sectionTitleFor,
  parseChannelId,
  largestTeam,
  sourceIdFor,
  tagCountsOf,
  validTag,
  type ChannelState,
  type ChatRow,
  type LabelLite,
  type SourceRef,
} from './model'
import { RecordPane } from './record-pane'
import { SourceList, type TeamRow } from './source-list'
import { ExplorerStrip } from './strip'
import { explorerStore, type PaneKey, type ViewKey } from './store'
import { TagChips, type ChipScope } from './tag-chips'
import { TagsModal } from './tags-modal'
import classes from './m365.module.css'

const SCOPE_BY_VIEW: Record<ViewKey, ChipScope> = {
  chats: 'chats',
  teams: 'channels',
  feed: 'sources',
}
/** Per phone pane: the tab label and the shot anchor (the phone wrapper's, so the pane is measured at 390 even when empty). */
const PANE_META: Record<PaneKey, { tab: string; shot?: string }> = {
  sources: { tab: 'Sources', shot: 'source-list' },
  labeled: { tab: 'Labeled', shot: 'labeled-pane-phone' },
  detail: { tab: 'Detail', shot: 'detail-pane' },
}
/** Channel lists load this many teams ahead of the ones already settled: a slow Graph call never fans out all at once. */
const CHANNEL_WINDOW = 4

export function M365ExplorerPage(): ReactElement {
  const qc = useQueryClient()
  const m365Fetching = useIsFetching({ queryKey: m365Queries.all() })
  const compact = useSizeClass() === 'compact'
  const [view, setView] = explorerStore.field.view.use()
  const [storedTag, setTag] = explorerStore.field.tag.use()
  const [query] = explorerStore.field.q.use()
  const [pane, setPane] = explorerStore.field.pane.use()
  const phoneRef = useRef<HTMLDivElement>(null)
  /** Set by an explicit pick on a phone, so focus moves to the record then and not on mount or resize. */
  const pickedRef = useRef(false)
  const [selected, setSelected] = useState<SourceRef | null>(null)
  const [tagsOpened, tagsModal] = useDisclosure(false)

  const chatsQ = useSuspenseQuery(m365Queries.chats(CHATS_TOP))
  const teamsQ = useSuspenseQuery(m365Queries.teams())
  const labelsQ = useSuspenseQuery(m365Queries.labels())
  // `shot-state=empty` renders the real no-chats / no-teams / no-labels branches.
  const emptyShot = shotState() === 'empty'
  const chats = emptyShot ? [] : chatsQ.data.chats
  const teams = emptyShot ? [] : teamsQ.data.teams
  const labels: readonly LabelLite[] = emptyShot ? [] : labelsQ.data.labels
  const now = new Date(chatsQ.dataUpdatedAt)

  // Staggered: team i starts once fewer than CHANNEL_WINDOW unsettled teams sit ahead of it.
  const settled = teams.filter((t) => {
    const status = qc.getQueryState(m365Queries.channels(t.id).queryKey)?.status
    return status === 'success' || status === 'error'
  }).length
  const channelQs = useQueries({
    queries: teams.map((t, i) => ({
      ...m365Queries.channels(t.id),
      enabled: i < settled + CHANNEL_WINDOW,
    })),
  })
  // One row per team, one pass: the query list is built from `teams`, so the two never differ in length.
  const teamRows: TeamRow[] = teams.flatMap((team, i) => {
    const q = channelQs[i]
    if (q === undefined) return []
    const state: ChannelState = q.isError ? 'failed' : q.data ? 'loaded' : 'loading'
    return [
      {
        team,
        channels: {
          state,
          channels: q.data?.channels ?? [],
          retry: () => {
            void q.refetch()
          },
        },
      },
    ]
  })

  const teamSizes = teamRows.map(({ team, channels }) => ({
    name: team.displayName,
    state: channels.state,
    channels: channels.channels.length,
  }))

  const chatRows: ChatRow[] = chats.map((c) => ({
    ref: { kind: 'chat', chatId: c.id, displayName: chatTitle(c) },
    searchText: [c.topic ?? '', ...c.members.map((m) => m.name)].join(' ').toLowerCase(),
    chatType: c.chatType,
    memberCount: c.members.length,
    lastUpdatedAt: c.lastUpdatedAt,
    webUrl: c.webUrl,
  }))
  const labelMap = new Map(labels.map((l) => [l.sourceId, l]))
  const tagCounts = tagCountsOf(labels)
  const tagNames = tagCounts.map(([t]) => t)
  const tag = validTag(storedTag, tagNames)
  const kindCounts = chatKindCounts(chatRows)
  const chatsCapped = isCapped(chatRows.length)
  const noChats = chatRows.length === 0
  const noTeams = teams.length === 0

  const coverage = coverageOf({
    chatIds: chatRows.map((r) => r.ref.chatId),
    channels: teamRows.map(({ team, channels }) => ({
      teamId: team.id,
      state: channels.state,
      ids: channels.channels.map((c) => c.id),
    })),
    labels,
  })
  const allChannelsLoaded = coverage.loading === 0 && coverage.failed === 0
  const channelsTotal = allChannelsLoaded ? coverage.total - chatRows.length : null
  const channelRows = teamRows.flatMap(({ team, channels }) =>
    channels.channels.map((c) => ({
      label: labelMap.get(channelSourceId(team.id, c.id))?.label,
    })),
  )
  const counts = visibleChipCounts(
    view === 'teams'
      ? chipCounts(tagNames, channelRows, channelsTotal)
      : view === 'feed'
        ? chipCounts(
            tagNames,
            labels.map((l) => ({ label: l.label })),
            labels.length,
          )
        : chipCounts(
            tagNames,
            chatRows.map((r) => ({ label: labelMap.get(chatSourceId(r.ref.chatId))?.label })),
            chatRows.length,
          ),
    tag,
  )

  const headline = headlineOf({
    times: chatRows.map((r) => r.lastUpdatedAt),
    capped: chatsCapped,
  })

  const invalidateLabels = (): void => {
    void qc.invalidateQueries({ queryKey: [...m365Queries.all(), 'labels'] })
    void qc.invalidateQueries({ queryKey: [...m365Queries.all(), 'important'] })
  }
  const upsertLabel = useMutation({ ...m365Mutations.upsertLabel(), onSuccess: invalidateLabels })
  const deleteLabel = useMutation({ ...m365Mutations.deleteLabel(), onSuccess: invalidateLabels })

  function openLabeled(l: LabelLite): void {
    if (view === 'feed') setView(l.kind === 'chat' ? 'chats' : 'teams')
    if (l.kind === 'chat') {
      const chatId = l.sourceId.replace(/^chat:/, '')
      const row = chatRows.find((r) => r.ref.chatId === chatId)
      select(row?.ref ?? { kind: 'chat', chatId, displayName: l.displayName ?? chatId })
      return
    }
    const parts = parseChannelId(l.sourceId)
    if (!parts) return
    const team = teams.find((t) => t.id === parts.teamId)
    const channel = teamRows
      .find((r) => r.team.id === parts.teamId)
      ?.channels.channels.find((c) => c.id === parts.channelId)
    select({
      kind: 'channel',
      ...parts,
      displayName: channel?.displayName ?? l.displayName ?? parts.channelId,
      teamName: team?.displayName ?? '—',
    })
  }

  const selectedId = selected ? sourceIdFor(selected) : null
  const existing = selectedId ? (labelMap.get(selectedId) ?? null) : null
  const selectedChat =
    selected?.kind === 'chat' ? chatRows.find((r) => r.ref.chatId === selected.chatId) : undefined
  const knownTags = [
    ...new Set(['alerts', 'pr-reviews', 'general', 'noise', ...tagNames]),
  ].toSorted(
    (a, b) =>
      (tagCounts.find(([t]) => t === b)?.[1] ?? 0) - (tagCounts.find(([t]) => t === a)?.[1] ?? 0),
  )
  const writeError =
    (upsertLabel.error && upsertLabel.variables?.sourceId === selectedId
      ? upsertLabel.error.message
      : null) ??
    (deleteLabel.error && deleteLabel.variables === selectedId ? deleteLabel.error.message : null)

  /** One door for selection: a write error belongs to the record it happened on, so leaving clears it. */
  const select = (ref: SourceRef | null): void => {
    upsertLabel.reset()
    deleteLabel.reset()
    setSelected(ref)
    pickedRef.current = compact && ref !== null
    // Set on every layout, not only a phone's: the pane a resize back to a phone lands on must match the selection.
    setPane(ref ? 'detail' : 'sources')
  }

  // The pane the phone shows: Labeled duplicates Sources in the feed view, so it falls back there.
  // Detail with nothing open stays Detail and says so, so the pane is always reachable.
  const shownPane: PaneKey = view === 'feed' && pane === 'labeled' ? 'sources' : pane

  // A phone swaps the list for the detail on a pick: move focus to the record's heading.
  useEffect(() => {
    if (compact && shownPane === 'detail' && pickedRef.current) {
      pickedRef.current = false
      phoneRef.current?.querySelector<HTMLElement>('h2')?.focus()
    }
  }, [compact, shownPane, selectedId])

  const record = selected ? (
    <RecordPane
      selected={selected}
      chatFacts={
        selectedChat
          ? {
              chatType: CHAT_TYPE_LABEL[selectedChat.chatType],
              memberCount: selectedChat.memberCount,
              lastUpdatedAt: selectedChat.lastUpdatedAt,
            }
          : null
      }
      existing={existing ? { label: existing.label, notes: existing.notes } : null}
      tags={knownTags}
      saving={upsertLabel.isPending && upsertLabel.variables?.sourceId === selectedId}
      error={writeError}
      onSave={(label, notes) =>
        upsertLabel.mutate({
          sourceId: sourceIdFor(selected),
          kind: selected.kind,
          label,
          displayName: selected.displayName,
          notes,
        })
      }
      onRemove={() => deleteLabel.mutate(sourceIdFor(selected))}
      onClose={() => select(null)}
    />
  ) : null

  const labeledPane = (
    <LabeledPane
      title={compact ? undefined : labeledPaneTitle(tag)}
      labels={labels}
      tag={tag}
      selectedId={selectedId}
      error={deleteLabel.error ? deleteLabel.error.message : null}
      removingId={deleteLabel.isPending ? (deleteLabel.variables ?? null) : null}
      onOpen={openLabeled}
      onRemove={(id) => deleteLabel.mutate(id)}
    />
  )

  const sourcesPane = (
    <>
      {showTagChips(counts.all, tag) ? (
        <TagChips active={tag} counts={counts} scope={SCOPE_BY_VIEW[view]} onChange={setTag} />
      ) : null}
      {view === 'feed' ? (
        labeledPane
      ) : (
        <SourceList
          view={view}
          chats={chatRows}
          teamRows={teamRows}
          labelOf={(id) => labelMap.get(id)}
          tag={tag}
          query={query}
          now={now}
          selected={selected}
          onSelect={select}
        />
      )}
    </>
  )
  // The detail side: the feed in the feed view, the open record, else the labeled sources on a wide
  // screen (a phone has its own Labeled pane) or a hint on a phone.
  const emptyDetail = (view === 'chats' ? noChats : noTeams) ? null : (
    <p className={classes.empty}>Pick a chat or channel in Sources to open it</p>
  )
  const detailPane =
    view === 'feed' ? <FeedPane tag={tag} /> : (record ?? (compact ? emptyDetail : labeledPane))

  const phonePanes: Record<PaneKey, ReactNode> = {
    sources: sourcesPane,
    labeled: labeledPane,
    detail: detailPane,
  }
  const shown = PANE_META[shownPane]
  const sectionTitle = sectionTitleFor({ pane: shownPane, view, tag, open: selected !== null })

  const retryFailed = (): void => {
    for (const { channels } of teamRows) {
      if (channels.state === 'failed') channels.retry()
    }
  }

  return (
    <div className={classes.root}>
      <PageBar
        sync={{
          syncing: m365Fetching > 0,
          lastCompletedAt: Math.max(chatsQ.dataUpdatedAt, teamsQ.dataUpdatedAt),
          // Lists, labels, feed and open messages refresh; the per-team channel lists keep their
          // own five-minute staleness so a Sync never re-fires every team's Graph call.
          onSync: () => {
            void qc.invalidateQueries({ queryKey: [...m365Queries.all(), 'chats'] })
            void qc.invalidateQueries({ queryKey: [...m365Queries.all(), 'channels'] })
            void qc.invalidateQueries({ queryKey: m365Queries.teams().queryKey, exact: true })
            invalidateLabels()
          },
          label: 'Refresh chats + channels',
        }}
        tabs={
          <ViewTabs
            field={explorerStore.field.view}
            label="Source view"
            options={
              [
                { value: 'chats', label: 'Chats' },
                { value: 'teams', label: `Teams ${teams.length}` },
                { value: 'feed', label: 'Agent feed' },
              ] satisfies Array<{ value: ViewKey; label: string }>
            }
          />
        }
        filters={
          <FilterSet>
            <SearchFilter
              field={explorerStore.field.q}
              placeholder="Search"
              disabled={view === 'feed'}
            />
          </FilterSet>
        }
        filtersEnd={[
          {
            key: 'tags',
            label: `Manage tags (${tagCounts.length})`,
            icon: <IconTag size={16} />,
            onClick: tagsModal.open,
            disabled: tagCounts.length === 0,
          },
        ]}
      />

      <div className={classes.stack}>
        <PageSummary sentence={headline.sentence} />

        <ExplorerStrip
          coverage={coverage}
          list={{ chats: chatRows.length, capped: chatsCapped }}
          chats={kindCounts}
          channels={channelsTotal}
          largestTeam={largestTeam(teamSizes)}
          noChats={noChats}
          noTeams={noTeams}
          onRetry={retryFailed}
        />

        {compact ? (
          <Section
            title={sectionTitle}
            tabs={
              <ViewTabs
                field={explorerStore.field.pane}
                label="Pane"
                options={(['sources', 'labeled', 'detail'] as const)
                  .filter((value) => view !== 'feed' || value !== 'labeled')
                  .map((value) => ({ value, label: PANE_META[value].tab }))}
              />
            }
          >
            <div
              ref={phoneRef}
              className={classes.phonePane}
              // Every phone pane declares the page's empty state: the tag chips that carry it on
              // wide layouts render only in the sources pane.
              data-shot-states="empty"
              {...(shown.shot === undefined ? {} : { 'data-shot': shown.shot })}
            >
              {phonePanes[shownPane]}
            </div>
          </Section>
        ) : (
          <div className={classes.split}>
            <Card className={classes.pane} data-shot="source-list" data-shot-states="empty">
              <Card.Section className={classes.paneBody}>{sourcesPane}</Card.Section>
            </Card>
            <Card className={classes.pane} data-shot="detail-pane" data-shot-states="empty">
              <Card.Section className={classes.paneBody}>{detailPane}</Card.Section>
            </Card>
          </div>
        )}
      </div>

      <TagsModal opened={tagsOpened} onClose={tagsModal.close} tagCounts={tagCounts} />
    </div>
  )
}
