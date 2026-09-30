/**
 * container-grid.ts — the page-layout breakpoints, keyed on a grid's OWN width instead of the
 * viewport (basalt-ui MIGRATING.md § 1.32.0, `basalt/raw-breakpoint`).
 *
 * These are `CONTAINER_CLASSES` (compact 240 · regular 480 · wide 800) written out: basalt-ui 1.32.0
 * documents the table as a `basalt-ui/tokens` export but does not ship it there, so there is
 * nothing to import. Swap these for the import once it exists.
 *
 * Mapping used across the app: old viewport `sm` → `regular`, old `md`/`lg`/`xl` → `wide`.
 *  - `SimpleGrid type="container"` writes each `cols` key verbatim as a CSS length, so its keys are
 *    the px strings below (`sm` would be a dead query).
 *  - `Grid type="container"` only goes container with a `breakpoints` map, typed
 *    `Record<MantineSize, string>` (all five keys); `Grid.Col` spans then resolve through it. The
 *    lint rule reads that map statically, so each route declares it as a same-file literal built
 *    from these px strings — an imported map object reads as "unresolvable" and is flagged.
 */
export const CQ_COMPACT = '240px'
export const CQ_REGULAR = '480px'
/** `wide` as a number, for a measured width compared in JS (walking-pad's column matching). */
export const CONTAINER_WIDE = 800
export const CQ_WIDE = `${CONTAINER_WIDE}px`
