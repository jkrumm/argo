import { useClipboard } from '@mantine/hooks'
import { IconCheck, IconCopy } from '@tabler/icons-react'
import type { DecisionCardAction } from './decision-card-model'

/**
 * A card action that copies `value`; its label reads `Copied` (or `Copy failed`) for a moment
 * afterwards. A blank value is no action at all, never a button that copies nothing.
 */
export function useCopyAction(
  label: string,
  value: string | null | undefined,
): DecisionCardAction | undefined {
  const clipboard = useClipboard({ timeout: 1500 })
  const text = value?.trim() ?? ''
  if (text === '') return undefined
  const labelNow = (): string => {
    if (clipboard.copied) return 'Copied'
    if (clipboard.error) return 'Copy failed'
    return label
  }
  return {
    label: labelNow(),
    icon: clipboard.copied ? <IconCheck size={14} /> : <IconCopy size={14} />,
    onClick: () => {
      // A failed copy leaves its error up until reset: clear it so a retry starts clean.
      clipboard.reset()
      clipboard.copy(text)
    },
  }
}
