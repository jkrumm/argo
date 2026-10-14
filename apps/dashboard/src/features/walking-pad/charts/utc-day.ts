/** A `YYYY-MM-DD` bucket key as the UTC instant the API bucketed on. */
export const utcDay = (key: string): Date => new Date(`${key}T00:00:00Z`)
