import { Alert, Button, Loader, Stack, Text } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { EmptyState, PageBar, Section } from 'basalt-ui'
import { useState } from 'react'
import { paperError, paperQueries, useDecide, type DecideBody } from '../../../lib/queries/paper'
import { suggestionsFrom, toMs } from './model'
import { ReviewItem } from './review-item'

export function ReviewPage() {
  const inbox = useQuery(paperQueries.inbox())
  const review = inbox.data?.review ?? []
  // The form's suggestions come from the index; read it only when something waits for a decision.
  const index = useQuery({ ...paperQueries.index(), enabled: review.length > 0 })
  const suggestions = suggestionsFrom(index.data)
  const decide = useDecide()
  const [deciding, setDeciding] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [decided, setDecided] = useState(0)

  if (inbox.data === undefined) {
    return (
      <>
        <PageBar />
        {inbox.isError ? (
          <Alert color="red" title="The inbox did not load">
            <Stack gap="sm" align="flex-start">
              {paperError(inbox.error)}
              <Button variant="default" onClick={() => void inbox.refetch()}>
                Try again
              </Button>
            </Stack>
          </Alert>
        ) : (
          <Loader size="sm" />
        )}
      </>
    )
  }

  const { waiting } = inbox.data

  const decideItem = async (name: string, body: DecideBody) => {
    setDeciding(name)
    setErrors(({ [name]: _gone, ...rest }) => rest)
    try {
      await decide.mutateAsync({ name, body })
      setDecided((count) => count + 1)
    } catch (failure) {
      setErrors((current) => ({ ...current, [name]: paperError(failure) }))
    } finally {
      setDeciding(null)
    }
  }

  return (
    <>
      <PageBar
        sync={{ syncing: inbox.isFetching, onSync: () => void inbox.refetch(), label: 'Refresh' }}
      />
      <Stack gap="md">
        {decided > 0 && (
          <Alert
            color="green"
            icon={<IconCheck size={18} />}
            title="Decided"
            withCloseButton
            onClose={() => setDecided(0)}
          >
            The pipeline takes {decided === 1 ? 'it' : 'them'} within five minutes.
          </Alert>
        )}

        <Section title="In review" count={review.length}>
          {review.length === 0 ? (
            <EmptyState
              title="Nothing waits for a decision"
              description="Files the pipeline cannot file by itself appear here."
            />
          ) : (
            <Stack gap="md">
              {review.map((item) => (
                <ReviewItem
                  key={item.name}
                  item={item}
                  busy={deciding === item.name}
                  error={errors[item.name] ?? null}
                  suggestions={suggestions}
                  onDecide={(body) => void decideItem(item.name, body)}
                />
              ))}
            </Stack>
          )}
        </Section>

        <Section title="Waiting in the inbox" count={waiting.length}>
          {waiting.length === 0 ? (
            <Text size="sm" c="dimmed">
              Nothing waits: the pipeline has taken every scan.
            </Text>
          ) : (
            <Stack gap="xs">
              {waiting.map((file) => (
                <Text key={file.name} size="sm" data-private>
                  {file.name}{' '}
                  <Text span c="dimmed" size="xs">
                    {formatDistanceToNow(toMs(file.mtime), { addSuffix: true })}
                  </Text>
                </Text>
              ))}
              <Text size="xs" c="dimmed">
                The pipeline picks these up within five minutes.
              </Text>
            </Stack>
          )}
        </Section>
      </Stack>
    </>
  )
}
