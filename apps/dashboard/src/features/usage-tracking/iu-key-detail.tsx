import type { Range } from '../../lib/queries/usage'
import type { IuKeyId } from './accounts'

// Seam stub for usage v7 (Wave 8): the IU key node's detail (cap, can spend today, under-cap date,
// portal vs tracked, top spenders, cost per 1 M), built by its own change. The props are the contract.
export interface IuKeyDetailProps {
  iuKey: IuKeyId
  range: Range
}

export function IuKeyDetail(_props: IuKeyDetailProps) {
  return null
}
