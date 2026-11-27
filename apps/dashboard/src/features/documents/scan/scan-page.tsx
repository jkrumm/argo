import { Alert, Button, Loader, Stack } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { PageBar } from 'basalt-ui'
import { overlays } from 'basalt-ui/commands'
import { useState } from 'react'
import { paperError, paperQueries, useScanCalls } from '../../../lib/queries/paper'
import { scanView, type ScanButton, type ScanThumb, type ScanView } from './model'
import { PageModal } from './page-modal'
import { ScanViewPanel } from './scan-view'

const filedLine = (view: ScanView): string =>
  `Filed: ${view.figure ?? '0'} ${view.figure === '1' ? 'page' : 'pages'}`

export function ScanPage() {
  const status = useQuery(paperQueries.scanStatus())
  const calls = useScanCalls()
  const [pressed, setPressed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filed, setFiled] = useState<string | null>(null)
  const [open, setOpen] = useState<ScanThumb | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (status.data === undefined) {
    return (
      <>
        <PageBar />
        {status.isError ? (
          <Alert color="red" title="The scanner status did not load">
            <Stack gap="sm" align="flex-start">
              {paperError(status.error)}
              <Button variant="default" onClick={() => void status.refetch()}>
                Try again
              </Button>
            </Stack>
          </Alert>
        ) : (
          <Loader size="sm" />
        )}
      </>
    )
  }

  const view = scanView(status.data)
  const shown: ScanView = view.failure?.key === dismissed ? { ...view, failure: null } : view
  const busy = pressed !== null || view.phase === 'scanning'

  const run = async (button: ScanButton) => {
    setPressed(button.id)
    setError(null)
    try {
      if (button.mode) {
        setFiled(null)
        await calls.start.mutateAsync(button.mode)
      } else if (button.submit) {
        await calls.submit.mutateAsync(button.submit.force)
        setFiled(filedLine(view))
      } else if (button.discard) {
        await calls.discard.mutateAsync()
      }
    } catch (failure) {
      setError(paperError(failure))
    } finally {
      setPressed(null)
    }
  }

  const press = (button: ScanButton) => {
    const { confirm } = button
    if (!confirm) return void run(button)
    void overlays.confirm({
      title: confirm.title,
      body: confirm.body,
      confirmLabel: confirm.confirmLabel,
      cancelLabel: 'Cancel',
      ...(confirm.danger && { danger: true }),
      onConfirm: () => void run(button),
    })
  }

  return (
    <>
      <PageBar
        sync={{ syncing: status.isFetching, onSync: () => void status.refetch(), label: 'Refresh' }}
      />
      <ScanViewPanel
        view={shown}
        busy={busy}
        pressed={pressed}
        filed={filed}
        error={error}
        onPress={press}
        onOpenPage={setOpen}
        onDismissFailure={() => setDismissed(view.failure?.key ?? null)}
        onDismissFiled={() => setFiled(null)}
      />
      <PageModal thumb={open} onClose={() => setOpen(null)} />
    </>
  )
}
