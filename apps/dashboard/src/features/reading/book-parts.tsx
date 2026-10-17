import { Anchor, Flex, Image, Text } from '@mantine/core'
import { IconBook } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import type { ShelfItem } from './model'
import classes from './reading.module.css'

type CoverProps = { book: Pick<ShelfItem, 'coverUrl' | 'title'>; width: number }

/** A 2:3 cover at a fixed width; a placeholder glyph when Hardcover has none. */
export function Cover({ book, width }: CoverProps) {
  const height = Math.round((width * 3) / 2)
  if (book.coverUrl === null) {
    return (
      <Flex className={classes.cover} w={width} h={height} align="center" justify="center">
        <IconBook size={Math.round(width / 2)} stroke={1.5} />
      </Flex>
    )
  }
  return (
    <Image
      src={book.coverUrl}
      alt=""
      w={width}
      h={height}
      fit="cover"
      radius="sm"
      style={{ flex: 'none' }}
    />
  )
}

/** The title, linked to Hardcover when the book has a slug. */
export function BookTitle({ book }: { book: Pick<ShelfItem, 'slug' | 'title'> }) {
  if (book.slug === null) {
    return (
      <Text size="sm" fw={600} lineClamp={2}>
        {book.title}
      </Text>
    )
  }
  return (
    <Anchor
      href={`https://hardcover.app/books/${book.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      underline="hover"
      c="inherit"
      size="sm"
      fw={600}
      lineClamp={2}
    >
      {book.title}
    </Anchor>
  )
}

type BookRowProps = {
  book: ShelfItem
  /** Mono facts under the author, left. */
  meta?: ReactNode
  /** Mono value pinned right. */
  trail: ReactNode
}

/** Entity row: cover 32 px, title, author, a mono value pinned right. */
export function BookRow({ book, meta, trail }: BookRowProps) {
  return (
    <div role="listitem" className={classes.row}>
      <Cover book={book} width={32} />
      <div className={classes.rowBody}>
        <BookTitle book={book} />
        <Text size="xs" c="dimmed">
          {book.authors.join(', ')}
          {meta === undefined ? null : <> · {meta}</>}
        </Text>
      </div>
      <div className={classes.rowTrail}>{trail}</div>
    </div>
  )
}
