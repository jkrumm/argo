import { Anchor, Button, Text } from '@mantine/core'
import { useCopyAction } from '../../components/upstream/use-copy-action'
import type { SignInStep } from './sign-in'
import classes from './agenda.module.css'

export type SourceError = { label: string; reason: string; step?: SignInStep | undefined }

function CommandStep({ hint, command }: { hint: string; command: string }) {
  const copy = useCopyAction('Copy command', command)
  return (
    <>
      {' '}
      <Text span inherit>
        {hint}
      </Text>{' '}
      <span className={classes.command}>{command}</span>
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

/** One failed source: `{source} unavailable — {reason}`, then its sign-in step on the same line. */
export function SourceErrorLine({ error }: { error: SourceError }) {
  const { step } = error
  return (
    <Text component="div" className={classes.muted}>
      {error.label} unavailable — {error.reason}
      {step?.kind === 'command' && <CommandStep hint={step.hint} command={step.command} />}
      {step?.kind === 'link' && (
        <>
          {' '}
          <Anchor href={step.url} target="_blank" rel="noreferrer" size="sm">
            {step.label}
          </Anchor>
        </>
      )}
    </Text>
  )
}
