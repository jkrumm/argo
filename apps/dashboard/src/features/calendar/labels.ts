import { glue } from '../../lib/format'

/** Feed names as the copy prints them: multi-word product names glued, so a line never breaks inside one. */
export const FEED_LABEL = {
  personal: 'Google',
  work: glue('Microsoft 365'),
} satisfies Record<'personal' | 'work', string>
