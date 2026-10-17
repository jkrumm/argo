import { createLocalStore, field } from 'basalt-ui/state'

export const VIEW_KEYS = ['chats', 'teams', 'feed'] as const
export type ViewKey = (typeof VIEW_KEYS)[number]

/**
 * The explorer's view state: which list is shown, the tag filter and the search term. A local store,
 * not a search store — `lib/window-stores.ts` is outside this page's owned files.
 */
export const explorerStore = createLocalStore({
  key: 'm365-explorer',
  fields: {
    view: field.enum(VIEW_KEYS, 'chats'),
    tag: field.string({ fallback: '' }),
    q: field.string({ fallback: '' }),
  },
})
