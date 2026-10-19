import { Fragment } from 'react'
import { titleSegments } from './page-model'

/** A title whose long identifier tokens may break after `.` `/` `_` `-` `::` (`<wbr>`), copy and search see the plain text. */
export function BreakableTitle({ text }: { text: string }) {
  const segments = titleSegments(text)
  return segments.map((segment, i) => (
    <Fragment key={i}>
      {i > 0 && !/\s/.test(segment) && !/\s/.test(segments[i - 1]!) ? <wbr /> : null}
      {segment}
    </Fragment>
  ))
}
