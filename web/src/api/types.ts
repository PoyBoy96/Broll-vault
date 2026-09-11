/* ---------------------------------------------------------------------------
   Types for the catalog API (server_api.py v3).

   The row shape was read off the live database on 2026-09-01. Anything not
   listed still passes through the index signature. Treat every field as
   possibly-null: the catalog was built by a scraping pass over a network share.
   --------------------------------------------------------------------------- */

export type ApiError = { code: string; message: string }
export type Fail = { ok: false; error: ApiError }

export type ReviewStatus = 'analyzed' | 'error' | 'pending' | (string & {})

export type Clip = {
  clip_id: number
  filename?: string | null
  extension?: string | null
  relative_path?: string | null
  absolute_path?: string | null
  parent_folder?: string | null
  top_folder?: string | null

  /** Derived by the backend from relative_path. */
  campus?: string | null
  ministry?: string | null
  shoot?: string | null
  year_bucket?: string | null
  year_int?: number | null

  path_year?: number | null
  review_year?: number | null
  inferred_recorded_date?: string | null
  modified_at_utc?: string | null
  analyzed_at?: string | null

  thumbnail_path?: string | null
  /** Direct image URL when the pipeline made a thumbnail, else null. */
  thumb_url?: string | null
  /** Always present: ffmpeg grabs a frame on demand (slow first time, cached after). */
  frame_url?: string

  /** 1–5, or null when the scorer has not rated this clip. Null is NOT zero. */
  quality_stars?: number | null
  quality_score_raw?: number | null
  /** ~0..1, nullable. Low = the scorer is unsure, not that the clip is bad. */
  quality_confidence?: number | null
  quality_reasons?: string | null
  review_status?: ReviewStatus | null
  error_message?: string | null

  is_present?: number | boolean | null
  is_proxy?: number | boolean | null
  is_highlight?: number | boolean | null
  has_user_edits?: number | boolean | null

  duration_seconds?: number | null
  width?: number | null
  height?: number | null
  fps?: number | null
  video_codec?: string | null
  pixel_format?: string | null
  bitrate_bps?: number | null
  size_bytes?: number | null
  has_audio?: number | null

  rank_score?: number | null
  [column: string]: unknown
}

export type ClipsResponse = {
  ok: true
  page: number
  page_size: number
  total: number
  total_pages: number
  sort: string
  seed: number | null
  query_ms?: number
  items: Clip[]
}

export type EditRecord = {
  id: number
  clip_id: number
  field_name: string
  old_value: string | null
  new_value: string | null
  reason: string | null
  edited_at: string
}

export type ClipDetail = Clip & {
  quality_issues: Array<Record<string, unknown>>
  frame_metrics_sample: Array<Record<string, unknown>>
  edit_history: EditRecord[]
}

export type SortKey =
  | 'stars'
  | 'date'
  | 'length'
  | 'name'
  | 'path'
  | 'res'
  | 'fps'
  | 'codec'
  | 'size'

export type SortDir = 'asc' | 'desc'

export type ViewMode = 'list' | 'grid' | 'film'
export type ThumbSize = 's' | 'm' | 'l'

export type StarMode = 'usable' | '3plus' | '4plus' | '5' | 'unrated' | 'rated' | 'review' | 'all'

export type YearRow = {
  year: number
  total_clips: number
  present_clips: number
  missing_thumbnails: number
  strong_clips: number
  weak_clips: number
  unrated_clips: number
  unreviewed_clips: number
  total_seconds: number
  needs_work: number
  coverage: {
    present_pct: number
    missing_pct: number
    ready_pct: number
    weak_pct: number
    unrated_pct: number
    rated_pct: number
    missing_thumb_pct: number
  }
}

export type FacetCount = { value: string; count: number }
export type MinistryFacet = { value: string; campus: string; count: number }
export type FormatFacet = { kind: 'res' | 'codec' | 'ext'; value: string; count: number }

export type Facets = {
  total: number
  campuses: FacetCount[]
  ministries: MinistryFacet[]
  stars: Record<StarMode | '1' | '2' | '3' | '4' | '5', number>
  years: Array<{ year: number; count: number }>
  formats: FormatFacet[]
}

export type MetaEnums = {
  review_status: string[]
  quality_stars: number[]
  year_values: number[]
  campuses: string[]
  extensions: string[]
  current_year: number
  [k: string]: unknown
}

export type Health = {
  ok: true
  db_ok: boolean
  rows: number | null
  ffmpeg: boolean
  bridge_configured: boolean
  mirror: {
    ready: boolean
    loading: boolean
    source_reachable: boolean
    refreshed_at: string | null
    last_error: string | null
    version: number
  }
}

export type PreviewResponse = {
  clip_id: number
  src: string
  seconds: number
  fps: number
  width: number
  cache_hit: boolean
  generation_ms: number
}

export type Bin = {
  id: string
  name: string
  clip_ids: number[]
  count: number
  created_at: string | null
  updated_at: string | null
  cover_ids: number[]
}

export type EditableField =
  | 'quality_stars'
  | 'quality_score_raw'
  | 'quality_confidence'
  | 'quality_reasons'
  | 'review_status'
  | 'is_present'
  | 'is_proxy'
  | 'is_highlight'

export type ClipEdit = Partial<Record<EditableField, unknown>>

/** Everything that shapes the ledger query. Serialised to the URL and to preferences. */
export type Filters = {
  q: string
  years: number[]
  campus: string[]
  campusNot: string[]
  ministry: string[]
  ministryNot: string[]
  format: string[]
  formatNot: string[]
  stars: StarMode
  sortKey: SortKey
  sortDir: SortDir
  needsYou: Array<'unrated' | 'needs_thumbnail' | 'mine' | 'highlight' | 'offline'>
  bin: string | null
}

export const DEFAULT_FILTERS: Filters = {
  q: '',
  years: [],
  campus: [],
  campusNot: [],
  ministry: [],
  ministryNot: [],
  stars: 'usable',
  format: [],
  formatNot: [],
  sortKey: 'stars',
  sortDir: 'desc',
  needsYou: [],
  bin: null,
}

export const STAR_MODE_LABEL: Record<StarMode, string> = {
  usable: 'Usable · 3★+ and unscored',
  '3plus': '3★ and up',
  '4plus': '4★ and up',
  '5': '5★ only',
  unrated: 'Unscored only',
  rated: 'Scored only',
  review: 'Review for deletion · 1–2★',
  all: 'Everything',
}

export const COLUMN_LABEL: Record<SortKey, string> = {
  stars: 'Stars',
  date: 'Date',
  length: 'Length',
  name: 'Name',
  path: 'Path',
  res: 'Resolution',
  fps: 'Fps',
  codec: 'Codec',
  size: 'Size',
}
