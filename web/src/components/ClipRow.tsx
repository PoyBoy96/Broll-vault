import { memo, type MouseEvent } from 'react'
import type { Clip } from '../api/types'
import { usePreview } from '../hooks/usePreview'
import { fmtBytes, fmtDate, fmtDuration, fmtFps, fmtResShort, prettyFolder, truthy } from '../lib/format'
import { Meter } from './Meter'
import { Thumb } from './Thumb'
import { IconCheck, IconStar } from './Icons'

/* ---------------------------------------------------------------------------
   Ledger row. Grid: check · frame · meter · name over path · scorer notes ·
   length · format. Rounded band, no rules, no card. Seven states: default,
   hover, focus, selected (checked), focused (keyboard cursor), yours, offline.
   --------------------------------------------------------------------------- */

type Props = {
  clip: Clip
  checked: boolean
  focused: boolean
  inBin: boolean
  onFocus: (clip: Clip) => void
  onToggle: (clip: Clip, shift: boolean) => void
  onOpen: (clip: Clip) => void
}

function pathLine(clip: Clip): string {
  const parts = [clip.campus, clip.year_bucket ?? (clip.year_int ? String(clip.year_int) : null), clip.ministry, clip.shoot]
    .filter(Boolean)
    .map((p) => prettyFolder(String(p)))
  return parts.join(' › ')
}

export const ClipRow = memo(function ClipRow({ clip, checked, focused, inBin, onFocus, onToggle, onOpen }: Props) {
  const preview = usePreview(clip.clip_id)
  const mine = truthy(clip.has_user_edits)
  const offline = clip.is_present !== null && clip.is_present !== undefined && !truthy(clip.is_present)
  const status = clip.review_status ?? ''
  const broken = offline || status === 'error'
  const name = clip.filename ?? clip.relative_path ?? `clip ${clip.clip_id}`
  const notes = clip.quality_reasons ?? (status === 'pending' ? 'Not analyzed yet' : '')

  const handleClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.row__check')) return
    onFocus(clip)
  }

  return (
    <div
      className={`row${checked ? ' is-checked' : ''}${focused ? ' is-focused' : ''}${mine ? ' is-mine' : ''}${broken ? ' is-broken' : ''}`}
      onClick={handleClick}
      onDoubleClick={() => onOpen(clip)}
      onPointerEnter={preview.arm}
      onPointerLeave={preview.disarm}
      data-clip-id={clip.clip_id}
      aria-selected={focused}
      role="option"
    >
      <button
        type="button"
        className={`row__check${checked ? ' is-on' : ''}`}
        aria-label={checked ? 'Remove from selection' : 'Add to selection'}
        aria-pressed={checked}
        onClick={(e) => onToggle(clip, e.shiftKey)}
      >
        {checked ? <IconCheck size={12} /> : null}
      </button>

      <Thumb clip={clip} previewSrc={preview.src} previewWaiting={preview.state === 'waiting'} />

      <Meter clip={clip} />

      <div className="row__name">
        <div className="row__title" title={name}>
          <span>{name}</span>
          {mine ? <span className="pill pill--warm">Yours</span> : null}
          {truthy(clip.is_highlight) ? (
            <span className="row__flag" title="Highlight">
              <IconStar size={12} filled />
            </span>
          ) : null}
          {inBin ? <span className="pill pill--cool">In bin</span> : null}
        </div>
        <div className="row__path dt" title={clip.relative_path ?? ''}>
          {pathLine(clip)}
        </div>
      </div>

      <div className="row__notes" title={notes}>
        {notes}
      </div>

      <div className="row__date dt">{fmtDate(clip.inferred_recorded_date ?? clip.modified_at_utc)}</div>
      <div className="row__len dt">{fmtDuration(clip.duration_seconds)}</div>
      <div className="row__res dt">{fmtResShort(clip.width, clip.height)}</div>
      <div className="row__fps dt">{fmtFps(clip.fps)}</div>
      <div className="row__codec dt">
        {broken ? <span className="pill pill--broken">{offline ? 'Offline' : 'Error'}</span> : [clip.video_codec, (clip.extension ?? '').replace('.', '').toLowerCase()].filter(Boolean).join(' · ') || '–'}
      </div>
      <div className="row__size dt">{fmtBytes(clip.size_bytes)}</div>
    </div>
  )
})
