import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Clip, ThumbSize, ViewMode } from '../api/types'
import { usePreview } from '../hooks/usePreview'
import { fmtBytes, fmtDate, fmtDuration, fmtFps, fmtRes, fmtResShort, prettyFolder, truthy } from '../lib/format'
import { ClipRow } from './ClipRow'
import { IconCheck, IconStar } from './Icons'
import { Meter } from './Meter'
import { Thumb } from './Thumb'

type Props = {
  clips: Clip[]
  total: number
  loading: boolean
  hasMore: boolean
  checked: Set<number>
  focusedId: number | null
  binIds: Set<number>
  viewMode: ViewMode
  thumbSize: ThumbSize
  onLoadMore: () => void
  onFocus: (clip: Clip) => void
  onToggle: (clip: Clip, shift: boolean) => void
  onOpen: (clip: Clip) => void
  empty: ReactNode
}

function clipName(clip: Clip) {
  return clip.filename ?? clip.relative_path ?? `Clip ${clip.clip_id}`
}

function pathLine(clip: Clip) {
  return [clip.campus, clip.year_bucket ?? clip.year_int, clip.ministry, clip.shoot]
    .filter(Boolean)
    .map((part) => prettyFolder(String(part)))
    .join(' › ')
}

type ItemProps = {
  clip: Clip
  checked: boolean
  focused: boolean
  inBin: boolean
  onFocus: (clip: Clip) => void
  onToggle: (clip: Clip, shift: boolean) => void
  onOpen: (clip: Clip) => void
}

const GridCard = memo(function GridCard({ clip, checked, focused, inBin, onFocus, onToggle, onOpen }: ItemProps) {
  const preview = usePreview(clip.clip_id)
  const mine = truthy(clip.has_user_edits)
  return (
    <article
      className={`grid-card${checked ? ' is-checked' : ''}${focused ? ' is-focused' : ''}`}
      role="option"
      aria-selected={focused}
      tabIndex={0}
      onClick={() => onFocus(clip)}
      onDoubleClick={() => onOpen(clip)}
      onPointerEnter={preview.arm}
      onPointerLeave={preview.disarm}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(clip)
        if (e.key === ' ') {
          e.preventDefault()
          onFocus(clip)
        }
      }}
    >
      <div className="grid-card__media">
        <Thumb clip={clip} previewSrc={preview.src} previewWaiting={preview.state === 'waiting'} />
        <span className="duration-badge dt">{fmtDuration(clip.duration_seconds)}</span>
        <button
          type="button"
          className={`media-check${checked ? ' is-on' : ''}`}
          aria-label={checked ? 'Remove from selection' : 'Add to selection'}
          aria-pressed={checked}
          onClick={(e: MouseEvent) => {
            e.stopPropagation()
            onToggle(clip, e.shiftKey)
          }}
        >
          {checked ? <IconCheck size={13} /> : null}
        </button>
      </div>
      <h3 className="grid-card__name" title={clipName(clip)}>{clipName(clip)}</h3>
      <div className="grid-card__rating">
        <Meter clip={clip} />
        {mine ? <span className="pill pill--warm">Yours</span> : null}
        {inBin ? <span className="pill pill--cool">In bin</span> : null}
      </div>
      <div className="grid-card__tech dt">
        {[fmtResShort(clip.width, clip.height), fmtFps(clip.fps), clip.video_codec, fmtBytes(clip.size_bytes)].filter((v) => v && v !== '–').join(' · ') || 'Metadata pending'}
      </div>
      <div className="grid-card__path dt">{pathLine(clip)}</div>
    </article>
  )
})

const FilmCard = memo(function FilmCard({ clip, checked, focused, inBin, onFocus, onToggle, onOpen }: ItemProps) {
  const preview = usePreview(clip.clip_id)
  const mine = truthy(clip.has_user_edits)
  const name = clipName(clip)
  return (
    <article
      className={`film-card${checked ? ' is-checked' : ''}${focused ? ' is-focused' : ''}`}
      role="option"
      aria-selected={focused}
      tabIndex={0}
      onClick={() => onFocus(clip)}
      onDoubleClick={() => onOpen(clip)}
      onPointerEnter={preview.arm}
      onPointerLeave={preview.disarm}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(clip)}
    >
      <div className="film-card__media">
        <Thumb clip={clip} previewSrc={preview.src} previewWaiting={preview.state === 'waiting'} />
        <span className="duration-badge dt">{fmtDuration(clip.duration_seconds)}</span>
        <button
          type="button"
          className={`media-check${checked ? ' is-on' : ''}`}
          aria-label={checked ? 'Remove from selection' : 'Add to selection'}
          aria-pressed={checked}
          onClick={(e: MouseEvent) => {
            e.stopPropagation()
            onToggle(clip, e.shiftKey)
          }}
        >
          {checked ? <IconCheck size={13} /> : null}
        </button>
      </div>
      <div className="film-card__body">
        <div className="film-card__titleline">
          <h3 title={name}>{name}</h3>
          {mine ? <span className="pill pill--warm">Yours</span> : null}
          {truthy(clip.is_highlight) ? <IconStar size={16} filled className="film-card__highlight" /> : null}
          {inBin ? <span className="pill pill--cool">In bin</span> : null}
        </div>
        <div className="film-card__path dt">{pathLine(clip)}</div>
        <Meter clip={clip} size="large" />
        <p className="film-card__reason">{clip.quality_reasons ?? 'Not analyzed yet'}</p>
        <dl className="film-card__facts">
          <div><dt>Date</dt><dd>{fmtDate(clip.inferred_recorded_date ?? clip.modified_at_utc)}</dd></div>
          <div><dt>Length</dt><dd>{fmtDuration(clip.duration_seconds)}</dd></div>
          <div><dt>Frame</dt><dd>{fmtRes(clip.width, clip.height)}</dd></div>
          <div><dt>Rate</dt><dd>{fmtFps(clip.fps)} fps</dd></div>
          <div><dt>Codec</dt><dd>{[clip.video_codec, (clip.extension ?? '').replace('.', '').toLowerCase()].filter(Boolean).join(' · ') || '–'}</dd></div>
          <div><dt>Size</dt><dd>{fmtBytes(clip.size_bytes)}</dd></div>
        </dl>
      </div>
    </article>
  )
})

function Skeleton({ viewMode, columns }: { viewMode: ViewMode; columns: number }) {
  if (viewMode === 'grid') {
    return <div className="grid-row">{Array.from({ length: columns }, (_, i) => <div key={i} className="grid-card grid-card--skeleton"><span className="sk grid-card__media" /><span className="sk sk--name" /><span className="sk sk--notes" /></div>)}</div>
  }
  return <div className={viewMode === 'film' ? 'film-card film-card--skeleton' : 'row row--skeleton'}><span className="sk sk--thumb" /><span className="sk sk--name" /><span className="sk sk--notes" /></div>
}

export function CatalogView({ clips, total, loading, hasMore, checked, focusedId, binIds, viewMode, thumbSize, onLoadMore, onFocus, onToggle, onOpen, empty }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1400)

  useLayoutEffect(() => {
    const el = parentRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const minCard = thumbSize === 's' ? 210 : thumbSize === 'm' ? 280 : 350
  const columns = viewMode === 'grid' ? Math.max(1, Math.floor((width - 24) / minCard)) : 1
  const loadedRows = viewMode === 'grid' ? Math.ceil(clips.length / columns) : clips.length
  const skeletonRows = hasMore || loading ? (viewMode === 'grid' ? 2 : 5) : 0
  const count = loadedRows + skeletonRows
  const itemSize = useMemo(() => {
    if (viewMode === 'list') return thumbSize === 's' ? 92 : thumbSize === 'm' ? 122 : 154
    if (viewMode === 'film') return thumbSize === 's' ? 264 : thumbSize === 'm' ? 332 : 402
    return thumbSize === 's' ? 252 : thumbSize === 'm' ? 322 : 394
  }, [viewMode, thumbSize])

  const virt = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemSize,
    overscan: viewMode === 'grid' ? 3 : 6,
    getItemKey: (index) => clips[viewMode === 'grid' ? index * columns : index]?.clip_id ?? `skeleton-${viewMode}-${index}`,
  })

  useEffect(() => {
    virt.measure()
  }, [itemSize, columns, viewMode, virt])

  const items = virt.getVirtualItems()
  const last = items[items.length - 1]
  useEffect(() => {
    if (last && hasMore && !loading && last.index >= loadedRows - 3) onLoadMore()
  }, [last, hasMore, loading, loadedRows, onLoadMore])

  useEffect(() => {
    if (focusedId === null) return
    const index = clips.findIndex((clip) => clip.clip_id === focusedId)
    if (index >= 0) virt.scrollToIndex(viewMode === 'grid' ? Math.floor(index / columns) : index, { align: 'auto' })
  }, [focusedId, clips, columns, viewMode, virt])

  if (!loading && clips.length === 0) return <div className="catalog__empty">{empty}</div>

  return (
    <>
      {viewMode === 'list' ? (
        <div className="list-head" aria-hidden="true">
          <span>Name</span><span>Notes</span><span>Stars</span><span>Date</span><span>Length</span><span>Res</span><span>Fps</span><span>Codec</span><span>Size</span>
        </div>
      ) : null}
      <div ref={parentRef} className={`catalog catalog--${viewMode} catalog--${thumbSize}`} role="listbox" aria-label={`${total.toLocaleString()} clips`}>
        <div className="catalog__inner" style={{ height: virt.getTotalSize() }}>
          {items.map((vi) => {
            const start = viewMode === 'grid' ? vi.index * columns : vi.index
            const rowClips = viewMode === 'grid' ? clips.slice(start, start + columns) : clips.slice(start, start + 1)
            return (
              <div key={vi.key} className={`catalog__slot catalog__slot--${viewMode}`} style={{ transform: `translateY(${vi.start}px)`, height: vi.size }} ref={virt.measureElement} data-index={vi.index}>
                {rowClips.length ? viewMode === 'grid' ? (
                  <div className="grid-row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                    {rowClips.map((clip) => <GridCard key={clip.clip_id} clip={clip} checked={checked.has(clip.clip_id)} focused={focusedId === clip.clip_id} inBin={binIds.has(clip.clip_id)} onFocus={onFocus} onToggle={onToggle} onOpen={onOpen} />)}
                  </div>
                ) : viewMode === 'film' ? (
                  <FilmCard clip={rowClips[0]!} checked={checked.has(rowClips[0]!.clip_id)} focused={focusedId === rowClips[0]!.clip_id} inBin={binIds.has(rowClips[0]!.clip_id)} onFocus={onFocus} onToggle={onToggle} onOpen={onOpen} />
                ) : (
                  <ClipRow clip={rowClips[0]!} checked={checked.has(rowClips[0]!.clip_id)} focused={focusedId === rowClips[0]!.clip_id} inBin={binIds.has(rowClips[0]!.clip_id)} onFocus={onFocus} onToggle={onToggle} onOpen={onOpen} />
                ) : <Skeleton viewMode={viewMode} columns={columns} />}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
