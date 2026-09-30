/**
 * container-grid.ts — the page-layout breakpoints, keyed on a grid's OWN width instead of the
 * viewport (basalt-ui MIGRATING.md § 1.32.0, `basalt/raw-breakpoint`), as the CSS lengths Mantine's
 * container grids take, derived from basalt's `CONTAINER_CLASSES` (compact 240 · regular 480 · wide 800).
 *
 * Mapping used across the app: old viewport `sm` → `regular`, old `md`/`lg`/`xl` → `wide`.
 *  - `SimpleGrid type="container"` writes each `cols` key verbatim as a CSS length, so its keys are
 *    the px strings below (`sm` would be a dead query).
 *  - `Grid type="container"` only goes container with a `breakpoints` map, typed
 *    `Record<MantineSize, string>` (all five keys); `Grid.Col` spans then resolve through it. The
 *    lint rule reads that map statically, so each route declares it as a same-file literal built
 *    from these px strings — an imported map object reads as "unresolvable" and is flagged.
 */
import { CONTAINER_CLASSES } from 'basalt-ui/tokens'

export const CQ_COMPACT = `${CONTAINER_CLASSES.compact}px`
export const CQ_REGULAR = `${CONTAINER_CLASSES.regular}px`
export const CQ_WIDE = `${CONTAINER_CLASSES.wide}px`
