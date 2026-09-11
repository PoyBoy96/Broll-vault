import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiFailure } from './api/client'
import { COLUMN_LABEL, DEFAULT_FILTERS } from './api/types'
import type { Bin, Clip, Facets, Filters, Health, SortKey, ThumbSize, ViewMode, YearRow } from './api/types'
import { activeFilterCount, filtersFromUrl, filtersToUrl } from './state/filters'
import { useDebounced } from './hooks/useDebounced'
import { fmtInt } from './lib/format'
import { FilterBar } from './components/FilterBar'
import { YearTable } from './components/YearTable'
import { CatalogView } from './components/CatalogView'
import { Detail } from './components/Detail'
import { Peek } from './components/Peek'
import { BinsPanel } from './components/BinsPanel'
import { UpdateBell } from './components/UpdateBell'
import { IconBin, IconChevron, IconClose, IconFilmstrip, IconGrid, IconPlus, IconPremiere, IconRows, IconSearch, IconWarn } from './components/Icons'

const PAGE_SIZE = 80
type Toast = { id: number; message: string; kind: 'ok' | 'warn' | 'err' }
const SORT_KEYS: SortKey[] = ['stars', 'date', 'length', 'name', 'path', 'res', 'fps', 'codec', 'size']

function readViewMode(): ViewMode {
  try {
    const value = localStorage.getItem('vault.view')
    if (value === 'list' || value === 'grid' || value === 'film') return value
  } catch {
    /* ignore */
  }
  return 'list'
}

function readThumbSize(): ThumbSize {
  try {
    const value = localStorage.getItem('vault.thumbSize')
    if (value === 's' || value === 'm' || value === 'l') return value
  } catch {
    /* ignore */
  }
  return 'l'
}

export function App({ onSetup }: { onSetup: () => void }) {
  // ---- filters (URL is the source of truth) --------------------------------
  const [filters, setFiltersState] = useState<Filters>(() => filtersFromUrl())
  const [query, setQuery] = useState(filters.q)
  const debouncedQuery = useDebounced(query, 220)
  const setFilters = useCallback((next: Filters) => {
    setFiltersState(next)
    window.history.replaceState(null, '', filtersToUrl(next))
  }, [])
  useEffect(() => {
    if (debouncedQuery !== filters.q) setFilters({ ...filters, q: debouncedQuery })
  }, [debouncedQuery]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onPop = () => {
      const f = filtersFromUrl()
      setFiltersState(f)
      setQuery(f.q)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // ---- view -----------------------------------------------------------------
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode)
  const [thumbSize, setThumbSize] = useState<ThumbSize>(readThumbSize)
  useEffect(() => {
    document.documentElement.dataset.view = viewMode
    document.documentElement.dataset.thumbSize = thumbSize
    try {
      localStorage.setItem('vault.view', viewMode)
      localStorage.setItem('vault.thumbSize', thumbSize)
    } catch {
      /* ignore */
    }
  }, [viewMode, thumbSize])

  // ---- toasts ---------------------------------------------------------------
  const [toasts, setToasts] = useState<Toast[]>([])
  const toast = useCallback((message: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, message, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 2600)
  }, [])

  // ---- health / years / bins -------------------------------------------------
  const [health, setHealth] = useState<Health | null>(null)
  const [offline, setOffline] = useState(false)
  const [years, setYears] = useState<YearRow[]>([])
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear())
  const [bins, setBins] = useState<Bin[]>([])
  const [catalogVersion, setCatalogVersion] = useState(0)

  const loadYears = useCallback(async () => {
    try {
      const r = await api.years()
      setYears(r.years.filter((year) => year.year <= r.current_year))
      setCurrentYear(r.current_year)
    } catch {
      /* surfaced through health */
    }
  }, [])
  const loadBins = useCallback(async () => {
    try {
      setBins(await api.bins())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    let timer: number | null = null
    let alive = true
    const poll = async () => {
      try {
        const h = await api.health()
        if (!alive) return
        setHealth(h)
        setOffline(false)
        const v = h.mirror.ready ? Math.max(1, h.mirror.version) : 0
        if (v !== catalogVersion) setCatalogVersion(v)
        if (!h.mirror.ready) timer = window.setTimeout(poll, 1500)
        else timer = window.setTimeout(poll, 30000)
      } catch {
        if (!alive) return
        setOffline(true)
        timer = window.setTimeout(poll, 3000)
      }
    }
    void poll()
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
  }, [catalogVersion])

  useEffect(() => {
    if (!catalogVersion) return
    void loadYears()
    void loadBins()
  }, [catalogVersion, loadYears, loadBins])

  // ---- facets ---------------------------------------------------------------
  const [facets, setFacets] = useState<Facets | null>(null)
  useEffect(() => {
    if (!catalogVersion) return
    let alive = true
    void api
      .facets(filters)
      .then((f) => alive && setFacets(f))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [filters, catalogVersion])

  // ---- clips ----------------------------------------------------------------
  const [clips, setClips] = useState<Clip[]>([])
  const [total, setTotal] = useState(0)
  const [queryMs, setQueryMs] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef(0)
  const reqRef = useRef(0)
  const seed = useMemo(() => 1, [])

  const fetchPage = useCallback(
    async (page: number, replace: boolean) => {
      const id = ++reqRef.current
      setLoading(true)
      setError(null)
      try {
        const r = await api.clips(filters, page, PAGE_SIZE, seed)
        if (id !== reqRef.current) return
        setClips((prev) => (replace ? r.items : [...prev, ...r.items]))
        setTotal(r.total)
        setQueryMs(r.query_ms ?? null)
        pageRef.current = r.page
        setHasMore(r.page < r.total_pages)
      } catch (err) {
        if (id !== reqRef.current) return
        const e = err as ApiFailure
        if (e.code === 'catalog_loading' || e.code === 'catalog_unavailable') {
          setError(null) // health banner covers it
        } else {
          setError(e.message)
        }
      } finally {
        if (id === reqRef.current) setLoading(false)
      }
    },
    [filters, seed],
  )

  useEffect(() => {
    if (!catalogVersion) return
    setClips([])
    setTotal(0)
    setHasMore(false)
    pageRef.current = 0
    void fetchPage(1, true)
  }, [fetchPage, catalogVersion])

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return
    void fetchPage(pageRef.current + 1, false)
  }, [loading, hasMore, fetchPage])

  // ---- selection / focus ----------------------------------------------------
  const [checked, setChecked] = useState<Set<number>>(() => new Set())
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const lastToggled = useRef<number | null>(null)
  const [peekOpen, setPeekOpen] = useState(false)
  const [binsOpen, setBinsOpen] = useState(false)
  const [newBinFor, setNewBinFor] = useState<number[] | null>(null)
  const [newBinName, setNewBinName] = useState('')
  const [premiereFor, setPremiereFor] = useState<number[] | null>(null)
  const [premiereMakeBin, setPremiereMakeBin] = useState(false)
  const [premiereBinName, setPremiereBinName] = useState('')
  const [premiereSending, setPremiereSending] = useState(false)
  const [saving, setSaving] = useState(false)

  const focused = useMemo(() => clips.find((c) => c.clip_id === focusedId) ?? null, [clips, focusedId])
  const focusedIndex = useMemo(() => clips.findIndex((c) => c.clip_id === focusedId), [clips, focusedId])
  const activeBin = useMemo(() => bins.find((b) => b.id === filters.bin) ?? null, [bins, filters.bin])
  const binIds = useMemo(() => new Set(bins.flatMap((b) => b.clip_ids)), [bins])

  useEffect(() => {
    // Drop selection that no longer exists in the list after a new search.
    setChecked((prev) => {
      if (prev.size === 0) return prev
      const ids = new Set(clips.map((c) => c.clip_id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
    if (focusedId !== null && !clips.some((c) => c.clip_id === focusedId)) setFocusedId(null)
  }, [clips, focusedId])

  const toggle = useCallback(
    (clip: Clip, shift: boolean) => {
      setChecked((prev) => {
        const next = new Set(prev)
        if (shift && lastToggled.current !== null) {
          const a = clips.findIndex((c) => c.clip_id === lastToggled.current)
          const b = clips.findIndex((c) => c.clip_id === clip.clip_id)
          if (a >= 0 && b >= 0) {
            const on = !prev.has(clip.clip_id)
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
              const id = clips[i]!.clip_id
              if (on) next.add(id)
              else next.delete(id)
            }
            lastToggled.current = clip.clip_id
            return next
          }
        }
        if (next.has(clip.clip_id)) next.delete(clip.clip_id)
        else next.add(clip.clip_id)
        lastToggled.current = clip.clip_id
        return next
      })
    },
    [clips],
  )

  const step = useCallback(
    (dir: 1 | -1) => {
      if (clips.length === 0) return
      const idx = focusedIndex < 0 ? (dir === 1 ? 0 : clips.length - 1) : Math.max(0, Math.min(clips.length - 1, focusedIndex + dir))
      setFocusedId(clips[idx]!.clip_id)
      if (idx >= clips.length - 10) loadMore()
    },
    [clips, focusedIndex, loadMore],
  )

  // ---- rating ---------------------------------------------------------------
  const applyClip = useCallback((updated: Clip) => {
    setClips((prev) => prev.map((c) => (c.clip_id === updated.clip_id ? { ...c, ...updated } : c)))
  }, [])

  const rate = useCallback(
    async (clip: Clip, stars: number) => {
      const before = { ...clip }
      applyClip({ ...clip, quality_stars: stars, has_user_edits: 1 })
      setSaving(true)
      try {
        const updated = await api.edit(clip.clip_id, { quality_stars: stars }, 'Rated in Vault')
        applyClip(updated)
        toast(`${clip.filename ?? 'Clip'} → ${stars}★`)
        void loadYears()
      } catch (err) {
        applyClip(before)
        toast(`Rating not saved: ${(err as Error).message}`, 'err')
      } finally {
        setSaving(false)
      }
    },
    [applyClip, toast, loadYears],
  )

  const revert = useCallback(
    async (clip: Clip) => {
      setSaving(true)
      try {
        const updated = await api.revert(clip.clip_id, 'quality_stars')
        applyClip(updated)
        toast('Back to the scorer’s reading')
        void loadYears()
      } catch (err) {
        toast(`Revert failed: ${(err as Error).message}`, 'err')
      } finally {
        setSaving(false)
      }
    },
    [applyClip, toast, loadYears],
  )

  // ---- bins -----------------------------------------------------------------
  const addToBin = useCallback(
    async (binId: string | 'new', ids: number[]) => {
      if (ids.length === 0) return
      if (binId === 'new') {
        setNewBinFor(ids)
        setNewBinName('')
        return
      }
      try {
        const b = await api.updateBin(binId, { add: ids })
        setBins((prev) => prev.map((x) => (x.id === b.id ? b : x)))
        toast(`Added ${ids.length} to “${b.name}”`)
      } catch (err) {
        toast(`Bin update failed: ${(err as Error).message}`, 'err')
      }
    },
    [toast],
  )

  const createBin = useCallback(async () => {
    if (!newBinFor) return
    const name = newBinName.trim() || `Bin ${new Date().toLocaleDateString()}`
    try {
      const b = await api.createBin(name, newBinFor)
      setBins((prev) => [b, ...prev])
      toast(`Bin “${b.name}” saved with ${b.count} clip${b.count === 1 ? '' : 's'}`)
      setNewBinFor(null)
    } catch (err) {
      toast(`Could not save bin: ${(err as Error).message}`, 'err')
    }
  }, [newBinFor, newBinName, toast])

  const renameBin = useCallback(
    async (id: string, name: string) => {
      try {
        const b = await api.updateBin(id, { name })
        setBins((prev) => prev.map((x) => (x.id === b.id ? b : x)))
      } catch (err) {
        toast(`Rename failed: ${(err as Error).message}`, 'err')
      }
    },
    [toast],
  )

  const deleteBin = useCallback(
    async (id: string) => {
      const b = bins.find((x) => x.id === id)
      if (!b) return
      if (!window.confirm(`Delete bin “${b.name}”? The clips themselves are untouched.`)) return
      try {
        await api.deleteBin(id)
        setBins((prev) => prev.filter((x) => x.id !== id))
        if (filters.bin === id) setFilters({ ...filters, bin: null })
      } catch (err) {
        toast(`Delete failed: ${(err as Error).message}`, 'err')
      }
    },
    [bins, filters, setFilters, toast],
  )

  const removeFromActiveBin = useCallback(
    async (ids: number[]) => {
      if (!activeBin || ids.length === 0) return
      try {
        const b = await api.updateBin(activeBin.id, { remove: ids })
        setBins((prev) => prev.map((x) => (x.id === b.id ? b : x)))
        setClips((prev) => prev.filter((c) => !ids.includes(c.clip_id)))
        setTotal((t) => Math.max(0, t - ids.length))
        setChecked(new Set())
        toast(`Removed ${ids.length} from “${b.name}”`)
      } catch (err) {
        toast(`Bin update failed: ${(err as Error).message}`, 'err')
      }
    },
    [activeBin, toast],
  )

  const requestPremiere = useCallback(
    (ids: number[]) => {
      setPremiereFor(ids)
      setPremiereMakeBin(!!activeBin)
      setPremiereBinName(activeBin?.name ?? '')
    },
    [activeBin],
  )

  const sendToPremiere = useCallback(
    async () => {
      if (!premiereFor?.length) return
      setPremiereSending(true)
      try {
        await api.premiereImport(premiereFor, premiereMakeBin ? { make_bin: true, bin_name: premiereBinName.trim() || 'B-roll Vault' } : undefined)
        toast(`Sent ${premiereFor.length} clip${premiereFor.length === 1 ? '' : 's'} to Premiere`)
        setPremiereFor(null)
        setChecked(new Set())
      } catch (err) {
        const e = err as ApiFailure
        toast(e.code === 'bridge_not_configured' ? 'No Premiere bridge configured — save a bin and use its XML export instead.' : `Premiere: ${e.message}`, 'err')
      } finally {
        setPremiereSending(false)
      }
    },
    [premiereFor, premiereMakeBin, premiereBinName, toast],
  )

  // ---- keyboard -------------------------------------------------------------
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (peekOpen) return
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (typing) {
        if (e.key === 'Escape') (t as HTMLInputElement).blur()
        if (t === searchRef.current && e.key === 'ArrowDown') {
          e.preventDefault()
          searchRef.current?.blur()
          step(1)
        }
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        step(1)
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        step(-1)
      } else if (e.key === ' ') {
        if (focused) {
          e.preventDefault()
          setPeekOpen(true)
        }
      } else if (e.key === 'Enter' && focused) {
        e.preventDefault()
        setPeekOpen(true)
      } else if (e.key === 'x' && focused) {
        e.preventDefault()
        toggle(focused, e.shiftKey)
      } else if (/^[1-5]$/.test(e.key) && focused) {
        e.preventDefault()
        void rate(focused, Number(e.key))
      } else if (e.key === 'b' || e.key === 'B') {
        const ids = checked.size ? [...checked] : focused ? [focused.clip_id] : []
        if (ids.length) {
          e.preventDefault()
          setNewBinFor(ids)
          setNewBinName('')
        }
      } else if (e.key === 'Escape') {
        if (checked.size) setChecked(new Set())
        else if (binsOpen) setBinsOpen(false)
        else setFocusedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [peekOpen, focused, step, toggle, rate, checked, binsOpen])

  // ---- derived UI -----------------------------------------------------------
  const mirror = health?.mirror
  const banner = offline
    ? { kind: 'err' as const, text: 'Catalog API is not running. Start start_broll_catalog_backend.bat.' }
    : mirror && !mirror.ready
      ? {
          kind: 'warn' as const,
          text: mirror.last_error
            ? `Catalog unavailable: ${mirror.last_error}`
            : 'Copying the catalog to a local mirror for fast search — first start takes a minute.',
        }
      : mirror && !mirror.source_reachable
        ? { kind: 'warn' as const, text: 'Storage share is unreachable — searching the last local copy. Ratings can’t be saved until it’s back.' }
        : null

  const activeCount = activeFilterCount(filters)
  const checkedIds = [...checked]

  const emptyState =
    activeBin && total === 0 ? (
      <>
        <p className="title">“{activeBin.name}” is empty.</p>
        <p>Check clips in the ledger and add them from the selection bar.</p>
      </>
    ) : activeCount > 0 ? (
      <>
        <p className="title">Nothing matches these filters.</p>
        <p>
          {filters.q ? `“${filters.q}” · ` : ''}
          {filters.stars !== DEFAULT_FILTERS.stars ? 'a star filter · ' : ''}
          {filters.campus.length + filters.campusNot.length + filters.ministry.length + filters.ministryNot.length > 0 ? 'campus / ministry · ' : ''}
          {filters.years.length ? `${filters.years.join(', ')} · ` : ''}
        </p>
        <button type="button" className="btn btn--warm" onClick={() => setFilters({ ...DEFAULT_FILTERS, sortKey: filters.sortKey, sortDir: filters.sortDir })}>
          Clear filters
        </button>
      </>
    ) : (
      <>
        <p className="title">Nothing indexed yet.</p>
        <p>Run the catalog pipeline, then restart the backend to mirror the result.</p>
      </>
    )

  return (
    <div className={`app${binsOpen ? ' has-bins' : ''}`}>
      <header className="top">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">B-roll Vault</span>
          {health?.rows ? <span className="brand__count dt">{fmtInt(health.rows)} clips</span> : null}
        </div>

        <div className="search">
          <IconSearch size={16} className="search__icon" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search footage — drone, exterior, interview…"
            aria-label="Search clips"
            autoComplete="off"
            spellCheck={false}
          />
          {loading ? (
            <span className="search__loading" role="status"><span className="search__spinner" /> Searching</span>
          ) : query ? (
            <button type="button" className="search__clear" onClick={() => setQuery('')} aria-label="Clear search">
              <IconClose size={14} />
            </button>
          ) : (
            <kbd className="search__kbd dt">/</kbd>
          )}
        </div>

        <div className="top__tools">
          <UpdateBell />
          <button type="button" className="btn btn--quiet" onClick={onSetup}>Settings</button>
          <div className="viewseg" role="radiogroup" aria-label="Catalog view">
            {([
              ['list', 'List', IconRows],
              ['grid', 'Grid', IconGrid],
              ['film', 'Filmstrip', IconFilmstrip],
            ] as const).map(([mode, label, Icon]) => (
              <button key={mode} type="button" role="radio" aria-checked={viewMode === mode} className={`viewseg__btn${viewMode === mode ? ' is-on' : ''}`} onClick={() => setViewMode(mode)}>
                <Icon size={15} /> <span>{label}</span>
              </button>
            ))}
          </div>
          {viewMode !== 'film' ? (
            <div className="sizeseg" role="radiogroup" aria-label="Thumbnail size">
              {(['s', 'm', 'l'] as ThumbSize[]).map((size) => (
                <button key={size} type="button" role="radio" aria-checked={thumbSize === size} className={`sizeseg__btn${thumbSize === size ? ' is-on' : ''}`} onClick={() => setThumbSize(size)}>{size.toUpperCase()}</button>
              ))}
            </div>
          ) : null}
          <button type="button" className={`btn btn--quiet${binsOpen ? ' is-on' : ''}`} onClick={() => setBinsOpen((v) => !v)} aria-pressed={binsOpen}>
            <IconBin size={15} /> Bins{bins.length ? <span className="btn__count dt">{bins.length}</span> : null}
          </button>
          <span className={`health${offline ? ' is-off' : mirror?.ready ? ' is-ok' : ' is-warn'}`} title={offline ? 'API offline' : mirror?.ready ? `Catalog mirrored ${mirror.refreshed_at ?? ''}` : 'Catalog loading'} />
        </div>
      </header>

      {banner ? (
        <div className={`banner banner--${banner.kind}`} role="status">
          <IconWarn size={15} /> {banner.text}
        </div>
      ) : null}

      <main className="main">
        <div className="column">
          <FilterBar filters={filters} facets={facets} currentYear={currentYear} onChange={(f) => setFilters(f)} />

          {!activeBin ? (
            <YearTable
              years={years}
              selected={filters.years}
              onPick={(year, additive) =>
                setFilters({
                  ...filters,
                  years: additive
                    ? filters.years.includes(year)
                      ? filters.years.filter((y) => y !== year)
                      : [...filters.years, year].sort((a, b) => b - a)
                    : filters.years.length === 1 && filters.years[0] === year
                      ? []
                      : [year],
                })
              }
            />
          ) : null}

          <section className={`ledger-card card ledger-card--${viewMode}`}>
            <header className="ledger__head">
              {activeBin ? (
                <span className="ledger__bin">
                  <IconBin size={14} />
                  <span className="title">{activeBin.name}</span>
                  <button type="button" className="btn btn--icon" onClick={() => setFilters({ ...filters, bin: null })} aria-label="Close bin">
                    <IconClose size={14} />
                  </button>
                </span>
              ) : null}
              <span className="ledger__total">
                <strong className="dt">{fmtInt(total)}</strong> {total === 1 ? 'clip' : 'clips'}
                {queryMs !== null ? <span className="ledger__ms dt"> · {queryMs < 1 ? '<1' : Math.round(queryMs)} ms</span> : null}
              </span>
              {filters.stars === 'usable' && facets?.stars?.review ? (
                <span className="ledger__note dt" title="1–2★ clips are hidden from normal search. Pick Stars › Review for deletion to see them.">
                  {fmtInt(facets.stars.review)} low-rated hidden
                </span>
              ) : null}
              {error ? <span className="ledger__err">{error}</span> : null}
              <span className="ledger__spacer" />
              <div className="sortbar" role="group" aria-label="Sort clips">
                <span className="sortbar__label">Sort</span>
                {SORT_KEYS.map((key) => {
                  const active = filters.sortKey === key
                  const label = key === 'fps' ? 'Frame rate' : COLUMN_LABEL[key]
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`sortbar__btn${active ? ' is-on' : ''}`}
                      aria-pressed={active}
                      onClick={() => setFilters({ ...filters, sortKey: key, sortDir: active ? (filters.sortDir === 'desc' ? 'asc' : 'desc') : key === 'name' || key === 'path' || key === 'codec' ? 'asc' : 'desc' })}
                    >
                      {label}{active ? <IconChevron size={12} className={filters.sortDir === 'asc' ? 'is-up' : ''} /> : null}
                    </button>
                  )
                })}
              </div>
            </header>

            <CatalogView
              clips={clips}
              total={total}
              loading={loading}
              hasMore={hasMore}
              checked={checked}
              focusedId={focusedId}
              binIds={binIds}
              viewMode={viewMode}
              thumbSize={thumbSize}
              onLoadMore={loadMore}
              onFocus={(c) => {
                setFocusedId(c.clip_id)
                searchRef.current?.blur()
              }}
              onToggle={toggle}
              onOpen={(c) => {
                setFocusedId(c.clip_id)
                setPeekOpen(true)
              }}
              empty={emptyState}
            />

            {checked.size > 0 ? (
              <div className="selbar" role="toolbar" aria-label="Selection">
                <span className="selbar__n">
                  <strong className="dt">{checked.size}</strong> selected
                </span>
                <button type="button" className="btn btn--warm btn--sm" onClick={() => void addToBin('new', checkedIds)}>
                  <IconPlus size={13} /> New bin
                </button>
                {bins.length ? (
                  <select className="selbar__pick" value="" onChange={(e) => e.target.value && void addToBin(e.target.value, checkedIds)} aria-label="Add selection to bin">
                    <option value="">Add to bin…</option>
                    {bins.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.count})
                      </option>
                    ))}
                  </select>
                ) : null}
                {activeBin ? (
                  <button type="button" className="btn btn--quiet btn--sm" onClick={() => void removeFromActiveBin(checkedIds)}>
                    Remove from bin
                  </button>
                ) : null}
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => requestPremiere(checkedIds)} title={health?.bridge_configured ? 'Send the selected clips to Premiere' : 'Open the Premiere import dialog'}>
                  <IconPremiere size={13} /> Send to Premiere
                </button>
                <span className="ledger__spacer" />
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setChecked(new Set())}>
                  <IconClose size={13} /> Clear
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <Detail
          clip={focused}
          bins={bins}
          busy={saving}
          onRate={(c, n) => void rate(c, n)}
          onRevert={(c) => void revert(c)}
          onAddToBin={(binId, c) => void addToBin(binId, [c.clip_id])}
          onPeek={() => setPeekOpen(true)}
          onToast={toast}
        />

        {binsOpen ? (
          <BinsPanel
            bins={bins}
            activeBin={filters.bin}
            bridge={!!health?.bridge_configured}
            onOpen={(id) => setFilters({ ...filters, bin: id })}
            onRename={(id, name) => void renameBin(id, name)}
            onDelete={(id) => void deleteBin(id)}
            onClose={() => setBinsOpen(false)}
            onToast={toast}
          />
        ) : null}
      </main>

      {peekOpen && focused ? (
        <Peek
          clip={focused}
          index={focusedIndex}
          total={total}
          busy={saving}
          onClose={() => setPeekOpen(false)}
          onStep={step}
          onRate={(c, n) => void rate(c, n)}
          onRevert={(c) => void revert(c)}
          onAddToBin={(c) => void addToBin('new', [c.clip_id])}
          onToast={toast}
        />
      ) : null}

      {newBinFor ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="New bin" onClick={() => setNewBinFor(null)}>
          <form
            className="modal__body card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              void createBin()
            }}
          >
            <h2 className="title">New bin</h2>
            <p className="modal__sub">
              {newBinFor.length} clip{newBinFor.length === 1 ? '' : 's'}. Bins live in the Bins panel; export one as XML and File › Import it into Premiere.
            </p>
            <input autoFocus value={newBinName} onChange={(e) => setNewBinName(e.target.value)} placeholder="Bin name — e.g. Exterior drone wides" aria-label="Bin name" />
            <div className="modal__actions">
              <button type="button" className="btn btn--quiet" onClick={() => setNewBinFor(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn--warm">
                Save bin
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {premiereFor ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Send clips to Premiere" onClick={() => !premiereSending && setPremiereFor(null)}>
          <form
            className="modal__body card premiere-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              void sendToPremiere()
            }}
          >
            <span className="modal__icon"><IconPremiere size={22} /></span>
            <h2 className="title">Send {premiereFor.length} clip{premiereFor.length === 1 ? '' : 's'} to Premiere?</h2>
            <p className="modal__sub">The original media stays in place. Premiere will reference the catalog paths directly.</p>
            <label className="premiere-modal__option">
              <input type="checkbox" checked={premiereMakeBin} onChange={(e) => setPremiereMakeBin(e.target.checked)} />
              <span>Create a bin for these clips</span>
            </label>
            {premiereMakeBin ? <input autoFocus value={premiereBinName} onChange={(e) => setPremiereBinName(e.target.value)} placeholder="Premiere bin name" aria-label="Premiere bin name" /> : null}
            <div className="modal__actions">
              <button type="button" className="btn btn--quiet" disabled={premiereSending} onClick={() => setPremiereFor(null)}>Cancel</button>
              <button type="submit" className="btn btn--warm" disabled={premiereSending}>{premiereSending ? 'Sending…' : 'Send to Premiere'}</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
