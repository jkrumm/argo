import { createLocalStore, field } from 'basalt-ui/state'

const VIEW_KEYS = ['chats', 'teams', 'feed'] as const
export type ViewKey = (typeof VIEW_KEYS)[number]

/** Phone only: which pane the single column shows. Wide layouts show the list and the detail side by side. */
const PANE_KEYS = ['sources', 'labeled', 'detail'] as const
export type PaneKey = (typeof PANE_KEYS)[number]

/**
 * The explorer's view state: which list is shown, the tag filter, the search term and, on a phone,
 * which pane is open. A local store, not a search store — `lib/nav.tsx` links the route without
 * search and is outside this page's owned files.
 */
export const explorerStore = createLocalStore({
  key: 'm365-explorer',
  fields: {
    view: field.enum(VIEW_KEYS, 'chats'),
    tag: field.string({ fallback: '' }),
    q: field.string({ fallback: '' }),
    pane: field.enum(PANE_KEYS, 'sources'),
  },
})
