import { PageBar, useSizeClass } from 'basalt-ui'
import { FilterSet, SearchFilter, ViewTabs } from 'basalt-ui/controls'
import { Card, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconTag } from '@tabler/icons-react'
import {
  useIsFetching,
  useMutation,
  useQueries,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { m365Mutations, m365Queries } from '../../lib/queries/m365'
import { FeedPane } from './feed-pane'
import { LabeledPane } from './labeled-pane'
import {
  CHAT_TYPE_LABEL,
  channelSourceId,
  chatKindCounts,
  chatSourceId,
  chatTitle,
  chipCounts,
  coverageOf,
  formatStamp,
  parseChannelId,
  plural,
  recencyOf,
  sourceIdFor,
  tagCountsOf,
  validTag,
  type ChannelState,
  type ChatRow,
  type LabelLite,
  type SourceRef,
} from './model'
import { PreviewDrawer } from './preview-drawer'
import { RecordPane } from './record-pane'
import { SourceList, type TeamChannels } from './source-list'
import { ExplorerStrip } from './strip'
import { explorerStore, type ViewKey } from './store'
import { TagChips } from './tag-chips'
import { TagsModal } from './tags-modal'
import classes from './m365.module.css'

const CHATS_TOP = 50
/** Channel lists load this many teams ahead of the ones already settled: a slow Graph call never fans out all at once. */
const CHANNEL_WINDOW = 4

export function M365ExplorerPage(): ReactElement {
  const qc = useQueryClient()
  const m365Fetching = useIsFetching({ queryKey: m365Queries.all() })
  const compact = useSizeClass() === 'compact'
  const [view, setView] = explorerStore.field.view.use()
  const [storedTag, setTag] = explorerStore.field.tag.use()
  const [query] = explorerStore.field.q.use()
  const [selected, setSelected] = useState<SourceRef | null>(null)
  const [tagsOpened, tagsModal] = useDisclosure(false)

  const chatsQ = useSuspenseQuery(m365Queries.chats(CHATS_TOP))
  const teamsQ = useSuspenseQuery(m365Queries.teams())
  const labelsQ = useSuspenseQuery(m365Queries.labels())
  const teams = teamsQ.data.teams
  const labels: readonly LabelLite[] = labelsQ.data.labels
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
  const channelStates: TeamChannels[] = channelQs.map((q, i) => ({
    state: (q.isError ? 'failed' : q.data ? 'loaded' : 'loading') satisfies ChannelState,
    channels: q.data?.channels ?? [],
    retry: () => {
      void channelQs[i]?.refetch()
    },
  }))
  const channelsByTeam = new Map(teams.map((t, i) => [t.id, channelStates[i] as TeamChannels]))

  const chatRows: ChatRow[] = chatsQ.data.chats.map((c) => ({
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

  const coverage = coverageOf({
    chatIds: chatRows.map((r) => r.ref.chatId),
    channels: teams.map((t, i) => ({
      teamId: t.id,
      state: (channelStates[i] as TeamChannels).state,
      ids: (channelStates[i] as TeamChannels).channels.map((c) => c.id),
    })),
    labels,
  })
  const allChannelsLoaded = coverage.loading === 0 && coverage.failed === 0
  const channelsTotal = allChannelsLoaded ? coverage.total - chatRows.length : null
  const channelRows = teams.flatMap((t, i) =>
    (channelStates[i] as TeamChannels).channels.map((c) => ({
      label: labelMap.get(channelSourceId(t.id, c.id))?.label,
    })),
  )
  const counts =
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
          )

  const latest = chatRows.reduce<string | null>(
    (best, r) => (r.lastUpdatedAt && (!best || r.lastUpdatedAt > best) ? r.lastUpdatedAt : best),
    null,
  )
  const activeWeek = chatRows.filter((r) => recencyOf(r.lastUpdatedAt, now) !== 'Earlier').length

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
      setSelected(row?.ref ?? { kind: 'chat', chatId, displayName: l.displayName ?? chatId })
      return
    }
    const parts = parseChannelId(l.sourceId)
    if (!parts) return
    const team = teams.find((t) => t.id === parts.teamId)
    const channel = channelsByTeam.get(parts.teamId)?.channels.find((c) => c.id === parts.channelId)
    setSelected({
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
      onClose={compact ? undefined : () => setSelected(null)}
    />
  ) : null

  const labeledPane = (
    <LabeledPane
      labels={labels}
      tag={tag}
      selectedId={selectedId}
      removingId={deleteLabel.isPending ? (deleteLabel.variables ?? null) : null}
      onOpen={openLabeled}
      onRemove={(id) => deleteLabel.mutate(id)}
    />
  )

  const retryFailed = (): void => {
    channelStates.forEach((c) => {
      if (c.state === 'failed') c.retry()
    })
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
                { value: 'chats', label: `Chats ${chatRows.length}` },
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
        <Text className={classes.summary}>
          {latest ? `Latest activity ${formatStamp(latest)} · ` : ''}
          {plural(activeWeek, 'chat')} active in the last 7 days · {plural(tagCounts.length, 'tag')}{' '}
          in use
        </Text>

        <ExplorerStrip
          coverage={coverage}
          chatsCapped={chatRows.length >= CHATS_TOP}
          chats={{ total: chatRows.length, ...kindCounts }}
          teams={teams.length}
          channels={channelsTotal}
          onRetry={retryFailed}
        />

        <div className={classes.split}>
          <Card className={classes.pane} data-shot="source-list">
            <Card.Section className={classes.paneBody}>
              <TagChips active={tag} counts={counts} onChange={setTag} />
              {view === 'feed' ? (
                labeledPane
              ) : (
                <SourceList
                  view={view}
                  chats={chatRows}
                  teams={teams}
                  channelsByTeam={channelsByTeam}
                  labelOf={(id) => labelMap.get(id)}
                  tag={tag}
                  query={query}
                  now={now}
                  selected={selected}
                  onSelect={setSelected}
                />
              )}
            </Card.Section>
          </Card>

          <Card className={`${classes.pane} ${classes.detailPane}`} data-shot="detail-pane">
            <Card.Section className={classes.paneBody}>
              {view === 'feed' ? <FeedPane tag={tag} /> : (record ?? labeledPane)}
            </Card.Section>
          </Card>
        </div>
      </div>

      {compact ? (
        <PreviewDrawer opened={selected !== null} onClose={() => setSelected(null)}>
          {record}
        </PreviewDrawer>
      ) : null}
      <TagsModal opened={tagsOpened} onClose={tagsModal.close} tagCounts={tagCounts} />
    </div>
  )
}
