import { z } from 'zod'

// Query-string boolean: only 'true' / 'false' are accepted. `z.coerce.boolean()` is
// `Boolean(value)`, which turns the string 'false' into true. `z.stringbool` (unlike a
// plain enum + transform) still renders as `boolean` in the OpenAPI schema.
export const QueryBool = z.stringbool({ truthy: ['true'], falsy: ['false'] })
