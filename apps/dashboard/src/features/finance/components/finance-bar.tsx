import { PageBar } from 'basalt-ui'
import type { ComponentProps, ReactNode } from 'react'
import { useVaultBarProps } from '../lib/vault'

type FinanceBarProps = {
  filters?: ReactNode | undefined
  filtersEnd?: ComponentProps<typeof PageBar>['filtersEnd'] | undefined
}

/**
 * The page bar of every finance page: the sync control (last sync age, "syncing…", error in the
 * danger tone), Lock, and whatever filters the page adds. One component so no page can forget the
 * vault controls.
 */
export function FinanceBar({ filters, filtersEnd }: FinanceBarProps) {
  const vault = useVaultBarProps()
  return (
    <PageBar
      {...vault}
      {...(filters !== undefined && { filters })}
      {...(filtersEnd !== undefined && { filtersEnd })}
    />
  )
}
