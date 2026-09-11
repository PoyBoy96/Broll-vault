import type {
  Bin,
  Clip,
  ClipDetail,
  ClipEdit,
  ClipsResponse,
  Facets,
  Fail,
  Filters,
  Health,
  MetaEnums,
  SortDir,
  PreviewResponse,
  YearRow,
} from './types'

/* ---------------------------------------------------------------------------
   Thin typed client over the catalog API.

   Everything goes through `call`, which understands exactly one error shape:
     { ok: false, error: { code, message } }
   so one error boundary covers the whole surface.
   --------------------------------------------------------------------------- */

export class ApiFailure extends Error {
  code: string
  status: number
  extra: Record<string, unknown>
  constructor(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiFailure'
    this.code = code
    this.status = status
    this.extra = extra
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiFailure(
      'server_unreachable',
      'Cannot reach the catalog API. Is start_broll_catalog_backend.bat running?',
      0,
    )
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new ApiFailure('bad_response', `Expected JSON from ${path} but got ${res.status}.`, res.status)
    }
  }

  if (body && typeof body === 'object' && (body as Fail).ok === false) {
    const err = (body as Fail).error
    const { ok: _ok, error: _error, ...rest } = body as Fail & Record<string, unknown>
    throw new ApiFailure(err?.code ?? 'unknown', err?.message ?? 'Request failed', res.status, rest)
  }
  if (!res.ok) {
    throw new ApiFailure('http_error', `${res.status} ${res.statusText}`, res.status)
  }
  return body as T
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue
    sp.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

function post(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

/** Filters -> the backend's query vocabulary. The only translation in the app. */
export function filterParams(f: Filters): Record<string, string | number | boolean | null> {
  const needs = new Set(f.needsYou)
  return {
    q: f.q.trim(),
    years: f.years.length ? f.years.join(',') : null,
    campus: f.campus.length ? f.campus.join(',') : null,
    campus_not: f.campusNot.length ? f.campusNot.join(',') : null,
    ministry: f.ministry.length ? f.ministry.join(',') : null,
    ministry_not: f.ministryNot.length ? f.ministryNot.join(',') : null,
    format: f.format.length ? f.format.join(',') : null,
    format_not: f.formatNot.length ? f.formatNot.join(',') : null,
    // "Needs you: unscored" is a star mode; the rest are flags.
    stars: needs.has('unrated') ? 'unrated' : f.stars,
    needs_thumbnail: needs.has('needs_thumbnail') ? true : null,
    has_user_edits: needs.has('mine') ? true : null,
    is_highlight: needs.has('highlight') ? true : null,
    is_present: needs.has('offline') ? false : null,
    bin: f.bin,
    sort: `${f.sortKey}_${f.sortDir}` as `${string}_${SortDir}`,
    sort_key: f.sortKey,
    sort_dir: f.sortDir,
  }
}

export const api = {
  health: () => call<Health>('/api/health'),

  years: () => call<{ years: YearRow[]; current_year: number }>('/api/years'),

  enums: () => call<{ meta: MetaEnums }>('/api/meta/enums').then((r) => r.meta),

  clips: (f: Filters, page: number, pageSize: number, _seed?: number) =>
    call<ClipsResponse>(
      `/api/clips${qs({ ...filterParams(f), page, page_size: pageSize, seed: null })}`,
    ),

  facets: (f: Filters) => call<Facets>(`/api/facets${qs(filterParams(f))}`),

  clip: (id: number) => call<{ clip: ClipDetail }>(`/api/clips/${id}`).then((r) => r.clip),

  preview: (id: number, seconds = 3, fps = 6, width = 480) =>
    call<{ preview: PreviewResponse }>(`/api/clips/${id}/preview${qs({ seconds, fps, width })}`).then((r) => r.preview),

  edit: (id: number, updates: ClipEdit, reason?: string) =>
    call<{ clip: Clip }>(`/api/clips/${id}/edit`, post({ updates, reason })).then((r) => r.clip),

  revert: (id: number, field = 'quality_stars') =>
    call<{ clip: Clip }>(`/api/clips/${id}/revert`, post({ field })).then((r) => r.clip),

  getPreferences: () => call<{ state: Record<string, unknown> }>('/api/preferences').then((r) => r.state ?? {}),
  setPreferences: (state: Record<string, unknown>) => call<{ ok: true }>('/api/preferences', post(state)),

  bins: () => call<{ bins: Bin[] }>('/api/bins').then((r) => r.bins ?? []),
  createBin: (name: string, clipIds: number[]) =>
    call<{ bin: Bin }>('/api/bins', post({ name, clip_ids: clipIds })).then((r) => r.bin),
  updateBin: (id: string, patch: { name?: string; add?: number[]; remove?: number[]; clip_ids?: number[] }) =>
    call<{ bin: Bin }>(`/api/bins/${id}`, post(patch)).then((r) => r.bin),
  deleteBin: (id: string) => call<{ ok: true }>(`/api/bins/${id}/delete`, post({})),
  binToPremiere: (id: string) => call<{ ok: true; imported: string[] }>(`/api/bins/${id}/premiere`, post({})),
  binExportUrl: (id: string) => `/api/bins/${id}/export.xml`,
  binPathsUrl: (id: string) => `/api/bins/${id}/paths.txt`,

  premiereImport: (clipIds: number[], options?: { make_bin?: boolean; bin_name?: string }) =>
    call<{ ok: true; imported: string[] }>(
      '/api/premiere/import',
      post({ clip_ids: clipIds, make_bin: options?.make_bin, bin_name: options?.bin_name }),
    ),
}
