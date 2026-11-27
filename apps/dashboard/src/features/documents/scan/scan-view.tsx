import { Alert, Box, Button, Group, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react'
import { EmptyState, Section, StatCard } from 'basalt-ui'
import { CONTAINER_KEYS } from 'basalt-ui/tokens'
import { AuthImage } from '../auth-image'
import type { ScanButton, ScanThumb, ScanView } from './model'

export type ScanViewProps = {
  view: ScanView
  /** A call is running: every button waits. */
  busy: boolean
  pressed: string | null
  /** The line after a submit: `Filed: 8 + 8 pages`. */
  filed: string | null
  /** The last call's own error text. */
  error: string | null
  onPress: (button: ScanButton) => void
  onOpenPage: (thumb: ScanThumb) => void
  onDismissFailure: () => void
  onDismissFiled: () => void
}

function ActionButton({
  button,
  busy,
  pressed,
  onPress,
}: {
  button: ScanButton
  busy: boolean
  pressed: string | null
  onPress: (button: ScanButton) => void
}) {
  return (
    <Stack gap={4}>
      <Button
        fullWidth
        size="lg"
        variant={button.primary ? 'filled' : 'default'}
        {...(button.id === 'discard' && { color: 'red' })}
        loading={pressed === button.id}
        disabled={busy && pressed !== button.id}
        onClick={() => onPress(button)}
      >
        {button.label}
      </Button>
      {button.hint && (
        <Text size="xs" c="dimmed" ta="center">
          {button.hint}
        </Text>
      )}
    </Stack>
  )
}

function Thumbs({ thumbs, onOpen }: { thumbs: ScanThumb[]; onOpen: (thumb: ScanThumb) => void }) {
  return (
    <SimpleGrid type="container" cols={{ base: 3, [CONTAINER_KEYS.regular]: 6 }} spacing="sm">
      {thumbs.map((thumb) => (
        <UnstyledButton
          key={thumb.key}
          onClick={() => onOpen(thumb)}
          aria-label={`Enlarge ${thumb.label}`}
        >
          <Stack gap={4}>
            <Box h={140} data-private>
              <AuthImage path={thumb.thumbUrl} version={thumb.version} alt={thumb.label} />
            </Box>
            <Text size="xs" c="dimmed" ta="center">
              {thumb.label}
            </Text>
          </Stack>
        </UnstyledButton>
      ))}
    </SimpleGrid>
  )
}

/** The Scan page for one `scanView`: pure markup, every call and prompt is the parent's. */
export function ScanViewPanel({
  view,
  busy,
  pressed,
  filed,
  error,
  onPress,
  onOpenPage,
  onDismissFailure,
  onDismissFiled,
}: ScanViewProps) {
  const { phase } = view
  return (
    <Stack gap="md" data-phase={phase}>
      {view.failure && (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={18} />}
          title={view.failure.needsForce ? 'The last scan failed' : 'The scan did not finish'}
          withCloseButton={!view.failure.needsForce}
          onClose={onDismissFailure}
        >
          {view.failure.message}
        </Alert>
      )}
      {error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="That did not work">
          {error}
        </Alert>
      )}
      {filed && (
        <Alert
          color="green"
          icon={<IconCheck size={18} />}
          title={filed}
          withCloseButton
          onClose={onDismissFiled}
        >
          The pipeline reads it within a few minutes.{' '}
          <Text component={Link} to="/documents/review" inherit c="var(--vx-accent)">
            Open Review
          </Text>
          .
        </Alert>
      )}

      {phase === 'idle' && (
        <Section title="Start a scan">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Put the paper in the feeder or on the glass, then choose how to scan it.
            </Text>
            {view.buttons.length === 0 ? (
              <EmptyState title="The scanner offers nothing right now" />
            ) : (
              view.buttons.map((button) => (
                <ActionButton
                  key={button.id}
                  button={button}
                  busy={busy}
                  pressed={pressed}
                  onPress={onPress}
                />
              ))
            )}
          </Stack>
        </Section>
      )}

      {phase !== 'idle' && view.figure !== null && (
        <StatCard
          title={view.caption ?? 'Pages scanned'}
          value={view.figure}
          unit="pages"
          subtitle={
            phase === 'scanning'
              ? 'Updated every 2 seconds'
              : 'Compare with your sheets: the scanner reports a stopped feeder as a success'
          }
          breakdown={view.rows.map((row) => ({
            label: row.label,
            value: row.value,
            ...(row.bad && { tone: 'bad' as const }),
          }))}
          {...(view.mismatch && { tone: 'bad' as const })}
        />
      )}
      {view.mismatch && (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={18} />}
          title="Fronts and backs do not match"
        >
          {view.mismatch} Check the stack before you submit.
        </Alert>
      )}

      {view.thumbs.length > 0 && (
        <Section title="Pages" count={view.thumbs.length}>
          <Thumbs thumbs={view.thumbs} onOpen={onOpenPage} />
        </Section>
      )}

      {phase !== 'idle' && phase !== 'scanning' && view.buttons.length > 0 && (
        <Section title="Next">
          <Group grow align="flex-start" gap="md">
            {view.buttons.map((button) => (
              <ActionButton
                key={button.id}
                button={button}
                busy={busy}
                pressed={pressed}
                onPress={onPress}
              />
            ))}
          </Group>
        </Section>
      )}
    </Stack>
  )
}
