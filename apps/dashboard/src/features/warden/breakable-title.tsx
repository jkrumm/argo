import { Fragment } from 'react'
import { titleSegments } from './page-model'

/** A title whose long identifier tokens may break after `.` `/` `_` `-` `::` (`<wbr>`); copy and search see the plain text. */
export function BreakableTitle({ text }: { text: string }) {
  return titleSegments(text).map((segment, i) => (
    <Fragment key={i}>
      {segment.breakBefore ? <wbr /> : null}
      {segment.text}
    </Fragment>
  ))
}
