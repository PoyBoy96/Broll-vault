import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Clip } from '../api/types'
import { ClipRow } from './ClipRow'

/* ---------------------------------------------------------------------------
   The ledger. Virtualised; pages load as the scroll approaches the end so the
   list reads as one continuous archive. Row height comes from --row-h so the
   density switch changes it in one place.
   --------------------------------------------------------------------------- */

type Props = {
  clips: Clip[]
  total: number
  loading: boolean
  hasMore: boolean
  checked: Set<number>
  focusedId: number | null
  binIds: Set<number>
  onLoadMore: () => void
  onFocus: (clip: Clip) => void
  onToggle: (clip: Clip, shift: boolean) => void
  onOpen: (clip: Clip) => void
  empty: React.ReactNode
}

function rowHeight(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim()
  const n = parseFloat(v)
  return (Number.isFinite(n) ? n : 56) + 3 // +3px gap between bands
}

export function Ledger({ clips, total, loading, hasMore, checked, focusedId, binIds, onLoadMore, onFocus, onToggle, onOpen, empty }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const density = document.documentElement.dataset.density ?? 'default'

  const count = clips.length + (hasMore || loading ? 6 : 0)
  const virt = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: rowHeight,
    overscan: 8,
    getItemKey: (i) => clips[i]?.clip_id ?? `skeleton-${i}`,
  })

  // Density change: re-measure every row.
  useEffect(() => {
    virt.measure()
  }, [density, virt])

  const items = virt.getVirtualItems()
  const last = items[items.length - 1]
  useEffect(() => {
    if (!last) return
    if (hasMore && !loading && last.index >= clips.length - 12) onLoadMore()
  }, [last, hasMore, loading, clips.length, onLoadMore])

  // Keep the keyboard cursor in view.
  useEffect(() => {
    if (focusedId === null) return
    const idx = clips.findIndex((c) => c.clip_id === focusedId)
    if (idx >= 0) virt.scrollToIndex(idx, { align: 'auto' })
  }, [focusedId, clips, virt])

  if (!loading && clips.length === 0) {
    return <div className="ledger__empty">{empty}</div>
  }

  return (
    <div ref={parentRef} className="ledger" role="listbox" aria-label={`${total.toLocaleString()} clips`}>
      <div className="ledger__inner" style={{ height: virt.getTotalSize() }}>
        {items.map((vi) => {
          const clip = clips[vi.index]
          return (
            <div
              key={vi.key}
              className="ledger__slot"
              style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}
              data-index={vi.index}
              ref={virt.measureElement}
            >
              {clip ? (
                <ClipRow
                  clip={clip}
                  checked={checked.has(clip.clip_id)}
                  focused={focusedId === clip.clip_id}
                  inBin={binIds.has(clip.clip_id)}
                  onFocus={onFocus}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              ) : (
                <div className="row row--skeleton" aria-hidden="true">
                  <span className="sk sk--check" />
                  <span className="sk sk--thumb" />
                  <span className="sk sk--meter" />
                  <span className="sk sk--name" />
                  <span className="sk sk--notes" />
                  <span className="sk sk--len" />
                  <span className="sk sk--fmt" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
