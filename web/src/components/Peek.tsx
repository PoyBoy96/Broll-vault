import { useEffect, useState } from 'react'
import type { Clip } from '../api/types'
import { resolvePreview, previewFailure } from '../hooks/usePreview'
import { fmtBytes, fmtDate, fmtDuration, fmtFps, fmtRes, prettyFolder } from '../lib/format'
import { Meter } from './Meter'
import { StarEditor } from './StarEditor'
import { Thumb } from './Thumb'
import { IconBin, IconClose, IconCopy } from './Icons'

/* ---------------------------------------------------------------------------
   Space peek: large centred frame on an abyss scrim. Arrows walk to adjacent
   clips, 1–5 rates in place, Esc closes. The scrim is a <dialog> so it
   escapes every scrolling container.
   --------------------------------------------------------------------------- */

type Props = {
  clip: Clip
  index: number
  total: number
  busy: boolean
  onClose: () => void
  onStep: (dir: 1 | -1) => void
  onRate: (clip: Clip, stars: number) => void
  onRevert: (clip: Clip) => void
  onAddToBin: (clip: Clip) => void
  onToast: (message: string, kind?: 'ok' | 'warn' | 'err') => void
}

export function Peek({ clip, index, total, busy, onClose, onStep, onRate, onRevert, onAddToBin, onToast }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<'waiting' | 'ready' | 'failed'>('waiting')

  useEffect(() => {
    setSrc(null)
    setState('waiting')
    let alive = true
    void resolvePreview(clip.clip_id).then((s) => {
      if (!alive) return
      setSrc(s)
      setState(s ? 'ready' : 'failed')
    })
    return () => {
      alive = false
    }
  }, [clip.clip_id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        onStep(1)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        onStep(-1)
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault()
        onRate(clip, Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clip, onClose, onStep, onRate])

  const path = clip.absolute_path ?? clip.relative_path ?? ''

  return (
    <div className="peek" role="dialog" aria-modal="true" aria-label={clip.filename ?? 'Clip'} onClick={onClose}>
      <div className="peek__body" onClick={(e) => e.stopPropagation()}>
        <div className="peek__stage">
          <Thumb clip={clip} previewSrc={src} previewWaiting={state === 'waiting'} eager className="thumb--peek" />
          {state === 'failed' ? (
            <span className="peek__note">Preview unavailable{previewFailure(clip.clip_id) ? ` · ${previewFailure(clip.clip_id)}` : ''}</span>
          ) : null}
        </div>
        <div className="peek__side">
          <div className="peek__pos dt">
            {index + 1} / {total.toLocaleString()}
          </div>
          <h2 className="title peek__name">{clip.filename}</h2>
          <div className="peek__crumbs dt">
            {[clip.campus, clip.year_bucket ?? clip.year_int, clip.ministry, clip.shoot].filter(Boolean).map((p, i) => (
              <span key={i}>{prettyFolder(String(p))}</span>
            ))}
          </div>
          <Meter clip={clip} size="large" />
          <StarEditor clip={clip} busy={busy} onRate={(n) => onRate(clip, n)} onRevert={() => onRevert(clip)} />
          {clip.quality_reasons ? <p className="peek__reason">{clip.quality_reasons}</p> : null}
          <dl className="peek__facts">
            <div><dt>Date</dt><dd>{fmtDate(clip.inferred_recorded_date ?? clip.modified_at_utc)}</dd></div>
            <div><dt>Length</dt><dd>{fmtDuration(clip.duration_seconds)}</dd></div>
            <div><dt>Frame</dt><dd>{fmtRes(clip.width, clip.height)}</dd></div>
            <div><dt>Rate</dt><dd>{fmtFps(clip.fps)} fps</dd></div>
            <div><dt>Codec</dt><dd>{[clip.video_codec, (clip.extension ?? '').replace('.', '').toLowerCase()].filter(Boolean).join(' · ') || '–'}</dd></div>
            <div><dt>Size</dt><dd>{fmtBytes(clip.size_bytes)}</dd></div>
          </dl>
          <p className="peek__keys dt">↑ ↓ next · 1–5 rate · Esc close</p>
          <div className="peek__actions">
            <button type="button" className="btn btn--warm" onClick={() => onAddToBin(clip)}><IconBin size={15} /> Add to bin</button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => void navigator.clipboard.writeText(path).then(() => onToast('Path copied')).catch(() => onToast("Couldn't copy path", 'err'))}
            >
              <IconCopy size={15} /> Copy path
            </button>
          </div>
        </div>
        <button type="button" className="peek__close btn btn--icon" onClick={onClose} aria-label="Close">
          <IconClose size={16} />
        </button>
      </div>
    </div>
  )
}
