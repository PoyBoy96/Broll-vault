import type { Clip } from '../api/types'
import { truthy } from '../lib/format'

/* ---------------------------------------------------------------------------
   Quality meter: five rounded segments plus the numeral.

   Teal   = the scorer rated it.
   Slate  = the scorer rated it but wasn't sure (confidence < 0.5).
   Ember  = a human overrode it — yours.
   Hollow = unrated. Shows "–", never 0.
   --------------------------------------------------------------------------- */

export type MeterTone = 'machine' | 'unsure' | 'mine' | 'unrated'

export function meterTone(clip: Clip): MeterTone {
  if (clip.quality_stars === null || clip.quality_stars === undefined) return 'unrated'
  if (truthy(clip.has_user_edits)) return 'mine'
  const c = clip.quality_confidence
  if (typeof c === 'number' && c < 0.5) return 'unsure'
  return 'machine'
}

export function Meter({ clip, size = 'row' }: { clip: Clip; size?: 'row' | 'large' }) {
  const tone = meterTone(clip)
  const stars = clip.quality_stars ?? 0
  const label =
    tone === 'unrated'
      ? 'Not scored yet'
      : `${stars} of 5${tone === 'mine' ? ', your rating' : tone === 'unsure' ? ', low scorer confidence' : ''}`
  return (
    <div className={`meter meter--${tone} meter--${size}`} title={label} aria-label={label} role="img">
      <div className="meter__segs">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`meter__seg${i <= stars ? ' is-on' : ''}`} />
        ))}
      </div>
      <span className="meter__num dt">{tone === 'unrated' ? '–' : stars}</span>
    </div>
  )
}
