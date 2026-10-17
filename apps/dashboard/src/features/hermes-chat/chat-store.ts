import { createSearchStore, field } from 'basalt-ui/state'
import { THREAD_TYPES } from './thread-list-model'

// The page's view state: which thread is open, the type filter, the search text. Feature-local
// (not `lib/window-stores.ts`) because nothing outside the page links to it: the nav entry is a
// bare `/hermes-chat`. Every field is URL-only (`persist: false`): a reload keeps the open thread,
// a fresh visit starts on the list. Opening a thread pushes a history entry so Back returns to it.
export const hermesChatStore = createSearchStore({
  key: 'hermes-chat:view',
  fields: {
    thread: field.string({}, { persist: false, history: 'push' }),
    type: field.enum(['all', ...THREAD_TYPES], 'all', { persist: false }),
    q: field.string({}, { persist: false }),
  },
})
