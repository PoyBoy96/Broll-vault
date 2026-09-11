import { useMemo, useState } from 'react'
import type { Facets, Filters, StarMode, FormatFacet } from '../api/types'
import { DEFAULT_FILTERS, STAR_MODE_LABEL } from '../api/types'
import { activeFilterCount, cycleTri } from '../state/filters'
import { fmtInt, prettyFolder } from '../lib/format'
import { IconCheck, IconChevron, IconClose, IconMinus, IconPlus } from './Icons'

/* ---------------------------------------------------------------------------
   Filter bar. Category tabs across the top; the open category unrolls a row of
   pill chips beneath. Campus and Ministry chips are tri-state: click to
   include, click the "−" to exclude, click again to clear. Stars is a single
   pick. Years and "Needs you" are multi-pick.
   --------------------------------------------------------------------------- */

type Category = 'campus' | 'ministry' | 'stars' | 'year' | 'format' | 'needs'
type Needs = Filters['needsYou'][number]

const NEEDS_LABEL: Record<Needs, string> = {
  unrated: 'Unscored',
  needs_thumbnail: 'No thumbnail',
  mine: 'Rated by me',
  highlight: 'Highlights',
  offline: 'Offline',
}

type Props = {
  filters: Filters
  facets: Facets | null
  currentYear: number
  onChange: (next: Filters) => void
}

export function FilterBar({ filters, facets, currentYear, onChange }: Props) {
  const [open, setOpen] = useState<Category | null>(null)
  const [allMinistries, setAllMinistries] = useState(false)

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  const campusCounts = useMemo(() => new Map((facets?.campuses ?? []).map((c) => [c.value, c.count])), [facets])

  // Ministry chips: sum counts across campuses. When campuses are included the
  // backend already scoped the facet to them.
  const ministries = useMemo(() => {
    const m = new Map<string, number>()
    for (const row of facets?.ministries ?? []) m.set(row.value, (m.get(row.value) ?? 0) + row.count)
    // Keep anything currently selected visible even if its count is 0 now.
    for (const v of [...filters.ministry, ...filters.ministryNot]) if (!m.has(v)) m.set(v, 0)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [facets, filters.ministry, filters.ministryNot])

  const campuses = useMemo(() => {
    const m = new Map<string, number>(campusCounts)
    for (const v of [...filters.campus, ...filters.campusNot]) if (!m.has(v)) m.set(v, 0)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [campusCounts, filters.campus, filters.campusNot])

  const years = useMemo(
    () =>
      (facets?.years ?? [])
        .filter((y) => y.year <= currentYear && y.year >= 1990)
        .sort((a, b) => b.year - a.year),
    [facets, currentYear],
  )

  const formats = useMemo(() => {
    const f = [...(facets?.formats ?? [])]
    for (const v of [...filters.format, ...filters.formatNot]) {
      if (!f.some((x) => `${x.kind}:${x.value}` === v)) {
        const [kind, value] = v.split(':', 2)
        if (value !== undefined && (kind === 'res' || kind === 'codec' || kind === 'ext')) {
          f.push({ kind: kind as FormatFacet['kind'], value, count: 0 })
        }
      }
    }
    const order: Record<FormatFacet['kind'], number> = { res: 0, codec: 1, ext: 2 }
    return [...f].sort((a, b) => order[a.kind] - order[b.kind] || a.value.localeCompare(b.value))
  }, [facets, filters.format, filters.formatNot])

  const counts: Record<Category, number> = {
    campus: filters.campus.length + filters.campusNot.length,
    ministry: filters.ministry.length + filters.ministryNot.length,
    stars: filters.stars === DEFAULT_FILTERS.stars ? 0 : 1,
    year: filters.years.length,
    format: filters.format.length + filters.formatNot.length,
    needs: filters.needsYou.length,
  }

  const tab = (id: Category, label: string, warm = false) => (
    <button
      type="button"
      className={`ftab${open === id ? ' is-open' : ''}${counts[id] ? ' has-count' : ''}${warm ? ' ftab--warm' : ''}`}
      onClick={() => setOpen(open === id ? null : id)}
      aria-expanded={open === id}
    >
      <span>{label}</span>
      {counts[id] ? <span className="ftab__count dt">{counts[id]}</span> : null}
      <IconChevron size={14} className="ftab__chev" />
    </button>
  )

  const triChip = (
    value: string,
    count: number,
    include: string[],
    exclude: string[],
    apply: (r: { include: string[]; exclude: string[] }) => void,
  ) => {
    const state = include.includes(value) ? 'in' : exclude.includes(value) ? 'out' : 'off'
    return (
      <span key={value} className={`chip chip--tri is-${state}`}>
        <button
          type="button"
          className="chip__main"
          onClick={() => apply(cycleTri(include, exclude, value, state === 'in' ? 'off' : 'include'))}
          title={state === 'in' ? 'Click to clear' : 'Include'}
        >
          {state === 'in' ? <IconCheck size={13} /> : state === 'out' ? <IconMinus size={13} /> : null}
          <span className="chip__label">{prettyFolder(value)}</span>
          <span className="chip__count dt">{fmtInt(count)}</span>
        </button>
        <span className="chip__ops">
          <button
            type="button"
            className="chip__op"
            title="Include"
            aria-label={`Include ${prettyFolder(value)}`}
            onClick={() => apply(cycleTri(include, exclude, value, state === 'in' ? 'off' : 'include'))}
          >
            <IconPlus size={12} />
          </button>
          <button
            type="button"
            className="chip__op chip__op--minus"
            title="Exclude"
            aria-label={`Exclude ${prettyFolder(value)}`}
            onClick={() => apply(cycleTri(include, exclude, value, state === 'out' ? 'off' : 'exclude'))}
          >
            <IconMinus size={12} />
          </button>
        </span>
      </span>
    )
  }

  const active = activeFilterCount(filters)
  const activeSummary = [
    ...filters.campus.map(prettyFolder),
    ...filters.campusNot.map((v) => `Not ${prettyFolder(v)}`),
    ...filters.ministry.map(prettyFolder),
    ...filters.years.map(String),
  ].slice(0, 4).join(' · ')

  return (
    <div className="fbar card">
      <div className="fbar__tabs">
        {tab('campus', 'Campus')}
        {tab('ministry', 'Ministry')}
        {tab('stars', 'Stars')}
        {tab('year', 'Year')}
        {tab('format', 'Format')}
        {tab('needs', 'Needs you', true)}
        <span className="fbar__spacer" />
        {activeSummary ? <span className="fbar__summary">{activeSummary}</span> : null}
        {active > 0 ? (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange({ ...DEFAULT_FILTERS, sortKey: filters.sortKey, sortDir: filters.sortDir })}>
            <IconClose size={13} /> Clear {active}
          </button>
        ) : null}
      </div>

      {open === 'campus' ? (
        <div className="fbar__chips" role="group" aria-label="Campus">
          {campuses.length === 0 ? <span className="fbar__empty">Loading campuses…</span> : null}
          {campuses.map(([value, count]) =>
            triChip(value, count, filters.campus, filters.campusNot, (r) => set({ campus: r.include, campusNot: r.exclude })),
          )}
        </div>
      ) : null}

      {open === 'ministry' ? (
        <div className="fbar__chips" role="group" aria-label="Ministry">
          {ministries.length === 0 ? <span className="fbar__empty">No ministry folders match.</span> : null}
          {(allMinistries ? ministries : ministries.slice(0, 28)).map(([value, count]) =>
            triChip(value, count, filters.ministry, filters.ministryNot, (r) => set({ ministry: r.include, ministryNot: r.exclude })),
          )}
          {ministries.length > 28 ? (
            <button type="button" className="chip chip--more" onClick={() => setAllMinistries((v) => !v)}>
              {allMinistries ? 'Fewer' : `All ${ministries.length}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {open === 'stars' ? (
        <div className="fbar__chips" role="radiogroup" aria-label="Stars">
          {(['usable', '4plus', '5', '3plus', 'rated', 'unrated', 'all', 'review'] as StarMode[]).map((mode) => {
            const on = filters.stars === mode
            const n = facets?.stars?.[mode]
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={on}
                className={`chip chip--pick${on ? ' is-in' : ''}${mode === 'review' ? ' chip--review' : ''}${mode === 'unrated' ? ' chip--warm' : ''}`}
                onClick={() => set({ stars: mode })}
              >
                {on ? <IconCheck size={13} /> : null}
                <span className="chip__label">{STAR_MODE_LABEL[mode]}</span>
                {typeof n === 'number' ? <span className="chip__count dt">{fmtInt(n)}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {open === 'year' ? (
        <div className="fbar__chips" role="group" aria-label="Year">
          {years.length === 0 ? <span className="fbar__empty">Loading years…</span> : null}
          {years.map(({ year, count }) => {
            const on = filters.years.includes(year)
            return (
              <button
                key={year}
                type="button"
                aria-pressed={on}
                className={`chip chip--pick${on ? ' is-in' : ''}`}
                onClick={() => set({ years: on ? filters.years.filter((y) => y !== year) : [...filters.years, year].sort((a, b) => b - a) })}
              >
                {on ? <IconCheck size={13} /> : null}
                <span className="chip__label dt">{year}</span>
                <span className="chip__count dt">{fmtInt(count)}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {open === 'needs' ? (
        <div className="fbar__chips" role="group" aria-label="Needs you">
          {(Object.keys(NEEDS_LABEL) as Needs[]).map((key) => {
            const on = filters.needsYou.includes(key)
            const n = key === 'unrated' ? facets?.stars?.unrated : undefined
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                className={`chip chip--pick chip--warm${on ? ' is-in' : ''}`}
                onClick={() => set({ needsYou: on ? filters.needsYou.filter((k) => k !== key) : [...filters.needsYou, key] })}
              >
                {on ? <IconCheck size={13} /> : null}
                <span className="chip__label">{NEEDS_LABEL[key]}</span>
                {typeof n === 'number' ? <span className="chip__count dt">{fmtInt(n)}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {open === 'format' ? (
        <div className="fbar__chips" role="group" aria-label="Format">
          {formats.length === 0 ? <span className="fbar__empty">No format metadata.</span> : null}
          {formats.map((fmt) => {
            const token = `${fmt.kind}:${fmt.value}`
            const on = filters.format.includes(token)
            const off = filters.formatNot.includes(token)
            const state = on ? 'in' : off ? 'out' : 'off'
            return (
              <span
                key={token}
                role="button"
                tabIndex={0}
                aria-pressed={state === 'in'}
                className={`chip chip--tri chip--pick${state === 'in' ? ' is-in' : ''}`}
                onClick={() => {
                  const next = cycleTri(filters.format, filters.formatNot, token, state === 'in' ? 'off' : 'include')
                  set({ format: next.include, formatNot: next.exclude })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    const next = cycleTri(filters.format, filters.formatNot, token, state === 'in' ? 'off' : 'include')
                    set({ format: next.include, formatNot: next.exclude })
                  }
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <span className="chip__main">
                  <span className="chip__label">
                    {fmt.kind === 'res' ? `${fmt.value.toUpperCase()}`
                      : fmt.kind === 'codec' ? fmt.value.toUpperCase()
                      : `.${fmt.value.toLowerCase()}`}
                  </span>
                  <span className="chip__count dt">{fmtInt(fmt.count)}</span>
                </span>
                <span className="chip__ops">
                  <button
                    type="button"
                    className="chip__op"
                    title="Include"
                    onClick={(e) => {
                      e.stopPropagation()
                      const next = cycleTri(filters.format, filters.formatNot, token, state === 'in' ? 'off' : 'include')
                      set({ format: next.include, formatNot: next.exclude })
                    }}
                  >
                    <IconPlus size={12} />
                  </button>
                  <button
                    type="button"
                    className="chip__op chip__op--minus"
                    title="Exclude"
                    onClick={(e) => {
                      e.stopPropagation()
                      const next = cycleTri(filters.format, filters.formatNot, token, state === 'out' ? 'off' : 'exclude')
                      set({ format: next.include, formatNot: next.exclude })
                    }}
                  >
                    <IconMinus size={12} />
                  </button>
                </span>
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
