import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

/* ---------------------------------------------------------------------------
   Hover-with-dwell preview.

   No request fires until the pointer has rested on a row for DWELL ms. A
   cursor crossing forty rows must not queue forty ffmpeg jobs against the
   share. Resolved sources are cached for the session so a second hover is
   instant.
   --------------------------------------------------------------------------- */

export const DWELL_MS = 180

const cache = new Map<number, string>()
const failed = new Map<number, string>()
const inflight = new Map<number, Promise<string | null>>()

export function resolvePreview(clipId: number): Promise<string | null> {
  const hit = cache.get(clipId)
  if (hit) return Promise.resolve(hit)
  if (failed.has(clipId)) return Promise.resolve(null)
  const pending = inflight.get(clipId)
  if (pending) return pending
  const p = api
    .preview(clipId)
    .then((r) => {
      cache.set(clipId, r.src)
      return r.src
    })
    .catch((err: Error) => {
      failed.set(clipId, err.message)
      return null
    })
    .finally(() => inflight.delete(clipId))
  inflight.set(clipId, p)
  return p
}

export function previewFailure(clipId: number): string | null {
  return failed.get(clipId) ?? null
}

export type PreviewState = 'idle' | 'waiting' | 'ready' | 'failed'

/** Call `arm()` on pointer enter, `disarm()` on leave. */
export function usePreview(clipId: number | null) {
  const [state, setState] = useState<PreviewState>('idle')
  const [src, setSrc] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  const disarm = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    setState('idle')
    setSrc(null)
  }, [])

  const arm = useCallback(() => {
    if (clipId === null) return
    if (timer.current) window.clearTimeout(timer.current)
    const hit = cache.get(clipId)
    if (hit) {
      setSrc(hit)
      setState('ready')
      return
    }
    timer.current = window.setTimeout(() => {
      setState('waiting')
      void resolvePreview(clipId).then((s) => {
        if (!alive.current) return
        // Only apply if the pointer is still here (timer not cleared by disarm).
        if (timer.current === null) return
        if (s) {
          setSrc(s)
          setState('ready')
        } else {
          setState('failed')
        }
      })
    }, DWELL_MS)
  }, [clipId])

  return { state, src, arm, disarm }
}
