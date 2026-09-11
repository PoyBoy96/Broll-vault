export function fmtDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–'
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtHours(seconds?: number | null): string {
  if (!seconds) return '0h'
  const h = seconds / 3600
  if (h < 1) return `${Math.round(seconds / 60)}m`
  return h >= 100 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`
}

export function fmtInt(n?: number | null): string {
  if (n === null || n === undefined) return '–'
  return n.toLocaleString()
}

export function fmtPct(n?: number | null): string {
  if (n === null || n === undefined) return '–'
  return `${Math.round(n)}%`
}

export function fmtBytes(n?: number | null): string {
  if (!n) return '–'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function fmtRes(w?: number | null, h?: number | null): string {
  if (!w || !h) return '–'
  if (w >= 3800) return `${w}×${h} · 4K`
  if (w >= 1900) return `${w}×${h} · HD`
  return `${w}×${h}`
}

/** Short form for the ledger column. */
export function fmtResShort(w?: number | null, h?: number | null): string {
  if (!w || !h) return '–'
  if (w >= 7000) return '8K'
  if (w >= 3800) return '4K'
  if (w >= 2500) return `${h}p`
  if (h >= 1050) return '1080p'
  if (h >= 700) return '720p'
  return `${h}p`
}

export function fmtFps(fps?: number | null): string {
  if (!fps) return '–'
  const r = Math.round(fps * 100) / 100
  return Number.isInteger(r) ? `${r}` : r.toFixed(2).replace(/0+$/, '')
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Folder names in the archive are SHOUTY_SNAKE or CamelCase; make them readable but recognisable. */
export function prettyFolder(name?: string | null): string {
  if (!name) return '–'
  return name
    .replace(/^_+/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

export function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === '1'
}
