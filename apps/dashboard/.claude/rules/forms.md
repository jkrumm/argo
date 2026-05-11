---
paths:
  - apps/dashboard/**
---

# Forms — @mantine/form + Zod

## Setup

```ts
import { useForm } from '@mantine/form'
import { z } from 'zod'

const Schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weight_kg: z.number().min(0),
})

const form = useForm({
  initialValues: { date: '', weight_kg: 0 },
  validate: zodValidator(Schema),
})
```

## zodResolver

`@mantine/form` v9 does not export `zodResolver`. Use the inline resolver from `src/lib/zod-resolver.ts`:

```ts
import type { UseFormInput } from '@mantine/form'
import { z } from 'zod'

export function zodValidator<T>(schema: z.ZodType<T>): UseFormInput<T>['validate'] {
  return (values) => {
    const result = schema.safeParse(values)
    if (result.success) return {}
    return Object.fromEntries(
      result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
    )
  }
}
```

## List helpers

For dynamic lists (e.g., workout sets):

```ts
form.insertListItem('sets', { set_type: 'work', weight_kg: 0, reps: 1 })
form.removeListItem('sets', index)
```

Access items: `form.values.sets[index]` and bind via `form.getInputProps('sets.0.weight_kg')`.

## Submission

```ts
form.onSubmit((values) => {
  mutation.mutate(values)
})
```

Reset after success: `form.reset()`. Never mutate form values directly.
