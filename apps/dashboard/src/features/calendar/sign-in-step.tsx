import { Anchor, Button, Code, Text } from '@mantine/core'
import { useCopyAction } from '../../components/upstream/use-copy-action'
import type { SignInStep } from './query-state'

function CommandStep({ hint, command }: { hint: string; command: string }) {
  const copy = useCopyAction('Copy command', command)
  return (
    <>
      {' '}
      <Text span inherit>
        {hint}
      </Text>{' '}
      <Code>{command}</Code>
      {copy && (
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          leftSection={copy.icon}
          onClick={copy.onClick}
        >
          {copy.label}
        </Button>
      )}
    </>
  )
}

/** The step beside a sign-in failure, on the same line as the `unavailable — token expired.` sentence. */
export function SignInStepView({ step }: { step: SignInStep }) {
  if (step.kind === 'command') return <CommandStep hint={step.hint} command={step.command} />
  return (
    <>
      {' '}
      <Anchor href={step.url} target="_blank" rel="noreferrer" size="sm">
        {step.label}
      </Anchor>
    </>
  )
}
