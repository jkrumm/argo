import { Modal } from '@mantine/core'
import { AuthImage } from '../auth-image'
import type { ScanThumb } from './model'

/** One scanned page at full size: a tap on a thumbnail opens it. */
export function PageModal({ thumb, onClose }: { thumb: ScanThumb | null; onClose: () => void }) {
  return (
    <Modal opened={thumb !== null} onClose={onClose} title={thumb?.label} size="xl" centered>
      {thumb && (
        <AuthImage path={thumb.pageUrl} version={thumb.version} alt={`Scanned ${thumb.label}`} />
      )}
    </Modal>
  )
}
