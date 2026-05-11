---
paths:
  - apps/dashboard/**
---

# TanStack Query — Conventions

## Query factories

Each resource has a factory in `src/lib/queries/<resource>.ts`:

```ts
import { queryOptions } from '@tanstack/react-query'
import { api } from '../eden'

export const myQueries = {
  list: (params: ListParams) =>
    queryOptions({
      queryKey: ['my-resource', 'list', params],
      queryFn: () => api.my_resource.get({ query: params }).then((r) => r.data!),
    }),
  summary: () =>
    queryOptions({
      queryKey: ['my-resource', 'summary'],
      queryFn: () => api.my_resource.summary.get().then((r) => r.data!),
    }),
}
```

- Key hierarchy: `[resource, action, ...params]`
- `queryFn` unwraps `.data!` — treaty responses are typed; throw on null to surface errors
- Never use raw strings as query keys in components — always import from the factory

## Reading data in components

```ts
const { data } = useSuspenseQuery(myQueries.summary())
```

- Always `useSuspenseQuery` inside loaders-prefetched routes (never `useQuery`)
- Wrap pages or panels in `<Suspense fallback={<LoadingOverlay />}>` at the route level

## Mutations

```ts
const mutation = useMutation({
  mutationFn: (body) => api.my_resource.post({ body }).then((r) => r.data!),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['my-resource'] })
    notifications.show({ message: 'Saved', color: 'green' })
  },
})
```

- Invalidate by resource prefix (first key segment) — catches list + summary at once
- Show a notification on success; let errors bubble to the global error boundary

## DevTools

`ReactQueryDevtools` is dev-only — never import it unconditionally:

```ts
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
// rendered only when import.meta.env.DEV
```
