// Bearer-authed GraphQL client for the Hardcover.app API.
// Paginates the user's shelf and returns normalized rows.

import { env } from '../env.js'
import { tracedFetch } from '../lib/traced-fetch.js'

const API_URL = 'https://api.hardcover.app/v1/graphql'
const API_KEY = env.HARDCOVER_API_KEY

const PAGE_SIZE = 50

// ── GraphQL response types ───────────────────────────────────────────────────

interface HardcoverAuthor {
  name: string
}

interface HardcoverContribution {
  author: HardcoverAuthor | null
}

interface HardcoverCachedImage {
  url?: string | null
  color?: string | null
  width?: number | null
  height?: number | null
}

interface HardcoverTagEntry {
  tag: string
  tagSlug: string
}

interface HardcoverCachedTags {
  Genre?: HardcoverTagEntry[]
  Mood?: HardcoverTagEntry[]
  Tag?: HardcoverTagEntry[]
  'Content Warning'?: HardcoverTagEntry[]
}

interface HardcoverBook {
  id: number
  title: string
  subtitle: string | null
  slug: string | null
  headline: string | null
  pages: number | null
  release_year: number | null
  description: string | null
  cached_image: HardcoverCachedImage | null
  contributions: HardcoverContribution[]
  cached_tags: HardcoverCachedTags | null
  rating: number | null
  ratings_count: number | null
}

interface HardcoverUserBookRead {
  id: number
  started_at: string | null
  finished_at: string | null
  progress_pages: number | null
  progress_seconds: number | null
  edition_id: number | null
}

interface HardcoverUserBookRaw {
  id: number
  book_id: number
  status_id: number
  rating: number | null
  review_raw: string | null
  has_review: boolean
  first_read_date: string | null
  last_read_date: string | null
  first_started_reading_date: string | null
  date_added: string | null
  updated_at: string | null
  edition_id: number | null
  book: HardcoverBook
  user_book_reads: HardcoverUserBookRead[]
}

interface HardcoverMeResult {
  user_books: HardcoverUserBookRaw[]
}

interface HardcoverQueryResponse {
  data: {
    me: HardcoverMeResult[]
  }
  errors?: Array<{ message: string }>
}

// ── Normalized public types ──────────────────────────────────────────────────

export type HardcoverSearchHit = {
  hardcoverBookId: number
  title: string
  subtitle: string | null
  authors: string[]
  releaseYear: number | null
  coverUrl: string | null
  genres: string[]
  communityRating: number | null
  ratingsCount: number | null
}

export type HardcoverUserBook = {
  // shelf fields
  hardcoverUserBookId: number
  hardcoverBookId: number
  statusId: number
  rating: number | null
  reviewRaw: string | null
  hasReview: boolean
  firstStartedReadingDate: string | null
  firstReadDate: string | null
  lastReadDate: string | null
  dateAdded: string | null
  hardcoverUpdatedAt: string | null
  editionId: number | null
  // normalized book fields
  title: string
  subtitle: string | null
  slug: string | null
  headline: string | null
  pages: number | null
  releaseYear: number | null
  description: string | null
  coverUrl: string | null
  authors: string[]
  genres: string[]
  communityRating: number | null
  ratingsCount: number | null
}

// ── Write input types ────────────────────────────────────────────────────────

export interface UserBookUpdateInput {
  status_id?: number
  first_started_reading_date?: string
  last_read_date?: string
  edition_id?: number
}

export interface UserBookCreateInput extends UserBookUpdateInput {
  book_id: number
}

// ── GraphQL queries and mutations ────────────────────────────────────────────

const SEARCH_BOOKS_QUERY = `
  query SearchBooks($q: String!, $perPage: Int!) {
    search(query: $q, query_type: "Book", per_page: $perPage, page: 1) {
      results
    }
  }
`

const UPDATE_USER_BOOK_MUTATION = `
  mutation UpdateUserBook($id: Int!, $object: UserBookUpdateInput!) {
    update_user_book(id: $id, object: $object) {
      id
      error
    }
  }
`

const INSERT_USER_BOOK_MUTATION = `
  mutation InsertUserBook($object: UserBookCreateInput!) {
    insert_user_book(object: $object) {
      id
      error
    }
  }
`

const SHELF_QUERY = `
  query MyShelf($limit: Int!, $offset: Int!) {
    me {
      user_books(limit: $limit, offset: $offset, order_by: { updated_at: desc }) {
        id
        book_id
        status_id
        rating
        review_raw
        has_review
        first_read_date
        last_read_date
        first_started_reading_date
        date_added
        updated_at
        edition_id
        book {
          id title subtitle slug headline pages release_year description
          rating ratings_count
          cached_image
          contributions { author { name } }
          cached_tags
        }
        user_book_reads { id started_at finished_at progress_pages progress_seconds edition_id }
      }
    }
  }
`

// ── Private helpers ──────────────────────────────────────────────────────────

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!API_KEY) throw new Error('HARDCOVER_API_KEY not configured')

  const res = await tracedFetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`hardcover GraphQL → ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }

  if (json.errors && json.errors.length > 0) {
    throw new Error(`hardcover GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`)
  }

  return json.data as T
}

function normalizeUserBook(raw: HardcoverUserBookRaw): HardcoverUserBook {
  const authors = (raw.book.contributions ?? [])
    .map((c) => c.author?.name)
    .filter((n): n is string => Boolean(n))

  const genres = (raw.book.cached_tags?.Genre ?? []).map((g) => g.tag).filter(Boolean)

  const coverUrl = raw.book.cached_image?.url ?? null

  return {
    hardcoverUserBookId: raw.id,
    hardcoverBookId: raw.book_id,
    statusId: raw.status_id,
    rating: raw.rating ?? null,
    reviewRaw: raw.review_raw ?? null,
    hasReview: raw.has_review,
    firstStartedReadingDate: raw.first_started_reading_date ?? null,
    firstReadDate: raw.first_read_date ?? null,
    lastReadDate: raw.last_read_date ?? null,
    dateAdded: raw.date_added ?? null,
    hardcoverUpdatedAt: raw.updated_at ?? null,
    editionId: raw.edition_id ?? null,
    title: raw.book.title,
    subtitle: raw.book.subtitle ?? null,
    slug: raw.book.slug ?? null,
    headline: raw.book.headline ?? null,
    pages: raw.book.pages ?? null,
    releaseYear: raw.book.release_year ?? null,
    description: raw.book.description ?? null,
    coverUrl,
    authors,
    genres,
    communityRating: raw.book.rating ?? null,
    ratingsCount: raw.book.ratings_count ?? null,
  }
}

// ── Public client ────────────────────────────────────────────────────────────

// search blob is untyped Typesense json
interface SearchDocument {
  id: string
  title?: string
  subtitle?: string
  author_names?: string[]
  release_year?: number
  image?: { url: string }
  genres?: string[]
  isbns?: string[]
  slug?: string
  rating?: number
  ratings_count?: number
}

interface SearchHit {
  document: SearchDocument
}

interface SearchResults {
  found: number
  hits: SearchHit[]
}

export const hardcover = {
  /**
   * Search Hardcover for a book by title (and optional author).
   * Returns up to 5 normalized hits ordered by Hardcover relevance.
   */
  async searchBook({
    title,
    author,
  }: {
    title: string
    author?: string | null
  }): Promise<HardcoverSearchHit[]> {
    const q = [title, author].filter(Boolean).join(' ').trim()
    if (!q) return []

    const data = await gql<{ search?: { results?: SearchResults } }>(SEARCH_BOOKS_QUERY, {
      q,
      perPage: 5,
    })

    const hits = data.search?.results?.hits ?? []

    return hits.flatMap((hit) => {
      const doc = hit.document
      const id = Number(doc.id)
      if (Number.isNaN(id)) return []
      return [
        {
          hardcoverBookId: id,
          title: doc.title ?? '',
          subtitle: doc.subtitle ?? null,
          authors: doc.author_names ?? [],
          releaseYear: doc.release_year ?? null,
          coverUrl: doc.image?.url ?? null,
          genres: doc.genres ?? [],
          communityRating: doc.rating ?? null,
          ratingsCount: doc.ratings_count ?? null,
        } satisfies HardcoverSearchHit,
      ]
    })
  },

  /**
   * Update an existing user_book entry on Hardcover (status + dates only).
   * Throws if Hardcover returns an error.
   */
  async updateUserBook(userBookId: number, object: UserBookUpdateInput): Promise<void> {
    const data = await gql<{ update_user_book: { id: number | null; error: string | null } }>(
      UPDATE_USER_BOOK_MUTATION,
      { id: userBookId, object },
    )
    if (data.update_user_book.error) {
      throw new Error(`hardcover update_user_book → ${data.update_user_book.error}`)
    }
  },

  /**
   * Insert a new user_book entry on Hardcover. Returns the new user_book id.
   * Throws if Hardcover returns an error.
   */
  async insertUserBook(object: UserBookCreateInput): Promise<number> {
    const data = await gql<{ insert_user_book: { id: number | null; error: string | null } }>(
      INSERT_USER_BOOK_MUTATION,
      { object },
    )
    if (data.insert_user_book.error) {
      throw new Error(`hardcover insert_user_book → ${data.insert_user_book.error}`)
    }
    return data.insert_user_book.id as number
  },

  /**
   * Fetch the authenticated user's full shelf by paginating in pages of 50
   * until an underfull page signals the end. Returns normalized rows.
   * Gracefully returns an empty array when the shelf has no books yet.
   */
  async myShelf(): Promise<HardcoverUserBook[]> {
    const results: HardcoverUserBook[] = []
    let offset = 0

    for (;;) {
      const data = await gql<HardcoverQueryResponse['data']>(SHELF_QUERY, {
        limit: PAGE_SIZE,
        offset,
      })

      const page = data?.me?.[0]?.user_books ?? []
      for (const raw of page) {
        results.push(normalizeUserBook(raw))
      }

      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    return results
  },
}
