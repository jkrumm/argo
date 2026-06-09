import { defaultSchema } from 'rehype-sanitize'

// Hardened sanitize schema for LLM-authored markdown. Starts from the GitHub-grade
// `defaultSchema` (no raw <script>/<style>/<iframe>/event handlers, URL protocols
// constrained) and only widens it for the two custom inline-accent elements this
// renderer emits. `language-*` classNames on `code` are already permitted by the
// default schema, so the fenced `card`/`mermaid`/`vega-lite` interception still
// receives its language class. Mermaid/Vega never reach the DOM as HTML — they are
// rendered by bundled inline components (mermaid-diagram.tsx / vega-lite-diagram.tsx).
export const hermesSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'hermes-badge', 'hermes-mark'],
  attributes: {
    ...defaultSchema.attributes,
    'hermes-badge': ['className'],
    'hermes-mark': ['className'],
  },
}
