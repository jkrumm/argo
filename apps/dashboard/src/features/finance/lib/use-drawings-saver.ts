import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { saveDrawings, reportWriteError } from '../api/mutations'
import { drawingsOptions } from '../api/queries'
import type { DrawingsDocument } from './depot-chart'

/** The quiet time after the last change before the document is stored. */
const SAVE_DELAY_MS = 500

/**
 * Stores the drawing document of one instrument about half a second after its last change. What is
 * waiting goes out when the instrument changes, the component unmounts or the tab is hidden; a save
 * that fails is reported and tried again with the next change, the document is never discarded.
 * Saves go out one after the other, so an older document cannot land after a newer one.
 */
export function useDrawingsSaver(isin: string): (document: DrawingsDocument) => void {
  const queryClient = useQueryClient()
  const waiting = useRef<DrawingsDocument | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    async function send(document: DrawingsDocument) {
      try {
        const saved = await saveDrawings(isin, document)
        // The cache holds the newest document already; this answer may be older than it.
        queryClient.setQueryData(drawingsOptions(isin).queryKey, (held) =>
          held === undefined ? saved : { ...saved, document: held.document },
        )
      } catch (error) {
        waiting.current ??= document
        reportWriteError(error)
      }
    }
    function flush() {
      clearTimeout(timer.current)
      const document = waiting.current
      if (document === null) return queue.current
      waiting.current = null
      queue.current = queue.current.then(() => send(document))
      return queue.current
    }
    flushRef.current = flush
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      void flush()
    }
  }, [isin, queryClient])

  return (document) => {
    // The cache holds the newest document at once: a chart drawn again (another currency) reads it before the save ran.
    queryClient.setQueryData(drawingsOptions(isin).queryKey, (held) =>
      held === undefined ? held : { ...held, document },
    )
    waiting.current = document
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS)
  }
}
