import type { SanitizeSchemaExtension } from 'basalt-ui/content'

// Additions-only extension for `Markdown`'s `sanitizeSchema` prop — basalt merges this OVER its
// own additions layer, which is itself layered over rehype-sanitize's `defaultSchema` (see
// basalt-ui/content's sanitize docs). Removal is deliberately unrepresentable in this shape; this
// widens the baseline for exactly the two custom inline-accent elements remark-hermes-accents.ts
// emits (`:badge[…]` → hermes-badge, `==mark==` → hermes-mark) and nothing else. `language-*`
// classNames on `code` are already permitted by the default schema, so the fenced
// `card`/`mermaid`/`vega-lite` interception still receives its language class without any addition
// here.
export const hermesSanitizeSchema: SanitizeSchemaExtension = {
  tagNames: ['hermes-badge', 'hermes-mark'],
  attributes: {
    'hermes-badge': ['className'],
    'hermes-mark': ['className'],
  },
}
