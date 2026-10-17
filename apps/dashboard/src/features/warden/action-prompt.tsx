import { Button, Group, Modal, Stack, Textarea } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useState } from 'react'
import type { PromptState, PromptVerb } from './action-verbs'

/** One shared modal instance, reused across every item/verb prompt on the page. */
export function ActionPromptModal({
  prompt,
  onClose,
  onSubmit,
}: {
  prompt: PromptState
  onClose: () => void
  onSubmit: (text: string) => void
}) {
  const form = useForm({ initialValues: { text: '' } })
  // The modal fades out after `prompt` goes null; keep the last verb so its copy does not flip mid-fade.
  const [lastVerb, setLastVerb] = useState<PromptVerb>('dismiss')
  if (prompt !== null && prompt.verb !== lastVerb) setLastVerb(prompt.verb)
  const verb = prompt?.verb ?? lastVerb

  // Reset on every close path (submit, X, overlay click, ESC) so a closed-without-submitting
  // prompt never leaves stale text pre-filled (and already valid) for the next item's prompt.
  function handleClose() {
    form.reset()
    onClose()
  }

  return (
    <Modal
      opened={prompt !== null}
      onClose={handleClose}
      title={verb === 'dismiss' ? 'Dismiss reason' : 'Add a note'}
    >
      <form
        onSubmit={form.onSubmit((values) => {
          onSubmit(values.text)
          form.reset()
        })}
      >
        <Stack gap="sm">
          <Textarea
            autosize
            minRows={2}
            label={verb === 'dismiss' ? 'Reason' : 'Note'}
            placeholder={verb === 'dismiss' ? 'Why dismiss this item?' : 'Note text'}
            {...form.getInputProps('text')}
          />
          <Group justify="flex-end">
            <Button type="submit" disabled={form.values.text.trim().length === 0}>
              Submit
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
