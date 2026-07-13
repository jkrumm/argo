import {
  Anchor,
  AspectRatio,
  Badge,
  Card,
  Group,
  Image,
  Progress,
  Rating,
  Stack,
  Text,
} from '@mantine/core'
import { IconBook, IconStarFilled } from '@tabler/icons-react'
import { formatReadTime, pagesPerHour } from './format'

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
  slug: string | null
  communityRating: number | null
  ratingsCount: number | null
  stats: {
    totalReadSeconds: number
    pagesRead: number
    currentPercent: number
    sessions: number
    lastReadAt: string | null
  } | null
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
    <Card padding="sm">
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
          {book.slug ? (
            <Anchor
              href={`https://hardcover.app/books/${book.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              c="inherit"
              fw={600}
              size="sm"
              lineClamp={2}
              style={{ lineHeight: 1.3 }}
            >
              {book.title}
            </Anchor>
          ) : (
            <Text fw={600} size="sm" lineClamp={2} style={{ lineHeight: 1.3 }}>
              {book.title}
            </Text>
          )}

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

          {typeof book.communityRating === 'number' && (
            <Group gap={2} align="center">
              <IconStarFilled size={12} style={{ opacity: 0.45 }} />
              <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {book.communityRating.toFixed(1)}
                {typeof book.ratingsCount === 'number' && ` (${book.ratingsCount})`}
              </Text>
            </Group>
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

          {book.stats && <StatsStrip stats={book.stats} />}
        </Stack>
      </Group>
    </Card>
  )
}

type Stats = NonNullable<ShelfItem['stats']>

function StatsStrip({ stats }: { stats: Stats }) {
  const pace = pagesPerHour(stats.pagesRead, stats.totalReadSeconds)

  return (
    <Stack gap={4} mt={2}>
      {stats.currentPercent > 0 && (
        <Stack gap={2}>
          <Progress value={stats.currentPercent} size="xs" color="blue" radius="xs" />
          <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(stats.currentPercent)}% read
          </Text>
        </Stack>
      )}
      <Group gap="xs" wrap="wrap">
        {stats.totalReadSeconds > 0 && (
          <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatReadTime(stats.totalReadSeconds)} read
          </Text>
        )}
        {pace !== null && (
          <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
            · {pace} pages/hr
          </Text>
        )}
        {stats.sessions > 0 && (
          <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
            · {stats.sessions} {stats.sessions === 1 ? 'session' : 'sessions'}
          </Text>
        )}
      </Group>
    </Stack>
  )
}
