import type { UseFormInput } from '@mantine/form'
import { z } from 'zod'

export function zodResolver<T>(schema: z.ZodType<T>): UseFormInput<T>['validate'] {
  return (values) => {
    const result = schema.safeParse(values)
    if (result.success) return {}
    const errors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join('.')
      if (path !== '') errors[path] = issue.message
    }
    return errors
  }
}
