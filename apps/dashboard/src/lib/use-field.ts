/**
 * Reads a basalt-ui field handle. React Compiler does not recognise a bare `store.field.x.use()`
 * as a hook and memoizes it, so the hook runs on the first render only (React #311).
 * A call through a hook-named function is never memoized.
 */
export function useField<R>(field: { use(): R }): R {
  'use no memo'
  return field.use()
}
