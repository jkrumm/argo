import { Anchor, Badge, Box, Button, Group, Stack, Text } from '@mantine/core'
import { IconFiles } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { EmptyState, PageBar, PageSummary, Section } from 'basalt-ui'
import { FilterSet, SearchFilter, SelectFilter } from 'basalt-ui/controls'
import { BasaltDataTable, createColumnHelper } from 'basalt-ui/table'
import { format } from 'date-fns'
import { paperError, paperQueries } from '../../../lib/queries/paper'
import { shotState } from '../../../lib/shot-state'
import { useNow } from '../../../lib/use-now'
import { documentsStore } from '../../../lib/window-stores'
import { RetryButton } from '../../calendar/retry-button'
import { AttentionBadges } from './attention-badges'
import {
  NO_FILTERS,
  UNDATED,
  attentionCounts,
  attentionOf,
  facetOptions,
  filterDocs,
  isFiltering,
  type Doc,
  type Facet,
  type Filters,
} from './model'

const columnHelper = createColumnHelper<Doc>()

const SELECTS: { facet: Facet; label: string }[] = [
  { facet: 'kind', label: 'Kind' },
  { facet: 'issuer', label: 'Issuer' },
  { facet: 'year', label: 'Year' },
  { facet: 'taxYear', label: 'Tax year' },
  { facet: 'tag', label: 'Tag' },
]

const optionsOf = (docs: readonly Doc[], facet: Facet, filters: Filters, today: string) =>
  facetOptions(docs, facet, filters, today).map(({ value, count }) => ({
    value,
    label: `${value === UNDATED ? 'Undated' : value} · ${count}`,
  }))

const attentionOptions = (docs: readonly Doc[], today: string) => {
  const counts = attentionCounts(docs, today)
  return [
    { value: 'any', label: `Needs attention · ${counts.any}` },
    { value: 'expiry', label: `Expiring or expired · ${counts.expiry}` },
    { value: 'missing', label: `File missing · ${counts.missing}` },
    { value: 'nokind', label: `No kind · ${counts.nokind}` },
  ]
}

const columns = (today: string) => [
  columnHelper.accessor((doc) => doc.date ?? undefined, {
    id: 'date',
    header: 'Date',
    meta: { priority: 1, numeral: false },
    sortUndefined: 'last',
    cell: (ctx) => (
      <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
        {ctx.getValue() ?? '—'}
      </Text>
    ),
  }),
  columnHelper.accessor((doc) => doc.title, {
    id: 'title',
    header: 'Title',
    meta: { priority: 0, numeral: false, kind: 'text' },
    cell: (ctx) => (
      <Stack gap={2}>
        <Text size="sm" fw={500}>
          {ctx.getValue()}
        </Text>
        <AttentionBadges reasons={attentionOf(ctx.row.original, today)} />
      </Stack>
    ),
  }),
  columnHelper.accessor((doc) => doc.kind ?? undefined, {
    id: 'kind',
    header: 'Kind',
    meta: { priority: 2, numeral: false },
    sortUndefined: 'last',
  }),
  columnHelper.accessor((doc) => doc.issuer ?? undefined, {
    id: 'issuer',
    header: 'Issuer',
    meta: { priority: 3, numeral: false, kind: 'text' },
    sortUndefined: 'last',
  }),
  columnHelper.accessor((doc) => doc.taxYear ?? undefined, {
    id: 'taxYear',
    header: 'Tax year',
    meta: { priority: 4 },
    sortUndefined: 'last',
  }),
  columnHelper.accessor((doc) => doc.tags.join(' '), {
    id: 'tags',
    header: 'Tags',
    meta: { priority: 5, numeral: false, kind: 'text' },
    enableSorting: false,
    cell: (ctx) => <Tags tags={ctx.row.original.tags} />,
  }),
]

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <Group gap={4}>
      {tags.map((tag) => (
        <Badge key={tag} variant="light" color="gray" tt="none">
          {tag}
        </Badge>
      ))}
    </Group>
  )
}

/** A phone gets one card per document. */
function DocCard({ doc, today }: { doc: Doc; today: string }) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>
        {doc.title}
      </Text>
      <Text size="xs" c="dimmed">
        {[doc.date ?? 'undated', doc.kind, doc.issuer, doc.taxYear && `tax ${doc.taxYear}`]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <AttentionBadges reasons={attentionOf(doc, today)} />
      <Tags tags={doc.tags} />
    </Stack>
  )
}

/** What is wrong, listed above the index so nobody has to search for it. */
function Attention({ docs, today }: { docs: Doc[]; today: string }) {
  return (
    <Section title="Needs attention" count={docs.length}>
      <Stack gap="xs">
        {docs.map((doc) => (
          <Group key={doc.id} gap="xs">
            <Anchor
              size="sm"
              renderRoot={(props) => (
                <Link {...props} to="/documents/$id" params={{ id: doc.id }} />
              )}
            >
              {doc.title}
            </Anchor>
            <AttentionBadges reasons={attentionOf(doc, today)} />
          </Group>
        ))}
      </Stack>
    </Section>
  )
}

export function DocumentsIndexPage() {
  const filters = documentsStore.useValues()
  const navigate = useNavigate()
  // The page shows the index itself, so it re-reads sooner than the review form's suggestions need.
  const query = useQuery({ ...paperQueries.index(), staleTime: 60_000 })
  const inbox = useQuery(paperQueries.inbox())
  const today = format(useNow(), 'yyyy-MM-dd')

  const all: Doc[] = shotState() === 'empty' ? [] : (query.data?.documents ?? [])
  const shown = filterDocs(all, filters, today)
  // Over the whole index, whatever is searched or filtered right now.
  const attention = filterDocs(all, { ...NO_FILTERS, attention: 'any' }, today)
  const waiting = inbox.data?.review.length

  return (
    <>
      <PageBar
        sync={{
          syncing: query.isFetching,
          onSync: () => {
            void query.refetch()
            void inbox.refetch()
          },
          label: 'Refresh',
        }}
        filters={
          <FilterSet>
            <SearchFilter field={documentsStore.field.q} placeholder="Search documents" />
            {SELECTS.map(({ facet, label }) => (
              <SelectFilter
                key={facet}
                label={label}
                field={documentsStore.field[facet]}
                options={optionsOf(all, facet, filters, today)}
                clearable
              />
            ))}
            <SelectFilter
              label="Attention"
              field={documentsStore.field.attention}
              options={[{ value: 'all', label: 'All documents' }, ...attentionOptions(all, today)]}
              clearable
            />
          </FilterSet>
        }
      />

      {query.data === undefined ? (
        query.isError ? (
          <EmptyState
            tier="page"
            title="The document index could not be read"
            description={paperError(query.error)}
            action={
              <RetryButton
                label="Retry the document index"
                loading={query.isFetching}
                onClick={() => void query.refetch()}
              />
            }
          />
        ) : (
          <PageSummary loading />
        )
      ) : (
        <Stack gap="md">
          <PageSummary
            sentence={
              isFiltering(filters)
                ? `${shown.length} of ${all.length} documents`
                : `${all.length} ${all.length === 1 ? 'document' : 'documents'}`
            }
            facts={[
              attention.length === 0
                ? 'Nothing needs attention'
                : `${attention.length} ${attention.length === 1 ? 'needs' : 'need'} attention`,
            ]}
            aside={
              waiting === undefined ? (
                <Text size="sm" c="dimmed">
                  {inbox.isError ? 'Review queue unreadable' : 'Reading the review queue'}
                </Text>
              ) : (
                <Button
                  variant="default"
                  renderRoot={(props) => <Link {...props} to="/documents/review" />}
                >
                  {waiting} waiting in review
                </Button>
              )
            }
          />
          {attention.length > 0 && <Attention docs={attention} today={today} />}
          {all.length === 0 ? (
            <EmptyState
              icon={<IconFiles size={28} />}
              title="No filed documents yet"
              description="A document appears here once the pipeline has filed it."
            />
          ) : (
            <Box>
              <BasaltDataTable
                data={shown}
                columns={columns(today)}
                getRowId={(doc) => doc.id}
                highlightOnHover
                enablePagination
                pageSizeOptions={[50, 100, 500]}
                initialPagination={{ pageIndex: 0, pageSize: 50 }}
                onRowActivate={(doc) =>
                  void navigate({ to: '/documents/$id', params: { id: doc.id } })
                }
                rowLabel={(doc) => doc.title}
                renderCard={(doc) => <DocCard doc={doc} today={today} />}
                emptyState="No document matches the filters"
              />
            </Box>
          )}
        </Stack>
      )}
    </>
  )
}
