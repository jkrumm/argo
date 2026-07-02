import { z } from 'zod'

// Shared Zod schemas and pure parser for `card` fenced code blocks.
// Kept framework-free so it can be imported by both the React component
// and unit tests without pulling in browser globals.

const Status = z.enum(['ok', 'warn', 'err'])

export const InfraCard = z.object({
  type: z.literal('infra'),
  title: z.string().optional(),
  status: Status.optional(),
  detail: z.string().optional(),
  items: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().optional(),
        status: Status.optional(),
      }),
    )
    .optional(),
})

export const TodoCard = z.object({
  type: z.literal('todo'),
  title: z.string().optional(),
  items: z.array(z.object({ text: z.string(), done: z.boolean().optional() })),
})

export const NoteCard = z.object({
  type: z.literal('note'),
  title: z.string().optional(),
  body: z.string(),
})

export const AudioCard = z.object({
  type: z.literal('audio'),
  title: z.string().optional(),
  src: z.string().optional(),
  durationMs: z.number().optional(),
  // The podcast script — synthesized on first play (lazy). NEVER rendered as prose.
  script: z.string().optional(),
})

export type AudioCardData = z.infer<typeof AudioCard>

export const CardSchema = z.discriminatedUnion('type', [InfraCard, TodoCard, NoteCard, AudioCard])
export type SmartCardData = z.infer<typeof CardSchema>

/** Parse a fenced `card` block body. Returns null on any malformed/unknown JSON. */
export function parseCard(raw: string): SmartCardData | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const result = CardSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}
