import { useEffect, useRef, useState } from 'react'
import type { Clip } from '../api/types'
import { IconNoFrame } from './Icons'
import { truthy } from '../lib/format'

/* ---------------------------------------------------------------------------
   The frame. Every row carries one, at every density.

   Three sources, in order:
     1. thumb_url  — the pipeline's thumbnail, a plain <img>. Browser-cached.
     2. frame_url  — no catalog thumbnail: ask the backend to grab a frame with
                     ffmpeg. That is slow the first time (network share), so we
                     only ask once the tile has actually sat in the viewport for
                     a moment, and the result is cached on disk forever after.
     3. missing    — the ember state. A state, not a broken image.
   A preview video, when one has been resolved, sits on top of whichever still.
   --------------------------------------------------------------------------- */

const frameFailed = new Set<number>()
const frameOk = new Set<number>()

/* At most a few frame grabs in flight at once. Each one can hold a connection
   for seconds while ffmpeg reads the share; the browser only has six per host
   and the search itself needs some of them. */
const MAX_FRAME_INFLIGHT = 3
let frameInflight = 0
const frameQueue: Array<() => void> = []
function acquireFrameSlot(cb: () => void) {
  if (frameInflight < MAX_FRAME_INFLIGHT) {
    frameInflight++
    cb()
  } else {
    frameQueue.push(cb)
  }
}
function releaseFrameSlot() {
  const next = frameQueue.shift()
  if (next) next()
  else frameInflight = Math.max(0, frameInflight - 1)
}

type Props = {
  clip: Clip
  previewSrc?: string | null
  previewWaiting?: boolean
  className?: string
  eager?: boolean
}

export function Thumb({ clip, previewSrc, previewWaiting, className = '', eager = false }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const offline = clip.is_present !== null && clip.is_present !== undefined && !truthy(clip.is_present)
  const catalogSrc = clip.thumb_url ?? null
  const [wantFrame, setWantFrame] = useState(eager || frameOk.has(clip.clip_id))
  const [failed, setFailed] = useState(frameFailed.has(clip.clip_id))
  const holdsSlot = useRef(false)

  // Ask for a grabbed frame only after the tile has been visible ~500ms, and
  // only when a frame slot is free.
  useEffect(() => {
    if (catalogSrc || wantFrame || failed || offline) return
    if (frameOk.has(clip.clip_id)) {
      setWantFrame(true)
      return
    }
    const el = ref.current
    let timer: number | null = null
    let cancelled = false
    const request = () => {
      if (cancelled) return
      acquireFrameSlot(() => {
        if (cancelled) {
          releaseFrameSlot()
          return
        }
        holdsSlot.current = true
        setWantFrame(true)
      })
    }
    if (!el || typeof IntersectionObserver === 'undefined') {
      request()
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        if (visible && timer === null) {
          timer = window.setTimeout(request, 500)
        } else if (!visible && timer !== null) {
          window.clearTimeout(timer)
          timer = null
        }
      },
      { rootMargin: '80px 0px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [catalogSrc, wantFrame, failed, offline, clip.clip_id])

  const settle = () => {
    if (holdsSlot.current) {
      holdsSlot.current = false
      releaseFrameSlot()
    }
  }
  useEffect(() => () => settle(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const src = catalogSrc ?? (wantFrame && !failed ? clip.frame_url ?? null : null)
  const state = offline ? 'offline' : failed || (!catalogSrc && !wantFrame && frameFailed.has(clip.clip_id)) ? 'missing' : src ? 'img' : 'pending'

  return (
    <div ref={ref} className={`thumb thumb--${state} ${className}`}>
      {src ? (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => {
            frameOk.add(clip.clip_id)
            settle()
          }}
          onError={() => {
            settle()
            if (!catalogSrc) {
              frameFailed.add(clip.clip_id)
              setFailed(true)
            }
          }}
        />
      ) : state === 'missing' || state === 'offline' ? (
        <span className="thumb__glyph">
          <IconNoFrame size={18} />
        </span>
      ) : (
        <span className="thumb__pending" aria-hidden="true" />
      )}
      {previewSrc ? (
        <video
          className="thumb__video"
          src={previewSrc}
          muted
          autoPlay
          loop
          playsInline
          disablePictureInPicture
          onCanPlay={(e) => e.currentTarget.classList.add('is-live')}
        />
      ) : null}
      {previewWaiting && !previewSrc ? <span className="thumb__spin" aria-hidden="true" /> : null}
    </div>
  )
}
