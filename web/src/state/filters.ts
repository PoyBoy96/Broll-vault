import { DEFAULT_FILTERS } from '../api/types'
import type { Filters, SortDir, SortKey, StarMode } from '../api/types'

/* ---------------------------------------------------------------------------
   Filters <-> URL. The address bar is the app's memory: reload, share, or
   bookmark a search and it comes back exactly. Only non-default values are
   written so a clean search has a clean URL.
   --------------------------------------------------------------------------- */

const STAR_MODES: StarMode[] = ['usable', '3plus', '4plus', '5', 'unrated', 'rated', 'review', 'all']
const SORT_KEYS: SortKey[] = ['stars', 'date', 'length', 'name', 'path', 'res', 'fps', 'codec', 'size']
const SORT_DIRECTIONS: SortDir[] = ['asc', 'desc']
const NEEDS: Filters['needsYou'] = ['unrated', 'needs_thumbnail', 'mine', 'highlight', 'offline']

function list(sp: URLSearchParams, key: string): string[] {
  const v = sp.get(key)
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []
}

export function filtersFromUrl(search = window.location.search): Filters {
  const sp = new URLSearchParams(search)
  const stars = sp.get('stars') as StarMode | null
  const sortKey = (sp.get('sort_key') as SortKey | null) ?? (sp.get('sort') as SortKey | null)
  const sortDir = sp.get('sort_dir') as SortDir | null
  return {
    q: sp.get('q') ?? '',
    years: list(sp, 'years').map(Number).filter((n) => Number.isFinite(n)),
    campus: list(sp, 'campus'),
    campusNot: list(sp, 'campus_not'),
    ministry: list(sp, 'ministry'),
    ministryNot: list(sp, 'ministry_not'),
    format: list(sp, 'format'),
    formatNot: list(sp, 'format_not'),
    stars: stars && STAR_MODES.includes(stars) ? stars : DEFAULT_FILTERS.stars,
    sortKey: SORT_KEYS.includes(sortKey ?? 'stars') ? sortKey ?? 'stars' : DEFAULT_FILTERS.sortKey,
    sortDir: sortDir && SORT_DIRECTIONS.includes(sortDir) ? sortDir : DEFAULT_FILTERS.sortDir,
    needsYou: list(sp, 'needs').filter((n): n is Filters['needsYou'][number] => (NEEDS as string[]).includes(n)),
    bin: sp.get('bin'),
  }
}

export function filtersToUrl(f: Filters): string {
  const sp = new URLSearchParams()
  if (f.q.trim()) sp.set('q', f.q.trim())
  if (f.years.length) sp.set('years', f.years.join(','))
  if (f.campus.length) sp.set('campus', f.campus.join(','))
  if (f.campusNot.length) sp.set('campus_not', f.campusNot.join(','))
  if (f.ministry.length) sp.set('ministry', f.ministry.join(','))
  if (f.ministryNot.length) sp.set('ministry_not', f.ministryNot.join(','))
  if (f.format.length) sp.set('format', f.format.join(','))
  if (f.formatNot.length) sp.set('format_not', f.formatNot.join(','))
  if (f.stars !== DEFAULT_FILTERS.stars) sp.set('stars', f.stars)
  if (f.sortKey !== DEFAULT_FILTERS.sortKey) sp.set('sort_key', f.sortKey)
  if (f.sortDir !== DEFAULT_FILTERS.sortDir) sp.set('sort_dir', f.sortDir)
  if (f.needsYou.length) sp.set('needs', f.needsYou.join(','))
  if (f.bin) sp.set('bin', f.bin)
  const s = sp.toString()
  return s ? `?${s}` : window.location.pathname
}

export function filtersEqual(a: Filters, b: Filters): boolean {
  return filtersToUrl(a) === filtersToUrl(b)
}

/** Count of user-applied narrowing, for the "clear" affordance. */
export function activeFilterCount(f: Filters): number {
  return (
    (f.q.trim() ? 1 : 0) +
    f.years.length +
    f.campus.length +
    f.campusNot.length +
    f.ministry.length +
    f.ministryNot.length +
    f.format.length +
    f.formatNot.length +
    (f.stars !== DEFAULT_FILTERS.stars ? 1 : 0) +
    f.needsYou.length +
    (f.bin ? 1 : 0)
  )
}

/** Toggle a value through include -> exclude -> off, Artlist-style. */
export function cycleTri(include: string[], exclude: string[], value: string, to?: 'include' | 'exclude' | 'off') {
  const inInc = include.includes(value)
  const inExc = exclude.includes(value)
  const next = to ?? (inInc ? 'exclude' : inExc ? 'off' : 'include')
  const inc = include.filter((v) => v !== value)
  const exc = exclude.filter((v) => v !== value)
  if (next === 'include') inc.push(value)
  if (next === 'exclude') exc.push(value)
  return { include: inc, exclude: exc }
}
