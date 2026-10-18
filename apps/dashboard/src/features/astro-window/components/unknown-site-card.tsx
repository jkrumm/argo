import { EmptyState } from 'basalt-ui'
import { unknownSiteCopy } from '../formulas'
import classes from './unknown-site-card.module.css'

/**
 * The Forecast tab's stand-in when the selected site is not in the fetched list: the gap as the
 * title, the next step as the description. No action: the page has no "reset site" route change to
 * offer. The site id comes from the URL, so the `title`/`description` slots (where the text lives;
 * `className` only reaches the root) carry the wrap rule.
 */
export function UnknownSiteCard({ siteId }: { siteId: string }) {
  const { title, hint } = unknownSiteCopy(siteId)
  return (
    <EmptyState
      tier="section"
      title={title}
      description={hint}
      classNames={{ title: classes.copy, description: classes.copy }}
    />
  )
}
