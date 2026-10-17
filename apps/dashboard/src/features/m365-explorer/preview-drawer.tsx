import { ActionIcon, Drawer } from '@mantine/core'
import { IconArrowLeft } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import classes from './m365.module.css'

/** The 390 px preview: a full-screen sheet with a back affordance. */
export function PreviewDrawer(props: {
  opened: boolean
  onClose: () => void
  children: ReactNode
}) {
  return (
    <Drawer
      opened={props.opened}
      onClose={props.onClose}
      position="right"
      size="100%"
      withCloseButton={false}
      padding={0}
      title={
        <span className={classes.sheetBack}>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Back to sources"
            onClick={props.onClose}
          >
            <IconArrowLeft size={18} />
          </ActionIcon>
          Sources
        </span>
      }
    >
      <div className={classes.sheetBody}>{props.children}</div>
    </Drawer>
  )
}
