import { EmptyState } from 'basalt-ui'
import { unknownSiteCopy } from '../formulas'
import classes from './unknown-site-card.module.css'

/** The Forecast tab's stand-in when the selected site is not in the fetched list: the gap as the title, the next step as the description. No action: the page has no "reset site" route change to offer. */
export function UnknownSiteCard({ siteId }: { siteId: string }) {
  const { title, hint } = unknownSiteCopy(siteId)
  return <EmptyState tier="section" title={title} description={hint} className={classes.copy} />
}
