import { SimpleGrid, Stack, Text } from '@mantine/core'
import { BookCard } from './book-card'

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

export function ShelfSection({ title, books }: { title: string; books: ShelfItem[] }) {
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm" style={{ opacity: 0.65, marginTop: 4 }}>
        {title}{' '}
        <Text component="span" fw={400} c="dimmed">
          ({books.length})
        </Text>
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        {books.map((book) => (
          <BookCard key={book.hardcoverBookId} book={book} />
        ))}
      </SimpleGrid>
    </Stack>
  )
}
