import { Alert } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { readDueOptions } from '../api/read-due'
import { readDueText } from '../lib/read-due'

/** Shown above every open finance page while ING has announced documents a supervised read has not collected. It only points at the read; nothing runs from here. */
export function ReadDueBanner() {
  const readDue = useQuery(readDueOptions)
  const text = readDueText(readDue.data)
  if (text === null) return null
  return (
    <Alert title="ING read due" mb="md">
      {text}
    </Alert>
  )
}
