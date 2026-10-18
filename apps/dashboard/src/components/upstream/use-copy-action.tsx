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
  return {
    label: clipboard.error ? 'Copy failed' : clipboard.copied ? 'Copied' : label,
    icon: clipboard.copied ? <IconCheck size={14} /> : <IconCopy size={14} />,
    onClick: () => clipboard.copy(text),
  }
}
