import { Card, Text } from '@mantine/core'
import { unknownSiteCopy } from '../formulas'
import classes from './unknown-site-card.module.css'

/** The Forecast tab's stand-in when the selected site is not in the fetched list: the cause and the next step, ending at its content. */
export function UnknownSiteCard({ siteId }: { siteId: string }) {
  return (
    <Card>
      <Text size="sm" c="dimmed" className={classes.copy}>
        {unknownSiteCopy(siteId)}
      </Text>
    </Card>
  )
}
