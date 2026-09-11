import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Bin, Clip, ClipDetail } from '../api/types'
import { resolvePreview } from '../hooks/usePreview'
import { fmtBytes, fmtDate, fmtDuration, fmtFps, fmtRes, prettyFolder, truthy } from '../lib/format'
import { StarEditor } from './StarEditor'
import { Thumb } from './Thumb'
import { IconBin, IconCopy, IconExpand, IconPlus } from './Icons'

/* ---------------------------------------------------------------------------
   Detail panel: the big frame, the name, your rating, and the facts.
   The preview plays here without a dwell — selecting a row is intent enough.
   --------------------------------------------------------------------------- */

type Props = {
  clip: Clip | null
  bins: Bin[]
  busy: boolean
  onRate: (clip: Clip, stars: number) => void
  onRevert: (clip: Clip) => void
  onAddToBin: (binId: string | 'new', clip: Clip) => void
  onPeek: (clip: Clip) => void
  onToast: (msg: string, kind?: 'ok' | 'warn' | 'err') => void
}

export function Detail({ clip, bins, busy, onRate, onRevert, onAddToBin, onPeek, onToast }: Props) {
  const [detail, setDetail] = useState<ClipDetail | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [binPick, setBinPick] = useState('')

  useEffect(() => {
    setDetail(null)
    setPreview(null)
    if (!clip) return
    let alive = true
    void api.clip(clip.clip_id).then((d) => alive && setDetail(d)).catch(() => undefined)
    const t = window.setTimeout(() => {
      void resolvePreview(clip.clip_id).then((s) => alive && setPreview(s))
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [clip?.clip_id, clip?.has_user_edits, clip?.quality_stars]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!clip) {
    return (
      <aside className="detail card detail--empty" aria-label="Clip detail">
        <p className="detail__hint">Select a clip to see it here.</p>
        <p className="detail__hint dt">↑ ↓ move · Space peek · 1–5 rate · B add to bin</p>
      </aside>
    )
  }

  const live: Clip = detail ? { ...detail, ...clip } : clip
  const path = live.absolute_path ?? live.relative_path ?? ''
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onToast(`${what} copied`)
    } catch {
      onToast(`Couldn't copy ${what.toLowerCase()}`, 'err')
    }
  }

  return (
    <aside className="detail card" aria-label="Clip detail">
      <button type="button" className="detail__frame" onClick={() => onPeek(live)} title="Open peek (Space)">
        <Thumb clip={live} previewSrc={preview} eager />
        <span className="detail__expand">
          <IconExpand size={14} />
        </span>
      </button>

      <h2 className="detail__name title" title={live.filename ?? ''}>
        {live.filename ?? live.relative_path}
      </h2>
      <div className="detail__crumbs dt">
        {[live.campus, live.year_bucket ?? live.year_int, live.ministry, live.shoot]
          .filter(Boolean)
          .map((p, i) => (
            <span key={i}>{prettyFolder(String(p))}</span>
          ))}
      </div>

      <StarEditor clip={live} history={detail?.edit_history} busy={busy} onRate={(n) => onRate(live, n)} onRevert={() => onRevert(live)} />

      {live.quality_reasons ? <p className="detail__reason">{live.quality_reasons}</p> : null}

      <dl className="detail__facts">
        <dt>Length</dt>
        <dd className="dt">{fmtDuration(live.duration_seconds)}</dd>
        <dt>Frame</dt>
        <dd className="dt">{fmtRes(live.width, live.height)}</dd>
        <dt>Rate</dt>
        <dd className="dt">{fmtFps(live.fps)} fps</dd>
        <dt>Codec</dt>
        <dd className="dt">{[live.video_codec, (live.extension ?? '').replace('.', '').toUpperCase()].filter(Boolean).join(' · ') || '–'}</dd>
        <dt>Size</dt>
        <dd className="dt">{fmtBytes(live.size_bytes)}</dd>
        <dt>Recorded</dt>
        <dd className="dt">{fmtDate(live.inferred_recorded_date)}</dd>
        <dt>Audio</dt>
        <dd className="dt">{truthy(live.has_audio) ? 'Yes' : 'None'}</dd>
        <dt>Status</dt>
        <dd className="dt">{live.review_status ?? '–'}{truthy(live.is_proxy) ? ' · proxy' : ''}</dd>
      </dl>

      <div className="detail__path">
        <span className="dt" title={path}>
          {path}
        </span>
        <button type="button" className="btn btn--icon" title="Copy path" onClick={() => void copy(path, 'Path')}>
          <IconCopy size={14} />
        </button>
      </div>

      <div className="detail__actions">
        <div className="detail__binrow">
          <IconBin size={14} />
          <select value={binPick} onChange={(e) => setBinPick(e.target.value)} aria-label="Choose bin">
            <option value="">Add to bin…</option>
            <option value="new">New bin</option>
            {bins.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.count})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--warm btn--sm"
            disabled={!binPick}
            onClick={() => {
              onAddToBin(binPick as string | 'new', live)
              setBinPick('')
            }}
          >
            <IconPlus size={13} /> Add
          </button>
        </div>
      </div>
    </aside>
  )
}
