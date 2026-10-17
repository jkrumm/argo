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
  chatKindCounts,
  chatTitle,
  formatStamp,
  labelableTotal,
  parseChannelId,
  plural,
  sourceIdFor,
  tagCountsOf,
  CHAT_TYPE_LABEL,
  type ChatRow,
  type LabelLite,
  type SourceRef,
} from './model'
import { PreviewDrawer } from './preview-drawer'
import { RecordPane } from './record-pane'
import { SourceList } from './source-list'
import { ExplorerStrip } from './strip'
import { explorerStore, type ViewKey } from './store'
import { TagChips } from './tag-chips'
import { TagsModal } from './tags-modal'
import classes from './m365.module.css'

const CHATS_TOP = 50

export function M365ExplorerPage(): ReactElement {
  const qc = useQueryClient()
  const m365Fetching = useIsFetching({ queryKey: m365Queries.all() })
  const compact = useSizeClass() === 'compact'
  const [view, setView] = explorerStore.field.view.use()
  const [tag, setTag] = explorerStore.field.tag.use()
  const [query] = explorerStore.field.q.use()
  const [selected, setSelected] = useState<SourceRef | null>(null)
  const [tagsOpened, tagsModal] = useDisclosure(false)

  const chatsQ = useSuspenseQuery(m365Queries.chats(CHATS_TOP))
  const teamsQ = useSuspenseQuery(m365Queries.teams())
  const labelsQ = useSuspenseQuery(m365Queries.labels())
  const teams = teamsQ.data.teams
  const labels: readonly LabelLite[] = labelsQ.data.labels

  const channelQs = useQueries({ queries: teams.map((t) => m365Queries.channels(t.id)) })
  const channelsByTeam = new Map(teams.map((t, i) => [t.id, channelQs[i]?.data?.channels]))
  const channelCounts = channelQs.map((q) => q.data?.channels.length ?? null)
  const channelsTotal = channelCounts.some((n) => n === null)
    ? null
    : channelCounts.reduce<number>((a, n) => a + (n ?? 0), 0)

  const chatRows: ChatRow[] = chatsQ.data.chats.map((c) => ({
    ref: { kind: 'chat', chatId: c.id, displayName: chatTitle(c) },
    chatType: c.chatType,
    memberCount: c.members.length,
    lastUpdatedAt: c.lastUpdatedAt,
    webUrl: c.webUrl,
  }))
  const labelMap = new Map(labels.map((l) => [l.sourceId, l]))
  const tagCounts = tagCountsOf(labels)
  const kindCounts = chatKindCounts(chatRows)
  const total = labelableTotal(chatRows.length, channelCounts)
  const latest = chatRows.reduce<string | null>(
    (best, r) => (r.lastUpdatedAt && (!best || r.lastUpdatedAt > best) ? r.lastUpdatedAt : best),
    null,
  )

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
    const channel = channelsByTeam.get(parts.teamId)?.find((c) => c.id === parts.channelId)
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
    ...new Set(['alerts', 'pr-reviews', 'general', 'noise', ...tagCounts.map(([t]) => t)]),
  ].toSorted(
    (a, b) =>
      (tagCounts.find(([t]) => t === b)?.[1] ?? 0) - (tagCounts.find(([t]) => t === a)?.[1] ?? 0),
  )

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
      saving={upsertLabel.isPending}
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
      onClose={() => setSelected(null)}
    />
  ) : null

  const labeledPane = (
    <LabeledPane
      labels={labels}
      tag={tag}
      selectedId={selectedId}
      removing={deleteLabel.isPending}
      onOpen={openLabeled}
      onRemove={(id) => deleteLabel.mutate(id)}
    />
  )

  return (
    <div className={classes.root}>
      <PageBar
        sync={{
          syncing: m365Fetching > 0,
          lastCompletedAt: Math.max(chatsQ.dataUpdatedAt, teamsQ.dataUpdatedAt),
          onSync: () => {
            void qc.invalidateQueries({ queryKey: m365Queries.all() })
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
            <SearchFilter field={explorerStore.field.q} placeholder="Search" />
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
          {labels.length} of {total ?? '—'} chats and channels labeled across{' '}
          {plural(tagCounts.length, 'tag')}
          {latest ? ` · latest activity ${formatStamp(latest)}` : ''}
        </Text>

        <ExplorerStrip
          labeled={labels.length}
          total={total}
          chats={{ total: chatRows.length, ...kindCounts }}
          teams={teams.length}
          channels={channelsTotal}
        />

        <div className={classes.split}>
          <Card className={classes.pane} data-shot="source-list">
            <Card.Section className={classes.paneBody}>
              <TagChips
                active={tag}
                total={view === 'teams' ? (channelsTotal ?? 0) : chatRows.length}
                labeled={labels.length}
                tagCounts={tagCounts}
                onChange={setTag}
              />
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
                  now={new Date(chatsQ.dataUpdatedAt)}
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
