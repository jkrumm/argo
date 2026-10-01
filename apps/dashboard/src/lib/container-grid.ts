/**
 * container-grid.ts — the `SimpleGrid type="container"` keys, keyed on a grid's OWN width instead
 * of the viewport (basalt-ui MIGRATING.md § 1.32.0, `basalt/raw-breakpoint`), as the CSS lengths
 * Mantine writes verbatim into its `@container` queries, derived from basalt's `CONTAINER_CLASSES`
 * (regular 480 · wide 800). `sm` there would be a dead query.
 *
 * Mapping used across the app: old viewport `sm` → `regular`, old `md`/`lg`/`xl` → `wide`.
 * `Grid type="container"` takes basalt's own `CONTAINER_GRID_BREAKPOINTS` (`basalt-ui/tokens`),
 * which `Grid.Col` spans resolve through on that same mapping.
 */
import { CONTAINER_CLASSES } from 'basalt-ui/tokens'

export const CQ_REGULAR = `${CONTAINER_CLASSES.regular}px`
export const CQ_WIDE = `${CONTAINER_CLASSES.wide}px`
