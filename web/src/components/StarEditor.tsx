import type { Clip, EditRecord } from '../api/types'
import { truthy } from '../lib/format'
import { IconStar, IconUndo } from './Icons'

/* ---------------------------------------------------------------------------
   Five 34px buttons. Writes optimistically; the caller reconciles. The
   scorer's original reading stays visible beneath, with a revert.
   --------------------------------------------------------------------------- */

type Props = {
  clip: Clip
  history?: EditRecord[]
  busy?: boolean
  onRate: (stars: number) => void
  onRevert: () => void
  compact?: boolean
}

export function scorerOriginal(clip: Clip, history?: EditRecord[]): number | null | undefined {
  if (!truthy(clip.has_user_edits)) return undefined
  const first = [...(history ?? [])].filter((h) => h.field_name === 'quality_stars').sort((a, b) => a.id - b.id)[0]
  if (!first) return undefined
  if (first.old_value === null || first.old_value === 'None' || first.old_value === '') return null
  const n = Number(first.old_value)
  return Number.isFinite(n) ? n : undefined
}

export function StarEditor({ clip, history, busy, onRate, onRevert, compact }: Props) {
  const mine = truthy(clip.has_user_edits)
  const stars = clip.quality_stars ?? 0
  const original = scorerOriginal(clip, history)
  return (
    <div className={`stars${mine ? ' is-mine' : ''}${compact ? ' stars--compact' : ''}`}>
      <div className="stars__row" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            className={`stars__btn${n <= stars ? ' is-on' : ''}`}
            disabled={busy}
            onClick={() => onRate(n)}
            title={`${n} star${n === 1 ? '' : 's'} (press ${n})`}
          >
            <IconStar size={compact ? 16 : 18} filled={n <= stars} />
          </button>
        ))}
        {!compact ? (
          <span className={`stars__num dt${mine ? ' is-warm' : ''}`}>{clip.quality_stars ?? '–'}</span>
        ) : null}
      </div>
      {!compact ? (
        <div className="stars__meta">
          {mine ? (
            <>
              <span className="pill pill--warm">Yours</span>
              <span className="stars__orig">
                Scorer said {original === undefined ? '…' : original === null ? 'unscored' : `${original}★`}
                {typeof clip.quality_confidence === 'number' ? ` · ${Math.round(clip.quality_confidence * 100)}% sure` : ''}
              </span>
              <button type="button" className="btn btn--link" onClick={onRevert} disabled={busy}>
                <IconUndo size={13} /> Revert
              </button>
            </>
          ) : clip.quality_stars === null || clip.quality_stars === undefined ? (
            <span className="stars__orig is-warm">Not scored yet — your rating becomes the score.</span>
          ) : (
            <span className="stars__orig">
              Scorer reading{typeof clip.quality_confidence === 'number' ? ` · ${Math.round(clip.quality_confidence * 100)}% sure` : ''}
              {typeof clip.quality_score_raw === 'number' ? ` · raw ${clip.quality_score_raw.toFixed(1)}` : ''}
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}
