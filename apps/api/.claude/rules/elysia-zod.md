# Elysia + Zod Validation — Argo API Constraints

This file documents constraints and known degradations when using Zod v4 with `@elysiajs/openapi` in this project. The general Elysia patterns are in `~/SourceRoot/dotfiles/rules/elysia.md`; this file only covers Argo-specific Zod constraints.

## Plugin config

```ts
import { openapi } from '@elysiajs/openapi'
import { z } from 'zod'

app.use(openapi({
  mapJsonSchema: { zod: z.toJSONSchema },
  documentation: { ... },
}))
```

`mapJsonSchema: { zod: z.toJSONSchema }` is required for Zod v4. Without it the Scalar UI renders empty schemas.

## TypeBox → Zod conversion reference

| TypeBox                                           | Zod                             |
| ------------------------------------------------- | ------------------------------- |
| `t.String()`                                      | `z.string()`                    |
| `t.Number()`                                      | `z.number()`                    |
| `t.Integer({ minimum: 1 })`                       | `z.number().int().min(1)`       |
| `t.Boolean()`                                     | `z.boolean()`                   |
| `t.Literal('x')`                                  | `z.literal('x')`                |
| `t.Array(X)`                                      | `z.array(X)`                    |
| `t.Object({...})`                                 | `z.object({...})`               |
| `t.Optional(X)`                                   | `X.optional()`                  |
| `t.Union([t.String(), t.Null()])`                 | `z.string().nullable()`         |
| `t.Optional(t.Union([X, t.Null()]))`              | `X.nullish()`                   |
| `t.Union([t.Literal('a'), t.Literal('b')])`       | `z.enum(['a', 'b'])`            |
| `t.String({ description: 'x' })`                  | `z.string().describe('x')`      |
| `t.String({ pattern: '...' })`                    | `z.string().regex(/.../)`       |
| `t.String({ minLength: 1 })`                      | `z.string().min(1)`             |
| `t.Number({ minimum: 0, maximum: 100 })`          | `z.number().min(0).max(100)`    |
| `t.Any()`                                         | `z.unknown()`                   |
| `t.Object({...}, { additionalProperties: true })` | `z.object({...}).passthrough()` |

## Known degradations / rules

**Literal unions — use `z.enum`, never `z.union([z.literal(...)])` in response schemas.**
`@elysiajs/openapi` has a serialization bug where `z.union([z.literal('a'), z.literal('b')])` in a response schema produces invalid OpenAPI JSON. Always use `z.enum(['a', 'b'])` instead.

**Dates — use ISO strings, never `z.date()` or `z.transform()` in route schemas.**
Use `z.string().describe('ISO 8601 date')` or `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`. The wire format is always a string; `z.date()` breaks response serialization.

**No `z.custom()`, `z.void()`, or branded types in route schemas.**
These either don't serialize to JSON Schema cleanly or produce runtime validation errors in the response pipeline.

**Object unions in response schemas (`z.union([objA, objB])`) are allowed.**
The known bug is specifically for literal unions. Object unions render as `oneOf` in the OpenAPI spec and work correctly at runtime.

**`z.unknown()` for truly opaque fields (e.g. TickTick `data: any`).**
Serializes to `{}` in JSON Schema (any type), which is correct for OpenAPI consumers.

**Zod object `.passthrough()` for bodies accepting extra properties.**
Use when the upstream API accepts and forwards unknown keys (e.g. TickTick task create/update).

## Query/path param coercion — use `z.coerce.number()`

Elysia's built-in string→number coercion works for TypeBox `t.Number()` but **not** for Zod `z.number()` in query or path params. The Zod validator receives the raw string from URLSearchParams and rejects it with a 422.

For numeric query/path params, always use `z.coerce.number()`:

```ts
query: z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
})
```

For body fields (JSON-parsed), use plain `z.number()` — JSON already produces a number on the wire.
