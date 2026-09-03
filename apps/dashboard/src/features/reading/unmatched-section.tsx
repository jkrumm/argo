import { Button, Card, Group, Image, Stack, Text } from '@mantine/core'
import { emit } from 'basalt-ui/notifications'
import { unwrap } from 'basalt-ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../lib/eden'
import { readingQueries } from '../../lib/queries/reading'

export function UnmatchedSection() {
  const { data } = useQuery(readingQueries.unmatched())
  const unmatched = data?.unmatched ?? []

  if (unmatched.length === 0) return null

  return (
    <Card padding="sm">
      <Stack gap="sm">
        <Stack gap={2}>
          <Text fw={600} size="sm">
            Unmatched reading activity
          </Text>
          <Text size="xs" c="dimmed">
            Reading activity we couldn't auto-link to a Hardcover book. Confirm a match to start
            syncing status.
          </Text>
        </Stack>

        <Stack gap="xs">
          {unmatched.map((row) => (
            <UnmatchedRow key={row.bookKey} row={row} />
          ))}
        </Stack>
      </Stack>
    </Card>
  )
}

type UnmatchedRow = {
  bookKey: string
  readingTitle: string | null
  readingAuthor: string | null
  currentPercent: number
  candidateBookId: number | null
  candidateTitle: string | null
  candidateAuthors: string[]
  candidateCoverUrl: string | null
}

function UnmatchedRow({ row }: { row: UnmatchedRow }) {
  const queryClient = useQueryClient()
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async (bookKey: string) => {
      setPendingKey(bookKey)
      return unwrap(await api.reading.match.post({ bookKey }))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: readingQueries.all() })
      emit(
        'reading:success',
        { message: 'The reading activity has been linked and will sync on the next reconcile.' },
        { title: 'Match confirmed' },
      )
    },
    onError: () => {
      emit(
        'reading:error',
        { message: 'Could not confirm the match. Check the server logs.' },
        { title: 'Confirm failed' },
      )
    },
    onSettled: () => {
      setPendingKey(null)
    },
  })

  const isThisPending = mutation.isPending && pendingKey === row.bookKey

  return (
    <Group
      gap="sm"
      align="flex-start"
      wrap="nowrap"
      style={{
        borderTop: '1px solid var(--mantine-color-default-border)',
        paddingTop: 'var(--mantine-spacing-xs)',
      }}
    >
      {/* Telemetry side */}
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text size="xs" fw={600} lineClamp={1}>
          {row.readingTitle ?? row.bookKey}
        </Text>
        {row.readingAuthor !== null && (
          <Text size="xs" c="dimmed" lineClamp={1}>
            {row.readingAuthor}
          </Text>
        )}
        {row.currentPercent > 0 && (
          <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(row.currentPercent)}% read
          </Text>
        )}
      </Stack>

      {/* Arrow separator */}
      <Text size="xs" c="dimmed" style={{ flexShrink: 0, alignSelf: 'center' }}>
        →
      </Text>

      {/* Candidate side */}
      {row.candidateBookId !== null ? (
        <Group gap="xs" align="flex-start" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          {row.candidateCoverUrl !== null && (
            <Image
              src={row.candidateCoverUrl}
              alt={row.candidateTitle ?? ''}
              radius="xs"
              w={32}
              h={48}
              style={{ objectFit: 'cover', flexShrink: 0 }}
            />
          )}
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" fw={600} lineClamp={2} style={{ lineHeight: 1.3 }}>
              {row.candidateTitle}
            </Text>
            {row.candidateAuthors.length > 0 && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {row.candidateAuthors.join(', ')}
              </Text>
            )}
            <Button
              variant="default"
              size="xs"
              mt={4}
              loading={isThisPending}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(row.bookKey)}
            >
              Confirm match
            </Button>
          </Stack>
        </Group>
      ) : (
        <Text size="xs" c="dimmed" style={{ flex: 1, alignSelf: 'center' }}>
          No Hardcover match found
        </Text>
      )}
    </Group>
  )
}
