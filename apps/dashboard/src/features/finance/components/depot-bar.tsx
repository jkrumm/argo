import { PageBar } from 'basalt-ui'
import { ViewTabs } from 'basalt-ui/controls'
import { useVaultBarProps } from '../lib/vault'
import { finStore } from '../../../lib/window-stores'

/** The page bar of the depot page: the vault controls of every finance page, and the switch between the three views. */
export function DepotBar() {
  const vault = useVaultBarProps()
  return <PageBar {...vault} tabs={<ViewTabs field={finStore.field.view} label="Depot view" />} />
}
