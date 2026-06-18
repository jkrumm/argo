import { AspectRatio, Badge, Card, Group, Image, Rating, Stack, Text } from '@mantine/core'
import { IconBook } from '@tabler/icons-react'

type ShelfItem = {
  hardcoverBookId: number
  title: string
  subtitle: string | null
  authors: string[]
  genres: string[]
  pages: number | null
  releaseYear: number | null
  coverUrl: string | null
  statusId: number
  status: string
  rating: number | null
  hasReview: boolean
  startedDate: string | null
  readDate: string | null
  lastReadDate: string | null
  dateAdded: string | null
  stats: null
}

function CoverPlaceholder() {
  return (
    <Stack
      align="center"
      justify="center"
      style={{
        width: 72,
        height: 108,
        background: 'var(--mantine-color-default-hover)',
        borderRadius: 'var(--mantine-radius-sm)',
        flexShrink: 0,
      }}
    >
      <IconBook size={28} style={{ opacity: 0.35 }} />
    </Stack>
  )
}

export function BookCard({ book }: { book: ShelfItem }) {
  const displayGenres = book.genres.slice(0, 3)

  return (
    <Card padding="sm" withBorder>
      <Group gap="sm" align="flex-start" wrap="nowrap">
        {book.coverUrl !== null ? (
          <AspectRatio ratio={2 / 3} w={72} style={{ flexShrink: 0 }}>
            <Image
              src={book.coverUrl}
              alt={book.title}
              radius="sm"
              w={72}
              h={108}
              style={{ objectFit: 'cover' }}
            />
          </AspectRatio>
        ) : (
          <CoverPlaceholder />
        )}

        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm" lineClamp={2} style={{ lineHeight: 1.3 }}>
            {book.title}
          </Text>

          {book.subtitle !== null && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {book.subtitle}
            </Text>
          )}

          <Text size="xs" c="dimmed">
            {book.authors.join(', ')}
          </Text>

          {book.rating !== null && (
            <Rating value={book.rating} readOnly fractions={2} size="xs" style={{ marginTop: 2 }} />
          )}

          <Group gap={4} mt={2} wrap="wrap">
            {book.releaseYear !== null && (
              <Text size="xs" c="dimmed">
                {book.releaseYear}
              </Text>
            )}
            {displayGenres.map((g) => (
              <Badge key={g} size="xs" variant="light" radius="sm">
                {g}
              </Badge>
            ))}
          </Group>
        </Stack>
      </Group>
    </Card>
  )
}
