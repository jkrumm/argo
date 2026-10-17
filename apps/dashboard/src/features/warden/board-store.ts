import { createLocalStore, field } from 'basalt-ui/state'
import { BOARD_COLUMN_KEYS } from './page-model'

/** The board column shown at 390, where one column sits under the section's tabs at a time. */
export const boardStore = createLocalStore({
  key: 'warden-board',
  fields: { column: field.enum(BOARD_COLUMN_KEYS, 'working') },
})
