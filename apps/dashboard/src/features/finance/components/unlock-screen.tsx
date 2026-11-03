import { Button, Container, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { IconLockOpen } from '@tabler/icons-react'
import { PageTitle } from 'basalt-ui'
import { useRef, useState, type FormEvent } from 'react'
import { FINANCE_STATUS_KEY } from '../api/client'
import { unlockVault, type LockedStatus } from '../api/status'
import { dateTime } from '../lib/time'

/** The account name 1Password stores the vault key under; the form shows it so autofill matches. */
const VAULT_USERNAME = 'finances-vault'

type Props = { blockedUntil: LockedStatus['unlock_blocked_until'] }

/**
 * The one screen of a locked vault. A real login form (a read-only username plus a password field
 * named `password`) so 1Password offers the vault key on the MacBook and the iPhone.
 *
 * The key lives only in the uncontrolled input: it is read from the form on submit, sent once, and
 * the field is cleared before the answer arrives. It is never put in React state, a query or
 * mutation (their variables outlive the call), storage or a log line.
 */
export function UnlockScreen({ blockedUntil }: Props) {
  const queryClient = useQueryClient()
  const form = useRef<HTMLFormElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = form.current
    if (element === null || pending) return
    const field = element.elements.namedItem('password')
    if (!(field instanceof HTMLInputElement)) return
    const key = field.value.trim()
    field.value = ''
    if (key === '') return

    setPending(true)
    setMessage(null)
    const outcome = await unlockVault(key)
    setPending(false)
    switch (outcome.kind) {
      case 'unlocked':
        await queryClient.invalidateQueries({ queryKey: FINANCE_STATUS_KEY })
        return
      case 'wrong-key':
        setMessage('That is not the vault key.')
        return
      case 'throttled':
        setMessage(
          outcome.blockedUntil === null
            ? 'Too many wrong keys. Unlocking is paused for a while.'
            : `Too many wrong keys. Unlocking is paused until ${dateTime(outcome.blockedUntil)}.`,
        )
        void queryClient.invalidateQueries({ queryKey: FINANCE_STATUS_KEY })
        return
      case 'unavailable':
        setMessage('The finance service is not reachable. Try again in a moment.')
        return
    }
  }

  const blocked =
    blockedUntil === null ? null : `Unlocking is paused until ${dateTime(blockedUntil)}.`

  return (
    <Container size="xs" pt={64} pb={64}>
      <Stack gap="lg">
        <Stack gap={4}>
          <PageTitle title="Finances are locked" />
          <Text c="dimmed" size="sm">
            The vault stays encrypted on the mini until you unlock it. Let 1Password fill the vault
            key, then unlock. It locks again after 30 idle minutes.
          </Text>
        </Stack>
        <form ref={form} onSubmit={(event) => void submit(event)} autoComplete="on">
          <Stack gap="sm">
            <TextInput
              label="Vault"
              name="username"
              value={VAULT_USERNAME}
              readOnly
              autoComplete="username"
            />
            <PasswordInput
              label="Vault key"
              name="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-autofocus
              error={message ?? blocked ?? undefined}
            />
            <Button type="submit" leftSection={<IconLockOpen size={16} />} loading={pending}>
              Unlock
            </Button>
          </Stack>
        </form>
      </Stack>
    </Container>
  )
}
