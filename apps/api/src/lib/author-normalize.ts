// Pure author-name normalization — collapse internal whitespace runs to a single
// space and trim. Hardcover names occasionally arrive padded ("Paul     Wilson").
// Applied on every write path (shelf sync, search/match, single-book fetch).

export function normalizeAuthorName(name: string): string {
  return name.replace(/\s+/g, ' ').trim()
}

/** Normalize a list of author names, dropping any that are empty after trimming. */
export function normalizeAuthors(names: ReadonlyArray<string | null | undefined>): string[] {
  return names.map((n) => normalizeAuthorName(n ?? '')).filter((n) => n.length > 0)
}
