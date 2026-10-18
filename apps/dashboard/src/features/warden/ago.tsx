import { relativeWhole } from './model'
import { useNow } from '../../lib/use-now'

/** A timestamp in the app's one spelling (`5 min ago`, `in 2 h`), refreshed with the page clock. */
export function Ago({ at }: { at: string }) {
  return relativeWhole(at, useNow())
}
