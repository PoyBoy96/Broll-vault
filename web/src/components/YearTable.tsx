import { useMemo, useState } from 'react'
import type { YearRow } from '../api/types'
import { fmtHours, fmtInt, fmtPct } from '../lib/format'
import { IconChevron } from './Icons'

/* ---------------------------------------------------------------------------
   Year overview: a sortable table with bars drawn inside the cells. Not stat
   cards, not a chart row. Newest year on top by default — the archive is read
   from now backwards.

   Bars: teal fill on an ember-dim track, so the unfilled part is literally
   "what's missing" and you read the gap rather than the achievement.
   --------------------------------------------------------------------------- */

type Col = 'year' | 'total_clips' | 'hours' | 'rated' | 'strong' | 'review' | 'thumbs'

type Props = {
  years: YearRow[]
  selected: number[]
  onPick: (year: number, additive: boolean) => void
}

function Bar({ pct, tone = 'cool' }: { pct: number; tone?: 'cool' | 'warm' }) {
  return (
    <span className={`ybar ybar--${tone}`} aria-hidden="true">
      <span className="ybar__fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  )
}

export function YearTable({ years, selected, onPick }: Props) {
  const [sort, setSort] = useState<{ col: Col; dir: 'asc' | 'desc' }>({ col: 'year', dir: 'desc' })
  const [collapsed, setCollapsed] = useState(true)

  const rows = useMemo(() => {
    const val = (y: YearRow): number => {
      switch (sort.col) {
        case 'year':
          return y.year
        case 'total_clips':
          return y.total_clips
        case 'hours':
          return y.total_seconds ?? 0
        case 'rated':
          return y.coverage.rated_pct
        case 'strong':
          return y.strong_clips
        case 'review':
          return y.weak_clips
        case 'thumbs':
          return y.coverage.missing_thumb_pct
      }
    }
    const s = [...years].sort((a, b) => (val(a) - val(b)) * (sort.dir === 'asc' ? 1 : -1) || b.year - a.year)
    return s
  }, [years, sort])

  const totals = useMemo(
    () =>
      years.reduce(
        (acc, y) => ({
          clips: acc.clips + y.total_clips,
          seconds: acc.seconds + (y.total_seconds ?? 0),
          rated: acc.rated + (y.total_clips - y.unrated_clips),
          strong: acc.strong + y.strong_clips,
          weak: acc.weak + y.weak_clips,
          missing: acc.missing + y.missing_thumbnails,
        }),
        { clips: 0, seconds: 0, rated: 0, strong: 0, weak: 0, missing: 0 },
      ),
    [years],
  )

  const head = (col: Col, label: string, num = true) => {
    const on = sort.col === col
    return (
      <th className={`${num ? 'is-num' : ''}${on ? ' is-sorted' : ''}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          className="ytable__sort lbl"
          onClick={() => setSort({ col, dir: on ? (sort.dir === 'asc' ? 'desc' : 'asc') : col === 'year' ? 'desc' : 'desc' })}
        >
          {label}
          {on ? <IconChevron size={12} className={`ytable__arrow${sort.dir === 'asc' ? ' is-up' : ''}`} /> : null}
        </button>
      </th>
    )
  }

  return (
    <section className={`ytable card${collapsed ? ' is-collapsed' : ''}`} aria-label="Coverage by year">
      <header className="ytable__head">
        <button type="button" className="ytable__toggle" onClick={() => setCollapsed((v) => !v)} aria-expanded={!collapsed}>
          <IconChevron size={14} className={`ytable__chev${collapsed ? ' is-closed' : ''}`} />
          <span className="title">Coverage</span>
        </button>
        <span className="ytable__sum dt">
          {fmtInt(totals.clips)} clips · {fmtHours(totals.seconds)} · {fmtPct(totals.clips ? (totals.rated / totals.clips) * 100 : 0)} scored · {fmtInt(totals.missing)} without a frame
        </span>
      </header>
      {!collapsed ? (
        <div className="ytable__scroll">
          <table>
            <thead>
              <tr>
                {head('year', 'Year', false)}
                {head('total_clips', 'Clips')}
                {head('hours', 'Hours')}
                {head('rated', 'Scored')}
                {head('strong', '4★+')}
                {head('review', 'Review')}
                {head('thumbs', 'No thumb')}
              </tr>
            </thead>
            <tbody>
              {rows.map((y) => {
                const on = selected.includes(y.year)
                return (
                  <tr
                    key={y.year}
                    className={on ? 'is-on' : ''}
                    tabIndex={0}
                    onClick={(e) => onPick(y.year, e.shiftKey || e.metaKey || e.ctrlKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onPick(y.year, e.shiftKey)
                      }
                    }}
                    title={`Show ${y.year} in the ledger`}
                  >
                    <td className="ytable__year dt">{y.year}</td>
                    <td className="is-num dt">{fmtInt(y.total_clips)}</td>
                    <td className="is-num dt">{fmtHours(y.total_seconds)}</td>
                    <td className="is-num">
                      <span className="ytable__cell">
                        <Bar pct={y.coverage.rated_pct} />
                        <span className="dt">{fmtPct(y.coverage.rated_pct)}</span>
                      </span>
                    </td>
                    <td className="is-num dt">{fmtInt(y.strong_clips)}</td>
                    <td className={`is-num dt${y.weak_clips ? ' is-warm' : ''}`}>{y.weak_clips ? fmtInt(y.weak_clips) : '–'}</td>
                    <td className="is-num">
                      <span className="ytable__cell">
                        <Bar pct={100 - y.coverage.missing_thumb_pct} />
                        <span className="dt">{fmtInt(y.missing_thumbnails)}</span>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
