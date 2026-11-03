import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { FILTERS_CLEARED } from '../../../lib/window-stores'

/** An event's bookings: the transactions page with only that event kept. */
export function EventLink({ eventId, children }: { eventId: string; children: ReactNode }) {
  return (
    <Link to="/finance/transactions" search={{ ...FILTERS_CLEARED, event: eventId }}>
      {children}
    </Link>
  )
}
