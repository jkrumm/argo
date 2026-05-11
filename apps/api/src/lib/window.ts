import { z } from 'zod'

export const WindowQuerySchema = z.object({
  window: z.enum(['7d', '30d', '90d', 'all']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

type WindowInput = z.infer<typeof WindowQuerySchema>

export function parseWindow(input: WindowInput): { from: Date; to: Date } {
  const to = new Date()
  if (input.from && input.to) {
    return { from: new Date(input.from), to: new Date(input.to) }
  }
  const windowDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, all: 9999 }
  const days = windowDays[input.window ?? '30d'] ?? 30
  const from = new Date(to.getTime() - days * 86_400_000)
  return { from, to }
}
