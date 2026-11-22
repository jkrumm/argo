import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { saveDrawings, reportWriteError } from '../api/mutations'
import { drawingsOptions } from '../api/queries'
import type { DrawingsDocument } from './depot-chart'

/** The quiet time after the last change before the document is stored. */
export const SAVE_DELAY_MS = 500

/**
 * Stores the drawing document of one instrument about half a second after its last change. What is
 * waiting goes out when the instrument changes, the component unmounts or the tab is hidden; a save
 * that fails is reported and tried again with the next change, the document is never discarded.
 */
export function useDrawingsSaver(isin: string): (document: DrawingsDocument) => void {
  const queryClient = useQueryClient()
  const waiting = useRef<DrawingsDocument | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    async function flush() {
      clearTimeout(timer.current)
      const document = waiting.current
      if (document === null) return
      waiting.current = null
      try {
        const saved = await saveDrawings(isin, document)
        queryClient.setQueryData(drawingsOptions(isin).queryKey, saved)
      } catch (error) {
        waiting.current ??= document
        reportWriteError(error)
      }
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
    waiting.current = document
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flushRef.current(), SAVE_DELAY_MS)
  }
}
