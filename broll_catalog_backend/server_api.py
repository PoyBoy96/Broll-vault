#!/usr/bin/env python3
"""Loopback-only catalog server for the Vault desktop application.

Library and cache locations are validated in first-run setup and saved only in
local application data. The shared catalog is read-only. An optional Phase 0
editor transport can be enabled with BROLL_EDITOR_SPIKE=1 for manual testing.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import queue
import random
import re
import shutil
import secrets
from http.cookies import SimpleCookie
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from math import ceil
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import parse_qs, quote, unquote, urlparse
from xml.sax.saxutils import escape as xml_escape

from editor_spike import EditorSpike
from app_config import SettingsStore
from app_release import ReleaseChecker
from catalog_io import readonly_catalog_uri


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

SETTINGS_STORE = SettingsStore()
APP_SETTINGS = SETTINGS_STORE.load()
RELEASE_CHECKER = ReleaseChecker()
DB_PATH = APP_SETTINGS.catalog_path
PORT = int(os.getenv("BROLL_CATALOG_PORT", "8010"))
PREVIEW_DIR = Path(APP_SETTINGS.cache_path or SETTINGS_STORE.home / "cache") / APP_SETTINGS.library_key
STATE_PATH = SETTINGS_STORE.home / "config" / f"bins-{APP_SETTINGS.library_key}.json"
PREMIERE_BRIDGE_URL = os.getenv("BROLL_PREMIERE_BRIDGE_URL", "").strip()
CSV_TEMPLATE = str(Path(DB_PATH).parent / "broll_quality_{year}.csv") if DB_PATH else ""
MEDIA_ROOT = Path(APP_SETTINGS.media_root) if APP_SETTINGS.media_root else None
THUMB_DIR = PREVIEW_DIR / "thumbs"
MIRROR_DIR = PREVIEW_DIR / "mirror"
MIRROR_PATH = MIRROR_DIR / "catalog_mirror.sqlite"
MIRROR_META = MIRROR_DIR / "catalog_mirror.json"
MIRROR_CHECK_SECS = float(os.getenv("BROLL_MIRROR_CHECK_SECS", "30"))
FRONTEND_DIST = Path(
    os.getenv("BROLL_FRONTEND_DIST", str(Path(__file__).resolve().parent.parent / "web" / "dist"))
)

ALLOWED_EDIT_FIELDS = {
    "quality_stars",
    "quality_score_raw",
    "quality_confidence",
    "quality_reasons",
    "review_status",
    "is_present",
    "is_proxy",
    "is_highlight",
}

DEFAULT_PAGE_SIZE = 60
MAX_PAGE_SIZE = 500
MIN_PREVIEW_SECONDS = 1
MAX_PREVIEW_SECONDS = 12
MIN_PREVIEW_FPS = 1
MAX_PREVIEW_FPS = 24
MIN_PREVIEW_WIDTH = 240
MAX_PREVIEW_WIDTH = 960
THUMB_WIDTH = 480
FRAME_GRAB_TIMEOUT = 25
PREVIEW_TIMEOUT = 45

# How many ffmpeg processes may run at once against the share. Previews and
# frame grabs share this budget; the share is the bottleneck, not the CPU.
_FFMPEG_SLOTS = threading.BoundedSemaphore(3)
_PREVIEW_LOCKS: Dict[str, threading.Lock] = {}
_THUMB_LOCKS: Dict[str, threading.Lock] = {}
_LOCK_LOCK = threading.Lock()
_STATE_LOCK = threading.RLock()

YEAR_SEGMENT = re.compile(r"^(19|20)\d{2}$")
NON_YEAR_BUCKETS = {"old", "_old", "misc", "archive", "history", "_history"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _log(msg: str) -> None:
    # Do not record workstation paths or source filenames in shipped diagnostics.
    for private in (DB_PATH, str(MEDIA_ROOT or ""), str(SETTINGS_STORE.home), str(PREVIEW_DIR)):
        if private:
            msg = msg.replace(private, "[local path]")
    if os.sys.stdout is not None:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def _to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def _as_int(value: Optional[str], default: Optional[int] = None) -> Optional[int]:
    try:
        return int(value) if value is not None and value != "" else default
    except (TypeError, ValueError):
        return default


def _as_int_range(value: Optional[str], default: int, minimum: int, maximum: int) -> int:
    raw = _as_int(value, default)
    if raw is None:
        return default
    return max(minimum, min(maximum, raw))


def _as_float(value: Optional[str], default: float, minimum: float, maximum: float) -> float:
    try:
        out = float(value) if value is not None else default
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, out))


def _parse_bool(raw: Optional[str]) -> Optional[bool]:
    if raw is None:
        return None
    v = str(raw).strip().lower()
    if v in {"1", "true", "yes", "on", "y"}:
        return True
    if v in {"0", "false", "no", "off", "n"}:
        return False
    return None


def _csv_list(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


def _sanitize_name(value: str, fallback: str = "file") -> str:
    safe = re.sub(r"[^0-9a-zA-Z._-]", "_", value or "")
    safe = safe.strip("._-")
    return safe or fallback


def _get_lock(cache: Dict[str, threading.Lock], key: str) -> threading.Lock:
    with _LOCK_LOCK:
        lock = cache.get(key)
        if lock is None:
            lock = threading.Lock()
            cache[key] = lock
        return lock


def _resolve_path(value: Optional[str]) -> Optional[str]:
    if not value or MEDIA_ROOT is None:
        return None
    candidate = Path(value)
    if candidate.is_absolute() or str(value).startswith("\\\\"):
        return str(candidate)
    return str(MEDIA_ROOT / str(value).lstrip("/\\"))


def _split_path(relative_path: Optional[str]) -> Tuple[str, Optional[str], Optional[str], Optional[str]]:
    """relative_path -> (campus, year_bucket, ministry, shoot).

    Archive convention is CAMPUS\\YEAR\\MINISTRY\\SHOOT\\file. Older material is
    CAMPUS\\OLD\\SHOOT\\file; a few trees skip the year entirely. Ministry is the
    first folder that is neither the campus nor a year-ish bucket.
    """
    rel = (relative_path or "").replace("/", "\\")
    segs = [s for s in rel.split("\\") if s]
    if not segs:
        return ("(untracked)", None, None, None)
    campus = segs[0]
    dirs = segs[1:-1]  # drop the filename
    year_bucket: Optional[str] = None
    idx = 0
    if dirs:
        first = dirs[0]
        if YEAR_SEGMENT.match(first) or first.lower() in NON_YEAR_BUCKETS:
            year_bucket = first
            idx = 1
    ministry = dirs[idx] if len(dirs) > idx else None
    shoot = dirs[idx + 1] if len(dirs) > idx + 1 else None
    return (campus, year_bucket, ministry, shoot)


# --------------------------------------------------------------------------
# Mirror: local copy of the catalog, refreshed when the source changes
# --------------------------------------------------------------------------


class Mirror:
    """Owns the local copy of the catalog and a pool of read connections."""

    POOL_SIZE = 6

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._pool: "queue.Queue[sqlite3.Connection]" = queue.Queue()
        self._borrowed = 0
        self._open = False
        self.ready = False
        self.loading = False
        self.source_reachable = False
        self.signature: Optional[Tuple[int, int]] = None
        self.refreshed_at: Optional[str] = None
        self.last_error: Optional[str] = None
        self.version = 0  # bumps on rebuild and on edit; caches key on it
        self.columns: List[str] = []
        self._years_cache: Optional[Tuple[int, List[Dict[str, Any]]]] = None

    # -- signature -------------------------------------------------------

    def source_signature(self) -> Optional[Tuple[int, int]]:
        try:
            st = os.stat(DB_PATH)
            self.source_reachable = True
            return (int(st.st_mtime_ns), int(st.st_size))
        except OSError:
            self.source_reachable = False
            return None

    def _load_meta(self) -> Optional[Tuple[int, int]]:
        try:
            with MIRROR_META.open("r", encoding="utf-8") as f:
                meta = json.load(f)
            sig = meta.get("signature")
            if isinstance(sig, list) and len(sig) == 2:
                self.refreshed_at = meta.get("refreshed_at")
                return (int(sig[0]), int(sig[1]))
        except Exception:
            pass
        return None

    def _save_meta(self, sig: Tuple[int, int]) -> None:
        MIRROR_DIR.mkdir(parents=True, exist_ok=True)
        with MIRROR_META.open("w", encoding="utf-8") as f:
            json.dump({"signature": list(sig), "refreshed_at": self.refreshed_at, "source": DB_PATH}, f)

    # -- pool ------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(MIRROR_PATH), check_same_thread=False, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA temp_store = MEMORY;")
        conn.execute("PRAGMA cache_size = -65536;")
        conn.execute("PRAGMA mmap_size = 268435456;")
        return conn

    def _open_pool(self) -> None:
        for _ in range(self.POOL_SIZE):
            self._pool.put(self._connect())
        probe = self._connect()
        try:
            self.columns = [r[1] for r in probe.execute("PRAGMA table_info(clips)").fetchall()]
        finally:
            probe.close()
        self._open = True
        self.ready = True
        if self.version == 0:
            self.version = 1

    def _close_pool(self) -> None:
        self._open = False
        while True:
            try:
                conn = self._pool.get_nowait()
            except queue.Empty:
                break
            try:
                conn.close()
            except Exception:
                pass

    class _Borrow:
        def __init__(self, mirror: "Mirror") -> None:
            self.mirror = mirror
            self.conn: Optional[sqlite3.Connection] = None

        def __enter__(self) -> sqlite3.Connection:
            m = self.mirror
            with m._cond:
                deadline = time.monotonic() + 60
                while not m._open:
                    if time.monotonic() > deadline:
                        raise RuntimeError("catalog mirror is not ready")
                    m._cond.wait(timeout=5)
                m._borrowed += 1
            try:
                self.conn = m._pool.get(timeout=60)
            except queue.Empty:
                with m._cond:
                    m._borrowed -= 1
                    m._cond.notify_all()
                raise RuntimeError("no free catalog connection")
            return self.conn

        def __exit__(self, *_: Any) -> None:
            m = self.mirror
            if self.conn is not None:
                try:
                    if self.conn.in_transaction:
                        self.conn.rollback()
                except Exception:
                    pass
                m._pool.put(self.conn)
            with m._cond:
                m._borrowed -= 1
                m._cond.notify_all()

    def borrow(self) -> "Mirror._Borrow":
        return Mirror._Borrow(self)

    # -- build -----------------------------------------------------------

    def ensure(self) -> None:
        """Startup: reuse a mirror whose signature matches, else rebuild."""
        if not DB_PATH:
            return
        MIRROR_DIR.mkdir(parents=True, exist_ok=True)
        sig = self.source_signature()
        saved = self._load_meta()
        if MIRROR_PATH.exists() and saved is not None and (sig is None or sig == saved):
            self.signature = saved
            with self._cond:
                self._open_pool()
                self._cond.notify_all()
            if sig is None:
                _log("Source catalog unreachable; serving the last local mirror.")
            else:
                _log("Local mirror is current; reusing it.")
            return
        if sig is None:
            self.last_error = f"Catalog not reachable and no local mirror: {DB_PATH}"
            _log(self.last_error)
            return
        self.rebuild(sig)

    def rebuild(self, sig: Optional[Tuple[int, int]] = None) -> bool:
        sig = sig or self.source_signature()
        if sig is None:
            self.last_error = "source unreachable"
            return False
        tmp = MIRROR_DIR / f"catalog_mirror.{uuid.uuid4().hex[:8]}.tmp"
        start = time.perf_counter()
        self.loading = True
        _log(f"Mirroring catalog from {DB_PATH} ...")
        try:
            src = sqlite3.connect(readonly_catalog_uri(Path(DB_PATH)), uri=True, timeout=60)
            try:
                dst = sqlite3.connect(str(tmp))
                try:
                    dst.execute("PRAGMA journal_mode = OFF;")
                    dst.execute("PRAGMA synchronous = OFF;")
                    src.backup(dst)
                finally:
                    dst.close()
            finally:
                src.close()
            self._derive(tmp)
        except Exception as exc:
            self.last_error = f"mirror rebuild failed: {exc}"
            self.loading = False
            _log(self.last_error)
            try:
                tmp.unlink()
            except OSError:
                pass
            return False

        # Swap: wait until nobody holds a connection, then replace the file.
        with self._cond:
            while self._borrowed > 0:
                self._cond.wait(timeout=30)
            self._close_pool()
            for suffix in ("-wal", "-shm"):
                p = Path(str(MIRROR_PATH) + suffix)
                if p.exists():
                    try:
                        p.unlink()
                    except OSError:
                        pass
            os.replace(tmp, MIRROR_PATH)
            self.signature = sig
            self.refreshed_at = _now()
            self.version += 1
            self._years_cache = None
            self.last_error = None
            self._save_meta(sig)
            self._open_pool()
            self.loading = False
            self._cond.notify_all()
        _log(f"Mirror ready in {time.perf_counter() - start:.1f}s")
        return True

    def _derive(self, path: Path) -> None:
        """Add derived columns + indexes to a freshly copied mirror."""
        conn = sqlite3.connect(str(path))
        try:
            conn.execute("PRAGMA journal_mode = OFF;")
            conn.execute("PRAGMA synchronous = OFF;")
            cols = {r[1] for r in conn.execute("PRAGMA table_info(clips)").fetchall()}
            for col, ctype in (("campus", "TEXT"), ("ministry", "TEXT"), ("shoot", "TEXT"), ("year_bucket", "TEXT"), ("year_int", "INTEGER")):
                if col not in cols:
                    conn.execute(f"ALTER TABLE clips ADD COLUMN {col} {ctype}")
            rows = conn.execute("SELECT clip_id, relative_path, path_year, review_year FROM clips").fetchall()
            updates = []
            for clip_id, rel, path_year, review_year in rows:
                campus, bucket, ministry, shoot = _split_path(rel)
                year_int = _as_int(str(path_year) if path_year is not None else None, None)
                if year_int is None:
                    year_int = _as_int(str(review_year) if review_year is not None else None, None)
                updates.append((campus, ministry, shoot, bucket, year_int, clip_id))
            conn.executemany(
                "UPDATE clips SET campus=?, ministry=?, shoot=?, year_bucket=?, year_int=? WHERE clip_id=?",
                updates,
            )
            index_cols = ["campus", "ministry", "year_int"] + [
                c for c in ("path_year", "review_year", "quality_stars", "relative_path", "duration_seconds", "inferred_recorded_date", "modified_at_utc")
                if c in cols
            ]
            for col in index_cols:
                conn.execute(f"CREATE INDEX IF NOT EXISTS idx_clips_{col} ON clips({col})")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS catalog_user_edits(
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  clip_id INTEGER NOT NULL,
                  field_name TEXT NOT NULL,
                  old_value TEXT,
                  new_value TEXT,
                  reason TEXT,
                  edited_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_edits_clip ON catalog_user_edits(clip_id)")
            conn.execute("ANALYZE")
            conn.commit()
        finally:
            conn.close()

    def refresh_if_changed(self) -> bool:
        sig = self.source_signature()
        if sig is None or sig == self.signature:
            return False
        return self.rebuild(sig)

    def note_source_written(self) -> None:
        """After a write-through edit, adopt the source's new signature so the
        next check doesn't trigger a full re-copy for our own change."""
        sig = self.source_signature()
        if sig is not None:
            self.signature = sig
            self._save_meta(sig)
        self.version += 1
        self._years_cache = None

    def watch(self) -> None:
        while True:
            time.sleep(MIRROR_CHECK_SECS)
            try:
                if self.loading:
                    continue
                if not self.ready:
                    self.ensure()
                else:
                    self.refresh_if_changed()
            except Exception as exc:  # never let the watcher die
                self.last_error = str(exc)

    # -- cached aggregates ----------------------------------------------

    def years(self) -> List[Dict[str, Any]]:
        cached = self._years_cache
        if cached is not None and cached[0] == self.version:
            return cached[1]
        with self.borrow() as conn:
            data = _year_coverage(conn)
        self._years_cache = (self.version, data)
        return data

    def status(self) -> Dict[str, Any]:
        return {
            "ready": self.ready,
            "loading": self.loading,
            "source_reachable": self.source_reachable,
            "refreshed_at": self.refreshed_at,
            "mirror_path": str(MIRROR_PATH),
            "last_error": self.last_error,
            "version": self.version,
        }


MIRROR = Mirror()


# --------------------------------------------------------------------------
# HTTP plumbing
# --------------------------------------------------------------------------


def _cors(handler: BaseHTTPRequestHandler) -> None:
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Referrer-Policy", "no-referrer")


def _send_json(handler: BaseHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    body = json.dumps(payload, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    _cors(handler)
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(body)


def _send_error(handler: BaseHTTPRequestHandler, status: int, code: str, message: str) -> None:
    _send_json(handler, {"ok": False, "error": {"code": code, "message": message}}, status)


def _send_bytes(handler: BaseHTTPRequestHandler, data: bytes, content_type: str, status: int = 200,
                cache: str = "no-store", extra: Optional[Dict[str, str]] = None) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", cache)
    for k, v in (extra or {}).items():
        handler.send_header(k, v)
    _cors(handler)
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(data)


def _send_file(handler: BaseHTTPRequestHandler, target: Path, content_type: str,
               cache: str = "public, max-age=31536000, immutable") -> None:
    try:
        st = target.stat()
    except OSError:
        _send_error(handler, 404, "not_found", "file not found")
        return
    etag = f'"{st.st_size:x}-{int(st.st_mtime):x}"'
    if handler.headers.get("If-None-Match") == etag:
        handler.send_response(304)
        handler.send_header("ETag", etag)
        handler.send_header("Cache-Control", cache)
        handler.send_header("Content-Length", "0")
        _cors(handler)
        handler.end_headers()
        return
    try:
        with target.open("rb") as f:
            data = f.read()
    except OSError:
        _send_error(handler, 500, "media_serve_failed", "unable to read file")
        return
    _send_bytes(handler, data, content_type, cache=cache, extra={"ETag": etag})


def _parse_json_body(handler: BaseHTTPRequestHandler) -> Optional[Dict[str, Any]]:
    try:
        length = int(handler.headers.get("Content-Length", "0") or 0)
    except ValueError:
        handler.close_connection = True
        return None
    if not 0 < length <= 65536:
        handler.close_connection = True
        return None
    raw = handler.rfile.read(length)
    try:
        value = json.loads(raw.decode("utf-8"))
        return value if isinstance(value, dict) else None
    except Exception:
        return None


# --------------------------------------------------------------------------
# Queries
# --------------------------------------------------------------------------


def _query_one(conn: sqlite3.Connection, sql: str, params: Sequence[Any] = ()) -> Optional[sqlite3.Row]:
    return conn.execute(sql, params).fetchone()


def _query_all(conn: sqlite3.Connection, sql: str, params: Sequence[Any] = ()) -> List[sqlite3.Row]:
    return conn.execute(sql, params).fetchall()


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return _query_one(conn, "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", (name,)) is not None


HAS_USER_EDITS_EXPR = ", EXISTS(SELECT 1 FROM catalog_user_edits e WHERE e.clip_id = c.clip_id LIMIT 1) AS has_user_edits"


def _thumb_version(thumbnail_path: Optional[str]) -> str:
    if not thumbnail_path:
        return "g"
    return hashlib.sha1(str(thumbnail_path).encode("utf-8", errors="ignore")).hexdigest()[:8]


def _decorate(item: Dict[str, Any]) -> Dict[str, Any]:
    """Fields the UI needs on every row, computed once here."""
    stars = item.get("quality_stars")
    score = item.get("quality_score_raw") or 0
    try:
        item["rank_score"] = (int(stars or 0) * 20) + float(score)
    except (TypeError, ValueError):
        item["rank_score"] = 0
    cid = item.get("clip_id")
    tp = item.get("thumbnail_path")
    item["thumb_url"] = f"/media/thumb/{cid}.jpg?v={_thumb_version(tp)}" if tp else None
    item["frame_url"] = f"/media/frame/{cid}.jpg"
    return item


def _year_coverage(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    rows = _query_all(
        conn,
        """
        SELECT
          year_int AS year,
          COUNT(*) AS total_clips,
          SUM(CASE WHEN CAST(COALESCE(is_present,0) AS INTEGER) <> 0 THEN 1 ELSE 0 END) AS present_clips,
          SUM(CASE WHEN TRIM(COALESCE(thumbnail_path,'')) = '' THEN 1 ELSE 0 END) AS missing_thumbnails,
          SUM(CASE WHEN quality_stars >= 4 THEN 1 ELSE 0 END) AS strong_clips,
          SUM(CASE WHEN quality_stars <= 2 THEN 1 ELSE 0 END) AS weak_clips,
          SUM(CASE WHEN quality_stars IS NULL THEN 1 ELSE 0 END) AS unrated_clips,
          SUM(CASE WHEN COALESCE(review_status,'') = '' THEN 1 ELSE 0 END) AS unreviewed_clips,
          SUM(COALESCE(duration_seconds,0)) AS total_seconds
        FROM clips
        WHERE year_int IS NOT NULL
        GROUP BY year_int
        ORDER BY year_int DESC;
        """,
    )
    out: List[Dict[str, Any]] = []
    for row in rows:
        d = _to_dict(row)
        d["year"] = int(d["year"])
        total = int(d.get("total_clips") or 0)
        present = int(d.get("present_clips") or 0)
        weak = int(d.get("weak_clips") or 0)
        strong = int(d.get("strong_clips") or 0)
        unrated = int(d.get("unrated_clips") or 0)
        missing_thumb = int(d.get("missing_thumbnails") or 0)

        def pct(n: int) -> float:
            return round(n / total * 100, 2) if total else 0.0

        d["coverage"] = {
            "present_pct": pct(present),
            "missing_pct": pct(total - present),
            "ready_pct": pct(strong),
            "weak_pct": pct(weak),
            "unrated_pct": pct(unrated),
            "rated_pct": pct(total - unrated),
            "missing_thumb_pct": pct(missing_thumb),
        }
        d["needs_work"] = missing_thumb + int(d.get("unreviewed_clips") or 0)
        out.append(d)
    return out


def _folder_coverage(conn: sqlite3.Connection, year: Optional[int], include_missing_thumbnail: bool = True) -> List[Dict[str, Any]]:
    where = "WHERE year_int = ?" if year is not None else ""
    args: Tuple[Any, ...] = (year,) if year is not None else ()
    rows = _query_all(
        conn,
        f"""
        SELECT campus AS folder,
               COUNT(*) AS total,
               SUM(CASE WHEN CAST(COALESCE(is_present,0) AS INTEGER) <> 0 THEN 1 ELSE 0 END) AS present,
               SUM(CASE WHEN TRIM(COALESCE(thumbnail_path,'')) = '' THEN 1 ELSE 0 END) AS missing_thumbnail
        FROM clips {where}
        GROUP BY campus ORDER BY campus
        """,
        args,
    )
    out = []
    for r in rows:
        d = _to_dict(r)
        if not include_missing_thumbnail:
            d["missing_thumbnail"] = 0
        out.append(d)
    return out


STAR_MODES = {
    "all": "",
    "usable": "(c.quality_stars IS NULL OR c.quality_stars >= 3)",
    "rated": "c.quality_stars IS NOT NULL",
    "3plus": "c.quality_stars >= 3",
    "4plus": "c.quality_stars >= 4",
    "5": "c.quality_stars = 5",
    "unrated": "c.quality_stars IS NULL",
    "review": "(c.quality_stars IS NOT NULL AND c.quality_stars <= 2)",
}


def _resolution_bucket_expr(alias: str = "c") -> str:
    return (
        f"CASE WHEN {alias}.width IS NULL OR {alias}.height IS NULL THEN 'unknown' "
        f"WHEN {alias}.width >= 7000 THEN '8k' "
        f"WHEN {alias}.width >= 3800 THEN '4k' "
        f"WHEN {alias}.height >= 1050 THEN '1080p' "
        f"WHEN {alias}.height >= 700 THEN '720p' "
        "ELSE 'sd' END"
    )


def _format_filter_predicate(token: str, alias: str = "c") -> tuple[str, List[Any]] | None:
    value = (token or "").strip().lower()
    if not value:
        return None

    if value.startswith("res:"):
        bucket = value.split(":", 1)[1].strip()
        if bucket in {"8k", "4k", "1080p", "720p", "sd", "unknown"}:
            return f"({_resolution_bucket_expr(alias)} = ?)", [bucket]
        return None

    if value.startswith("codec:"):
        codec = value.split(":", 1)[1].strip()
        if not codec:
            return None
        return f"(LOWER(COALESCE({alias}.video_codec,'')) = ?)", [codec]

    if value.startswith("ext:"):
        ext = value.split(":", 1)[1].strip().lstrip(".")
        if not ext:
            return None
        return f"(LOWER(LTRIM(COALESCE({alias}.extension,''), '.')) = ?)", [ext]

    return None


def _build_clip_filters(params: Dict[str, str], skip: Sequence[str] = ()) -> Tuple[str, List[Any]]:
    """WHERE clause + args. `skip` names filter families to leave out, which is
    how facet counts are computed 'as if this filter were not applied'."""
    clauses: List[str] = []
    args: List[Any] = []
    skipped = set(skip)

    if "year" not in skipped:
        if (year := _as_int(params.get("year"), None)) is not None:
            clauses.append("c.year_int = ?")
            args.append(year)
        years = [y for y in (_as_int(v, None) for v in _csv_list(params.get("years"))) if y is not None]
        if years:
            clauses.append(f"c.year_int IN ({','.join('?' * len(years))})")
            args.extend(years)
        if params.get("path_year"):
            clauses.append("CAST(c.path_year AS INTEGER)=?")
            args.append(_as_int(params["path_year"], 0))
        if params.get("review_year"):
            clauses.append("CAST(c.review_year AS INTEGER)=?")
            args.append(_as_int(params["review_year"], 0))

    if "campus" not in skipped:
        inc = _csv_list(params.get("campus"))
        exc = _csv_list(params.get("campus_not"))
        if inc:
            clauses.append(f"c.campus IN ({','.join('?' * len(inc))})")
            args.extend(inc)
        if exc:
            clauses.append(f"COALESCE(c.campus,'') NOT IN ({','.join('?' * len(exc))})")
            args.extend(exc)

    if "ministry" not in skipped:
        inc = _csv_list(params.get("ministry"))
        exc = _csv_list(params.get("ministry_not"))
        if inc:
            clauses.append(f"c.ministry IN ({','.join('?' * len(inc))})")
            args.extend(inc)
        if exc:
            clauses.append(f"COALESCE(c.ministry,'') NOT IN ({','.join('?' * len(exc))})")
            args.extend(exc)

    if params.get("review_status"):
        clauses.append("COALESCE(c.review_status,'') = ?")
        args.append(params["review_status"].strip())

    for flag in ("is_present", "is_proxy", "is_highlight"):
        val = _parse_bool(params.get(flag))
        if val is not None:
            clauses.append(f"CAST(COALESCE(c.{flag},0) AS INTEGER) = ?")
            args.append(1 if val else 0)

    if "format" not in skipped:
        inc_formats = [v for v in _csv_list(params.get("format")) if v]
        if inc_formats:
            parts: List[str] = []
            a: List[Any] = []
            for v in inc_formats:
                pred = _format_filter_predicate(v)
                if pred is None:
                    continue
                p, v_args = pred
                parts.append(p)
                a.extend(v_args)
            if parts:
                clauses.append(f"({' OR '.join(parts)})")
                args.extend(a)

        exc_formats = [v for v in _csv_list(params.get("format_not")) if v]
        if exc_formats:
            for v in exc_formats:
                pred = _format_filter_predicate(v)
                if pred is None:
                    continue
                p, v_args = pred
                clauses.append(f"NOT {p}")
                args.extend(v_args)

    if _parse_bool(params.get("needs_thumbnail")):
        clauses.append("TRIM(COALESCE(c.thumbnail_path,'')) = ''")

    if _parse_bool(params.get("has_user_edits")):
        clauses.append("EXISTS(SELECT 1 FROM catalog_user_edits e WHERE e.clip_id = c.clip_id)")

    if "stars" not in skipped:
        mode = (params.get("stars") or "").strip().lower()
        unrated = _parse_bool(params.get("unrated"))
        if mode in STAR_MODES:
            if STAR_MODES[mode]:
                clauses.append(STAR_MODES[mode])
        elif unrated is True:
            clauses.append("c.quality_stars IS NULL")
        else:
            # Legacy min/max. A minimum EXCLUDES unrated clips by design: "4 stars
            # and up" must not return unscored footage. unrated=0 forces rated-only.
            if unrated is False:
                clauses.append("c.quality_stars IS NOT NULL")
            if (min_stars := _as_int(params.get("quality_stars_min"), None)) is not None:
                clauses.append("c.quality_stars >= ?")
                args.append(min_stars)
            if (max_stars := _as_int(params.get("quality_stars_max"), None)) is not None:
                clauses.append("c.quality_stars <= ?")
                args.append(max_stars)

    ext = [e.lower().lstrip(".") for e in _csv_list(params.get("ext"))]
    if ext:
        clauses.append(f"LOWER(LTRIM(COALESCE(c.extension,''),'.')) IN ({','.join('?' * len(ext))})")
        args.extend(ext)

    if (min_dur := _as_float(params.get("min_seconds"), -1, -1, 1e9)) >= 0:
        clauses.append("COALESCE(c.duration_seconds,0) >= ?")
        args.append(min_dur)
    if (max_dur := _as_float(params.get("max_seconds"), -1, -1, 1e9)) >= 0:
        clauses.append("COALESCE(c.duration_seconds,0) <= ?")
        args.append(max_dur)

    ids = [i for i in (_as_int(v, None) for v in _csv_list(params.get("ids"))) if i is not None]
    if params.get("bin"):
        b = _get_bin(params["bin"])
        ids = _clean_ids(b.get("clip_ids")) if b else []
    if params.get("ids") or params.get("bin"):
        if not ids:
            clauses.append("0")
        else:
            clauses.append(f"c.clip_id IN ({','.join('?' * len(ids))})")
            args.extend(ids)

    if "q" not in skipped and params.get("q"):
        has_terms = "search_terms" in MIRROR.columns
        for tok in params["q"].strip().split():
            like = f"%{tok}%"
            if has_terms:
                clauses.append("(c.search_terms LIKE ? OR c.relative_path LIKE ? OR COALESCE(c.quality_reasons,'') LIKE ?)")
            else:
                clauses.append("(c.relative_path LIKE ? OR c.filename LIKE ? OR COALESCE(c.quality_reasons,'') LIKE ?)")
            args.extend([like, like, like])

    return (" AND ".join(clauses), args)


def _order_sql(sort: str) -> str:
    if sort in {"quality", "quality_desc", "best", "stars", "stars_desc"}:
        return (
            "COALESCE(c.quality_stars, -1) DESC, COALESCE(c.quality_score_raw, -1) DESC,"
            " COALESCE(c.quality_confidence, -1) DESC, c.clip_id ASC"
        )
    if sort in {"quality_asc", "worst", "stars_asc"}:
        return (
            "COALESCE(c.quality_stars, 9999) ASC, COALESCE(c.quality_score_raw, 9999) ASC,"
            " COALESCE(c.quality_confidence, 9999) ASC, c.clip_id ASC"
        )
    if sort in {"newest", "recent", "date", "date_desc"}:
        return (
            "COALESCE(c.year_int, 0) DESC, COALESCE(c.inferred_recorded_date,'') DESC,"
            " COALESCE(c.modified_at_utc,'') DESC, c.clip_id ASC"
        )
    if sort in {"oldest", "date_asc"}:
        return "COALESCE(c.year_int, 9999) ASC, COALESCE(c.inferred_recorded_date,'9999') ASC, c.clip_id ASC"
    if sort in {"longest", "duration", "length_desc"}:
        return "COALESCE(c.duration_seconds,0) DESC, c.clip_id ASC"
    if sort in {"shortest", "length_asc"}:
        return "COALESCE(c.duration_seconds,0) ASC, c.clip_id ASC"
    if sort == "res_desc":
        return "(c.width IS NULL OR c.height IS NULL) ASC, (COALESCE(c.width,0) * COALESCE(c.height,0)) DESC, c.clip_id ASC"
    if sort == "res_asc":
        return "(c.width IS NULL OR c.height IS NULL) ASC, (COALESCE(c.width,0) * COALESCE(c.height,0)) ASC, c.clip_id ASC"
    if sort == "fps_desc":
        return "(c.fps IS NULL) ASC, COALESCE(c.fps, 0) DESC, c.clip_id ASC"
    if sort == "fps_asc":
        return "(c.fps IS NULL) ASC, COALESCE(c.fps, 0) ASC, c.clip_id ASC"
    if sort == "codec_desc":
        return "(LOWER(LTRIM(COALESCE(c.video_codec,''), '.')) = '') ASC, LOWER(LTRIM(COALESCE(c.video_codec,''), '.')) DESC, LOWER(LTRIM(COALESCE(c.extension,''), '.')) DESC, c.clip_id ASC"
    if sort == "codec_asc":
        return "(LOWER(LTRIM(COALESCE(c.video_codec,''), '.')) = '') ASC, LOWER(LTRIM(COALESCE(c.video_codec,''), '.')) ASC, LOWER(LTRIM(COALESCE(c.extension,''), '.')) ASC, c.clip_id ASC"
    if sort == "size_desc":
        return "(c.size_bytes IS NULL) ASC, COALESCE(c.size_bytes, 0) DESC, c.clip_id ASC"
    if sort == "size_asc":
        return "(c.size_bytes IS NULL) ASC, COALESCE(c.size_bytes, 0) ASC, c.clip_id ASC"
    if sort == "name":
        return "COALESCE(c.filename,'') COLLATE NOCASE ASC, c.clip_id ASC"
    return "COALESCE(c.relative_path,'') COLLATE NOCASE ASC, c.clip_id ASC"


def _fetch_clips_by_ids(conn: sqlite3.Connection, ids: Sequence[int]) -> List[sqlite3.Row]:
    if not ids:
        return []
    placeholders = ", ".join(["?"] * len(ids))
    order_cases = " ".join([f"WHEN ? THEN {idx}" for idx in range(len(ids))])
    sql = f"""
        SELECT c.*{HAS_USER_EDITS_EXPR}
        FROM clips c
        WHERE c.clip_id IN ({placeholders})
        ORDER BY CASE c.clip_id {order_cases} ELSE 999999999 END
    """
    return _query_all(conn, sql, (*ids, *ids))


def _list_clips(conn: sqlite3.Connection, params: Dict[str, str]) -> Dict[str, Any]:
    where_sql, args = _build_clip_filters(params)
    where = f"WHERE {where_sql}" if where_sql else ""
    sort = (params.get("sort") or "quality_desc").lower()
    random_sort = sort == "random"
    seed = _as_int(params.get("seed"), 0) or 0

    page = max(_as_int(params.get("page"), 1) or 1, 1)
    page_size = min(max(_as_int(params.get("page_size"), DEFAULT_PAGE_SIZE) or DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    offset = (page - 1) * page_size

    t0 = time.perf_counter()
    total = int(_query_one(conn, f"SELECT COUNT(1) AS total FROM clips c {where}", args)["total"] or 0)
    total_pages = ceil(total / page_size) if total else 0

    if random_sort:
        id_rows = _query_all(conn, f"SELECT c.clip_id FROM clips c {where}", args)
        all_ids = [int(r["clip_id"]) for r in id_rows]
        rng = random.Random(seed)
        rng.shuffle(all_ids)
        rows = _fetch_clips_by_ids(conn, all_ids[offset: offset + page_size])
    elif params.get("bin") and sort == "bin":
        # A bin keeps the order the user built it in.
        b = _get_bin(params["bin"]) or {}
        ids = _clean_ids(b.get("clip_ids"))
        rows = _fetch_clips_by_ids(conn, ids[offset: offset + page_size])
    else:
        rows = _query_all(
            conn,
            f"SELECT c.*{HAS_USER_EDITS_EXPR} FROM clips c {where} ORDER BY {_order_sql(sort)} LIMIT ? OFFSET ?",
            (*args, page_size, offset),
        )
    items = [_decorate(_to_dict(r)) for r in rows]
    THUMB_WARMER.enqueue([(i["clip_id"], i.get("thumbnail_path")) for i in items if i.get("thumbnail_path")])

    return {
        "ok": True,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "sort": sort,
        "seed": seed if random_sort else None,
        "query_ms": round((time.perf_counter() - t0) * 1000, 1),
        "items": items,
    }


def _facets(conn: sqlite3.Connection, params: Dict[str, str]) -> Dict[str, Any]:
    def where_for(skip: Sequence[str], extra: str = "") -> Tuple[str, List[Any]]:
        w, a = _build_clip_filters(params, skip=skip)
        parts = [p for p in (w, extra) if p]
        return (f"WHERE {' AND '.join(parts)}" if parts else ""), a

    w, a = where_for(["campus", "ministry"])
    campuses = [
        {"value": r["campus"], "count": int(r["n"])}
        for r in _query_all(conn, f"SELECT c.campus, COUNT(*) AS n FROM clips c {w} GROUP BY c.campus ORDER BY n DESC", a)
        if r["campus"]
    ]
    w, a = where_for(["ministry"], "c.ministry IS NOT NULL")
    ministries = [
        {"value": r["ministry"], "campus": r["campus"], "count": int(r["n"])}
        for r in _query_all(conn, f"SELECT c.campus, c.ministry, COUNT(*) AS n FROM clips c {w} GROUP BY c.campus, c.ministry ORDER BY n DESC", a)
    ]
    w, a = where_for(["stars"])
    star_rows = _query_all(conn, f"SELECT c.quality_stars AS s, COUNT(*) AS n FROM clips c {w} GROUP BY c.quality_stars", a)
    by_star = {("unrated" if r["s"] is None else str(int(r["s"]))): int(r["n"]) for r in star_rows}
    g = lambda k: by_star.get(k, 0)  # noqa: E731
    rated = g("1") + g("2") + g("3") + g("4") + g("5")
    stars = {
        "5": g("5"), "4": g("4"), "3": g("3"), "2": g("2"), "1": g("1"),
        "unrated": g("unrated"), "rated": rated,
        "usable": g("5") + g("4") + g("3") + g("unrated"),
        "3plus": g("5") + g("4") + g("3"),
        "4plus": g("5") + g("4"),
        "review": g("2") + g("1"),
        "all": rated + g("unrated"),
    }
    w, a = where_for(["year"], "c.year_int IS NOT NULL")
    years = [
        {"year": int(r["y"]), "count": int(r["n"])}
        for r in _query_all(conn, f"SELECT c.year_int AS y, COUNT(*) AS n FROM clips c {w} GROUP BY c.year_int ORDER BY y DESC", a)
    ]

    w, a = where_for(["format"])
    format_rows = _query_all(
        conn,
        f"SELECT {_resolution_bucket_expr('c')} AS bucket, COUNT(*) AS n FROM clips c {w} GROUP BY bucket ORDER BY n DESC",
        a,
    )
    format_bucket = [
        {"kind": "res", "value": r["bucket"], "count": int(r["n"])}
        for r in format_rows
        if r["bucket"] not in (None, "")
    ]

    w, a = where_for(["format"])
    codec_rows = _query_all(
        conn,
        "SELECT LOWER(TRIM(COALESCE(video_codec,''))) AS codec, COUNT(*) AS n FROM clips c {} GROUP BY codec ORDER BY n DESC".format(w),
        a,
    )
    format_codec = [{"kind": "codec", "value": r["codec"], "count": int(r["n"])} for r in codec_rows if (r["codec"] or "").strip()]

    w, a = where_for(["format"])
    ext_rows = _query_all(
        conn,
        "SELECT LOWER(LTRIM(COALESCE(extension,''), '.')) AS ext, COUNT(*) AS n FROM clips c {} GROUP BY ext ORDER BY n DESC".format(w),
        a,
    )
    format_ext = [{"kind": "ext", "value": r["ext"], "count": int(r["n"])} for r in ext_rows if (r["ext"] or "").strip()]

    w, a = where_for([])
    total = int(_query_one(conn, f"SELECT COUNT(*) AS n FROM clips c {w}", a)["n"])
    return {
        "ok": True,
        "total": total,
        "campuses": campuses,
        "ministries": ministries,
        "stars": stars,
        "years": years,
        "formats": format_bucket + format_codec + format_ext,
    }


def _meta_enums(conn: sqlite3.Connection) -> Dict[str, Any]:
    review_statuses = [
        r["value"]
        for r in _query_all(conn, "SELECT DISTINCT COALESCE(review_status,'') AS value FROM clips WHERE TRIM(COALESCE(review_status,'')) <> '' ORDER BY value")
    ]
    quality_stars = [r["value"] for r in _query_all(conn, "SELECT DISTINCT quality_stars AS value FROM clips WHERE quality_stars IS NOT NULL ORDER BY value")]
    reason_rows = _query_all(
        conn,
        "SELECT TRIM(quality_reasons) AS value, COUNT(*) AS count FROM clips WHERE quality_reasons IS NOT NULL AND TRIM(quality_reasons) <> '' GROUP BY quality_reasons ORDER BY count DESC, value LIMIT 40",
    )
    confidence = _query_one(conn, "SELECT COUNT(quality_confidence) AS n, MIN(quality_confidence) AS mn, MAX(quality_confidence) AS mx FROM clips")
    years = [r["year"] for r in _query_all(conn, "SELECT DISTINCT year_int AS year FROM clips WHERE year_int IS NOT NULL ORDER BY year DESC")]
    campuses = [r["campus"] for r in _query_all(conn, "SELECT DISTINCT campus FROM clips WHERE campus IS NOT NULL ORDER BY campus")]
    exts = [r["e"] for r in _query_all(conn, "SELECT DISTINCT LOWER(extension) AS e FROM clips WHERE extension IS NOT NULL ORDER BY e")]
    codecs = [r["c"] for r in _query_all(conn, "SELECT DISTINCT LOWER(COALESCE(video_codec,'')) AS c FROM clips WHERE TRIM(COALESCE(video_codec,'')) <> '' ORDER BY c")]
    return {
        "review_status": review_statuses,
        "quality_stars": quality_stars,
        "quality_confidence": {"count": int(confidence["n"] or 0) if confidence else 0, "min": confidence["mn"] if confidence else None, "max": confidence["mx"] if confidence else None},
        "quality_reason_top": [{"value": r["value"], "count": int(r["count"])} for r in reason_rows],
        "year_values": years,
        "campuses": campuses,
        "extensions": exts,
        "codecs": codecs,
        "columns": MIRROR.columns,
        "current_year": datetime.now().year,
    }


# --------------------------------------------------------------------------
# Edits: write-through to the source, then the mirror
# --------------------------------------------------------------------------


def _ensure_edit_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS catalog_user_edits(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          clip_id INTEGER NOT NULL,
          field_name TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          reason TEXT,
          edited_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )


def _apply_edit_to(conn: sqlite3.Connection, clip_id: int, updates: Dict[str, Any], reason: Optional[str]) -> None:
    clip = _query_one(conn, "SELECT * FROM clips WHERE clip_id = ?", (clip_id,))
    if clip is None:
        raise ValueError("clip not found")
    _ensure_edit_table(conn)
    set_sql: List[str] = []
    values: List[Any] = []
    for key, new_value in updates.items():
        if key not in ALLOWED_EDIT_FIELDS:
            continue
        old_value = clip[key]
        if key in {"is_present", "is_proxy", "is_highlight"}:
            parsed = _parse_bool(str(new_value))
            if parsed is not None:
                new_value = 1 if parsed else 0
        if key == "quality_stars" and new_value is not None and new_value != "":
            new_value = max(1, min(5, int(new_value)))
        if key == "quality_stars" and new_value == "":
            new_value = None
        conn.execute(
            "INSERT INTO catalog_user_edits (clip_id, field_name, old_value, new_value, reason) VALUES (?,?,?,?,?)",
            (clip_id, key, str(old_value) if old_value is not None else None, str(new_value) if new_value is not None else None, reason),
        )
        set_sql.append(f"{key} = ?")
        values.append(new_value)
    if not set_sql:
        raise ValueError("No valid editable fields provided")
    values.append(clip_id)
    conn.execute(f"UPDATE clips SET {', '.join(set_sql)} WHERE clip_id = ?", values)
    conn.commit()


def _apply_edit(clip_id: int, updates: Dict[str, Any], reason: Optional[str]) -> Dict[str, Any]:
    raise RuntimeError("Shared catalog rating edits are disabled. A metadata overlay is planned.")


def _edit_history(conn: sqlite3.Connection, clip_id: int) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "catalog_user_edits"):
        return []
    return [_to_dict(r) for r in _query_all(conn, "SELECT * FROM catalog_user_edits WHERE clip_id = ? ORDER BY id DESC LIMIT 50", (clip_id,))]


def _list_issues(conn: sqlite3.Connection, year: Optional[int], clip_id: Optional[int]) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "quality_issues"):
        return []
    where: List[str] = []
    args: List[Any] = []
    if year is not None:
        where.append("c.year_int = ?")
        args.append(year)
    if clip_id is not None:
        where.append("qi.clip_id = ?")
        args.append(clip_id)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return [_to_dict(r) for r in _query_all(conn, f"SELECT qi.* FROM quality_issues qi JOIN clips c ON c.clip_id = qi.clip_id {clause} ORDER BY qi.id DESC LIMIT 300", args)]


def _frame_metrics_sample(conn: sqlite3.Connection, clip_id: int) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "frame_metrics"):
        return []
    return [_to_dict(r) for r in _query_all(conn, "SELECT * FROM frame_metrics WHERE clip_id = ? ORDER BY frame_index LIMIT 120", (clip_id,))]


def _run_history(conn: sqlite3.Connection, limit: int = 100) -> List[Dict[str, Any]]:
    if not _table_exists(conn, "catalog_runs"):
        return []
    return [_to_dict(r) for r in _query_all(conn, "SELECT * FROM catalog_runs ORDER BY run_id DESC LIMIT ?", (limit,))]


def _validate_csv(year: int) -> Dict[str, Any]:
    if not CSV_TEMPLATE:
        return {"ok": False, "error": {"code": "setup_required", "message": "Complete setup first"}}
    path = Path(CSV_TEMPLATE.format(year=year))
    if not path.exists():
        return {"ok": False, "error": {"code": "csv_missing", "message": f"CSV missing: {path}"}}
    return {"ok": True, "csv_path": str(path)}


# --------------------------------------------------------------------------
# Media: thumbnails, frame grabs, previews
# --------------------------------------------------------------------------


def _ffmpeg() -> Optional[str]:
    if APP_SETTINGS.preview_policy == "existing":
        return None
    return shutil.which("ffmpeg")


def _thumb_local_path(clip_id: int) -> Path:
    return THUMB_DIR / f"{clip_id}.jpg"


def _thumb_missing_marker(clip_id: int) -> Path:
    return THUMB_DIR / f"{clip_id}.missing"


def _copy_catalog_thumb(clip_id: int, thumbnail_path: str) -> Optional[Path]:
    """Copy the pipeline's thumbnail from the share into the local cache."""
    out = _thumb_local_path(clip_id)
    if out.exists():
        return out
    source = _resolve_path(thumbnail_path)
    if not source:
        return None
    lock = _get_lock(_THUMB_LOCKS, out.name)
    with lock:
        if out.exists():
            return out
        THUMB_DIR.mkdir(parents=True, exist_ok=True)
        try:
            tmp = out.with_suffix(".part")
            shutil.copyfile(source, tmp)
            os.replace(tmp, out)
            return out
        except Exception:
            return None


def _grab_frame(clip_id: int, source: str, duration: Optional[float]) -> Optional[Path]:
    """ffmpeg a single frame out of the source clip into the thumb cache."""
    out = _thumb_local_path(clip_id)
    if out.exists():
        return out
    marker = _thumb_missing_marker(clip_id)
    if marker.exists() and (time.time() - marker.stat().st_mtime) < 6 * 3600:
        return None
    ffmpeg = _ffmpeg()
    if not ffmpeg:
        return None
    lock = _get_lock(_THUMB_LOCKS, out.name)
    with lock:
        if out.exists():
            return out
        THUMB_DIR.mkdir(parents=True, exist_ok=True)
        # A frame ~10% in avoids slates and fade-ups without seeking far into the file.
        seek = 0.0
        try:
            dur = float(duration or 0)
        except (TypeError, ValueError):
            dur = 0.0
        if dur > 4:
            seek = min(max(dur * 0.1, 1.0), 10.0)
        tmp = out.with_name(f"{clip_id}.part.jpg")
        cmd = [
            ffmpeg, "-y", "-loglevel", "error", "-nostdin",
            "-ss", f"{seek:.2f}", "-i", source,
            "-frames:v", "1", "-vf", f"scale={THUMB_WIDTH}:-2",
            "-q:v", "4", str(tmp),
        ]
        with _FFMPEG_SLOTS:
            ok = False
            for attempt_seek in ([seek, 0.0] if seek > 0 else [0.0]):
                cmd[cmd.index("-ss") + 1] = f"{attempt_seek:.2f}"
                try:
                    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=FRAME_GRAB_TIMEOUT)
                except Exception:
                    ok = False
                else:
                    ok = tmp.exists() and tmp.stat().st_size > 0
                if ok:
                    break
                try:
                    tmp.unlink()
                except OSError:
                    pass
        if not ok:
            marker.touch()
            return None
        os.replace(tmp, out)
        return out


class ThumbWarmer:
    """Background copier: catalog thumbnails for the rows the UI just listed
    land in the local cache before the browser asks for them."""

    def __init__(self, workers: int = 2) -> None:
        self.q: "queue.Queue[Tuple[int, str]]" = queue.Queue()
        self.seen: set = set()
        self.lock = threading.Lock()
        for _ in range(workers):
            threading.Thread(target=self._run, daemon=True).start()

    def enqueue(self, items: Sequence[Tuple[int, Optional[str]]]) -> None:
        with self.lock:
            for clip_id, tp in items:
                if not tp or clip_id in self.seen:
                    continue
                self.seen.add(clip_id)
                if _thumb_local_path(clip_id).exists():
                    continue
                self.q.put((clip_id, tp))

    def _run(self) -> None:
        while True:
            clip_id, tp = self.q.get()
            try:
                _copy_catalog_thumb(clip_id, tp)
            except Exception:
                pass


THUMB_WARMER = ThumbWarmer()


def _clip_preview_path(clip_id: int, duration: float, fps: int, width: int) -> Path:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    return PREVIEW_DIR / f"preview_{clip_id}_{int(duration * 10)}_{fps}_{width}.mp4"


def _ensure_preview(source: str, clip_id: int, duration: float, fps: int, width: int) -> Tuple[Optional[Path], bool, float, Optional[str]]:
    if APP_SETTINGS.preview_policy != "on_demand":
        return None, False, 0.0, "Motion preview unavailable under the selected preview policy"
    ffmpeg = _ffmpeg()
    if not ffmpeg:
        return None, False, 0.0, "ffmpeg_not_installed"
    out_path = _clip_preview_path(clip_id, duration, fps, width)
    if out_path.exists():
        return out_path, True, 0.0, None
    lock = _get_lock(_PREVIEW_LOCKS, out_path.name)
    start = time.perf_counter()
    with lock:
        if out_path.exists():
            return out_path, True, round((time.perf_counter() - start) * 1000.0, 2), None
        tmp = out_path.with_name(out_path.stem + ".part.mp4")
        cmd = [
            ffmpeg, "-y", "-loglevel", "error", "-nostdin",
            "-ss", "0", "-i", source, "-t", str(duration), "-an",
            "-vf", f"fps={fps},scale={width}:-2",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-tune", "fastdecode",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-threads", "2",
            str(tmp),
        ]
        with _FFMPEG_SLOTS:
            try:
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=PREVIEW_TIMEOUT)
            except Exception:
                try:
                    tmp.unlink()
                except OSError:
                    pass
                return None, False, round((time.perf_counter() - start) * 1000.0, 2), "preview_generation_failed"
        if not tmp.exists():
            return None, False, round((time.perf_counter() - start) * 1000.0, 2), "preview_generation_failed"
        os.replace(tmp, out_path)
    return out_path, False, round((time.perf_counter() - start) * 1000.0, 2), None


# --------------------------------------------------------------------------
# State: preferences + saved bins
# --------------------------------------------------------------------------


def _load_state() -> Dict[str, Any]:
    with _STATE_LOCK:
        if not STATE_PATH.exists():
            return {}
        try:
            with STATE_PATH.open("r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            return {}


def _write_state(state: Dict[str, Any]) -> None:
    with _STATE_LOCK:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE_PATH.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, default=str)
        os.replace(tmp, STATE_PATH)


def _save_state(payload: Dict[str, Any]) -> None:
    with _STATE_LOCK:
        state = _load_state()
        state.update(payload)
        _write_state(state)


def _bins() -> List[Dict[str, Any]]:
    bins = _load_state().get("bins")
    return [b for b in bins if isinstance(b, dict)] if isinstance(bins, list) else []


def _get_bin(bin_id: str) -> Optional[Dict[str, Any]]:
    for b in _bins():
        if str(b.get("id")) == str(bin_id):
            return b
    return None


def _save_bins(bins: List[Dict[str, Any]]) -> None:
    _save_state({"bins": bins})


def _clean_ids(raw: Any) -> List[int]:
    out: List[int] = []
    seen = set()
    if not isinstance(raw, list):
        return out
    for v in raw:
        try:
            i = int(v)
        except (TypeError, ValueError):
            continue
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def _bin_summary(b: Dict[str, Any]) -> Dict[str, Any]:
    ids = _clean_ids(b.get("clip_ids"))
    return {
        "id": b.get("id"),
        "name": b.get("name") or "Untitled bin",
        "clip_ids": ids,
        "count": len(ids),
        "created_at": b.get("created_at"),
        "updated_at": b.get("updated_at"),
        "cover_ids": ids[:4],
    }


# --------------------------------------------------------------------------
# Premiere handoff
# --------------------------------------------------------------------------


def _call_bridge(file_paths: List[str], project: Optional[str], sequence: Optional[str],
                 make_bin: bool = False, bin_name: Optional[str] = None) -> Dict[str, Any]:
    if not PREMIERE_BRIDGE_URL:
        return {"ok": False, "error": {"code": "bridge_not_configured", "message": "BROLL_PREMIERE_BRIDGE_URL is not set"}, "status": 503}
    payload = {"command": "import_media", "project": project, "sequence": sequence, "files": file_paths, "ts": _now(), "make_bin": bool(make_bin), "bin_name": bin_name}
    req = urllib.request.Request(PREMIERE_BRIDGE_URL, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            body = response.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except Exception:
                parsed = {"raw": body}
            status = response.status
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        try:
            parsed = json.loads(detail)
        except Exception:
            parsed = {"raw": detail}
        return {"ok": False, "error": {"code": "bridge_http_error", "message": f"HTTP {exc.code}"}, "status": exc.code, "response": parsed}
    except urllib.error.URLError as exc:
        return {"ok": False, "error": {"code": "bridge_connection_failed", "message": str(exc)}, "status": 503}
    except Exception as exc:
        return {"ok": False, "error": {"code": "bridge_error", "message": str(exc)}, "status": 500}
    return {"ok": 200 <= status < 300, "status": status, "response": parsed}


def _file_url(path: str) -> str:
    """Premiere-importable file URL. UNC -> file://server/share/..., drive -> file://localhost/C:/..."""
    p = path.replace("\\", "/")
    if p.startswith("//"):
        return "file:" + quote(p, safe="/:")
    return "file://localhost/" + quote(p.lstrip("/"), safe="/:")


def _premiere_xml(name: str, clips: List[Dict[str, Any]]) -> str:
    """Minimal FCP7 / xmeml v4 bin that Premiere's File > Import understands."""
    children = []
    for idx, c in enumerate(clips, 1):
        path = c.get("absolute_path") or _resolve_path(c.get("relative_path")) or ""
        try:
            fps = float(c.get("fps") or 0) or 29.97
        except (TypeError, ValueError):
            fps = 29.97
        ntsc = abs(fps - round(fps)) > 0.01
        timebase = int(round(fps))
        try:
            duration = int(round(float(c.get("duration_seconds") or 0) * fps))
        except (TypeError, ValueError):
            duration = 0
        rate = f"<rate><timebase>{timebase}</timebase><ntsc>{'TRUE' if ntsc else 'FALSE'}</ntsc></rate>"
        fname = xml_escape(str(c.get("filename") or Path(path).name))
        w = int(c.get("width") or 0)
        h = int(c.get("height") or 0)
        video = f"<video><samplecharacteristics>{rate}<width>{w}</width><height>{h}</height></samplecharacteristics></video>" if w and h else "<video/>"
        audio = "<audio><channelcount>2</channelcount></audio>" if c.get("has_audio") else ""
        children.append(
            f"<clip id=\"clip-{idx}\"><name>{fname}</name><duration>{duration}</duration>{rate}"
            f"<in>-1</in><out>-1</out>"
            f"<file id=\"file-{idx}\"><name>{fname}</name><pathurl>{xml_escape(_file_url(path))}</pathurl>{rate}"
            f"<duration>{duration}</duration><media>{video}{audio}</media></file></clip>"
        )
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE xmeml>\n<xmeml version=\"4\">"
        f"<bin><name>{xml_escape(name)}</name><children>{''.join(children)}</children></bin></xmeml>"
    )


# --------------------------------------------------------------------------
# Handler
# --------------------------------------------------------------------------


class CatalogHandler(BaseHTTPRequestHandler):
    server_version = "BrollCatalogBackend/3.0"
    protocol_version = "HTTP/1.1"

    def _authorized(self):
        token = getattr(self.server, "runtime_token", None)
        if token is None:  # fixture servers; create_server always supplies a token
            return True
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        allowed_host = f"127.0.0.1:{self.server.server_port}"
        if host != allowed_host or (origin and origin != "http://" + allowed_host):
            self.close_connection = True
            _send_error(self, 403, "origin_rejected", "Open Vault from its local launch link")
            return False
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
            supplied = cookies["vault_session"].value if "vault_session" in cookies else ""
        except Exception:
            supplied = ""
        if not secrets.compare_digest(supplied, token):
            self.close_connection = True
            _send_error(self, 401, "session_required", "Reopen Vault to establish a local session")
            return False
        return True

    def log_message(self, fmt: str, *args: Any) -> None:  # quieter console
        if os.getenv("BROLL_HTTP_LOG"):
            super().log_message(fmt, *args)

    def do_OPTIONS(self) -> None:
        if not self._authorized():
            return
        self.send_response(204)
        _cors(self)
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _route(self) -> Tuple[str, Dict[str, str]]:
        parsed = urlparse(self.path)
        return unquote(parsed.path), {k: v[0] for k, v in parse_qs(parsed.query).items()}

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        path, params = self._route()
        if path.startswith("/session/") and getattr(self.server, "runtime_token", None):
            if (self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}" or
                    not secrets.compare_digest(path.removeprefix("/session/"), self.server.runtime_token)):
                return _send_error(self, 403, "session_rejected", "Invalid local launch link")
            self.send_response(303)
            self.send_header("Set-Cookie", f"vault_session={self.server.runtime_token}; HttpOnly; SameSite=Strict; Path=/")
            self.send_header("Location", "/")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if not self._authorized():
            return
        try:
            if path.startswith("/media/") or path.startswith("/api/"):
                return self._get_api(path, params)
            return self._get_static(path)
        except RuntimeError as exc:
            return _send_error(self, 503, "catalog_unavailable", str(exc))
        except sqlite3.Error as exc:
            return _send_error(self, 500, "db_error", str(exc))
        except (BrokenPipeError, ConnectionResetError):
            return None

    # -- static frontend --------------------------------------------------

    def _get_static(self, path: str) -> None:
        if not FRONTEND_DIST.exists():
            return _send_error(self, 404, "not_found", f"No built frontend at {FRONTEND_DIST}. Run `npm run build` in web/ or open the dev server.")
        rel = path.lstrip("/") or "index.html"
        root = FRONTEND_DIST.resolve()
        target = (root / rel).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            target = root / "index.html"
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        cache = "no-cache" if target.name == "index.html" else "public, max-age=31536000, immutable"
        return _send_file(self, target, ctype, cache=cache)

    # -- api --------------------------------------------------------------

    def _get_api(self, path: str, params: Dict[str, str]) -> None:
        if path == "/api/setup":
            return _send_json(self, SETTINGS_STORE.public())
        if path == "/api/updates":
            return _send_json(self, RELEASE_CHECKER.check(SETTINGS_STORE.load().check_updates))
        if path == "/api/health":
            db_ok = False
            rows = None
            if MIRROR.ready:
                with MIRROR.borrow() as conn:
                    db_ok = _table_exists(conn, "clips")
                    rows = int(_query_one(conn, "SELECT COUNT(*) AS n FROM clips")["n"]) if db_ok else 0
            return _send_json(self, {"ok": True, "db_ok": db_ok, "db_path": DB_PATH, "rows": rows, "ffmpeg": bool(_ffmpeg()), "bridge_configured": bool(PREMIERE_BRIDGE_URL), "mirror": MIRROR.status(), "time": _now()})

        if not MIRROR.ready:
            msg = MIRROR.last_error or ("Copying the catalog to a local mirror, first start can take a minute" if MIRROR.loading else "catalog mirror is still loading")
            return _send_error(self, 503, "catalog_loading", msg)

        if path == "/api/years":
            years = MIRROR.years()
            current = datetime.now().year
            if not _parse_bool(params.get("include_future")):
                years = [y for y in years if y["year"] <= current]
            return _send_json(self, {"ok": True, "years": years, "current_year": current})

        if path == "/api/folders":
            year = _as_int(params.get("year"), None)
            include_missing = _parse_bool(params.get("include_missing_thumb"))
            with MIRROR.borrow() as conn:
                return _send_json(self, {"ok": True, "year": year, "folders": _folder_coverage(conn, year, True if include_missing is None else include_missing)})

        if path == "/api/meta/enums":
            with MIRROR.borrow() as conn:
                return _send_json(self, {"ok": True, "meta": _meta_enums(conn), "generated_at": _now()})

        if path == "/api/clips":
            with MIRROR.borrow() as conn:
                return _send_json(self, _list_clips(conn, params))

        if path == "/api/facets":
            with MIRROR.borrow() as conn:
                return _send_json(self, _facets(conn, params))

        if path == "/api/issues":
            with MIRROR.borrow() as conn:
                return _send_json(self, {"ok": True, "items": _list_issues(conn, _as_int(params.get("year"), None), None)})

        if path == "/api/runs":
            with MIRROR.borrow() as conn:
                return _send_json(self, {"ok": True, "runs": _run_history(conn, _as_int(params.get("limit"), 100) or 100)})

        if path == "/api/preferences":
            state = _load_state()
            state.pop("bins", None)
            return _send_json(self, {"ok": True, "state": state})

        if path == "/api/bins":
            return _send_json(self, {"ok": True, "bins": [_bin_summary(b) for b in _bins()]})

        m = re.match(r"^/api/bins/([0-9a-zA-Z_-]+)(?:/(export\.xml|paths\.txt))?$", path)
        if m:
            b = _get_bin(m.group(1))
            if b is None:
                return _send_error(self, 404, "bin_not_found", "bin not found")
            ids = _clean_ids(b.get("clip_ids"))
            with MIRROR.borrow() as conn:
                rows = [_decorate(_to_dict(r)) for r in _fetch_clips_by_ids(conn, ids)]
            kind = m.group(2)
            safe = _sanitize_name(str(b.get("name") or "bin"), "bin")
            if kind == "export.xml":
                xml = _premiere_xml(str(b.get("name") or "B-roll bin"), rows).encode("utf-8")
                return _send_bytes(self, xml, "application/xml; charset=utf-8", extra={"Content-Disposition": f'attachment; filename="{safe}.xml"'})
            if kind == "paths.txt":
                lines = [str(r.get("absolute_path") or _resolve_path(r.get("relative_path")) or "") for r in rows]
                body = ("\r\n".join(lines) + "\r\n").encode("utf-8")
                return _send_bytes(self, body, "text/plain; charset=utf-8", extra={"Content-Disposition": f'attachment; filename="{safe}.txt"'})
            return _send_json(self, {"ok": True, "bin": _bin_summary(b), "items": rows})

        if path == "/api/validate-csv":
            year = _as_int(params.get("year"), None)
            if year is None:
                return _send_error(self, 400, "missing_year", "year is required")
            return _send_json(self, _validate_csv(year))

        m = re.match(r"^/api/years/(\d+)/gaps$", path)
        if m:
            year = int(m.group(1))
            with MIRROR.borrow() as conn:
                return _send_json(self, {"ok": True, "year": year, "folder_gaps": _folder_coverage(conn, year)})

        m = re.match(r"^/api/clips/(\d+)$", path)
        if m:
            clip_id = int(m.group(1))
            with MIRROR.borrow() as conn:
                row = _query_one(conn, f"SELECT c.*{HAS_USER_EDITS_EXPR} FROM clips c WHERE c.clip_id = ?", (clip_id,))
                if row is None:
                    return _send_error(self, 404, "clip_not_found", "clip not found")
                payload = _decorate(_to_dict(row))
                payload["quality_issues"] = _list_issues(conn, None, clip_id)
                payload["frame_metrics_sample"] = _frame_metrics_sample(conn, clip_id) if _parse_bool(params.get("metrics")) else []
                payload["edit_history"] = _edit_history(conn, clip_id)
            return _send_json(self, {"ok": True, "clip": payload})

        m = re.match(r"^/api/clips/(\d+)/preview$", path)
        if m:
            clip_id = int(m.group(1))
            with MIRROR.borrow() as conn:
                clip = _query_one(conn, "SELECT absolute_path, relative_path FROM clips WHERE clip_id = ?", (clip_id,))
            if clip is None:
                return _send_error(self, 404, "clip_not_found", "clip not found")
            source = _resolve_path(clip["absolute_path"] or clip["relative_path"])
            if not source:
                return _send_error(self, 400, "missing_source", "absolute_path/relative_path missing")
            seconds = _as_float(params.get("seconds"), 3, MIN_PREVIEW_SECONDS, MAX_PREVIEW_SECONDS)
            fps = _as_int_range(params.get("fps"), 6, MIN_PREVIEW_FPS, MAX_PREVIEW_FPS)
            width = _as_int_range(params.get("width"), 480, MIN_PREVIEW_WIDTH, MAX_PREVIEW_WIDTH)
            cached = _clip_preview_path(clip_id, seconds, fps, width)
            if not cached.exists() and not os.path.exists(source):
                return _send_error(self, 404, "source_missing", f"Source missing: {source}")
            preview_path, cache_hit, elapsed_ms, error = _ensure_preview(source, clip_id, seconds, fps, width)
            if preview_path is None or error is not None:
                return _send_error(self, 500, error or "preview_generation_failed", "Unable to generate preview")
            return _send_json(self, {"ok": True, "preview": {"clip_id": clip_id, "src": f"/media/previews/{preview_path.name}", "seconds": seconds, "fps": fps, "width": width, "cache_hit": cache_hit, "generation_ms": elapsed_ms}})

        m = re.match(r"^/api/clips/(\d+)/thumb$", path)
        if m:
            clip_id = int(m.group(1))
            with MIRROR.borrow() as conn:
                clip = _query_one(conn, "SELECT thumbnail_path FROM clips WHERE clip_id = ?", (clip_id,))
            if clip is None:
                return _send_error(self, 404, "clip_not_found", "clip not found")
            local = _copy_catalog_thumb(clip_id, clip["thumbnail_path"]) if clip["thumbnail_path"] else None
            if local is None:
                if _parse_bool(params.get("redirect")):
                    return _send_error(self, 404, "no_thumbnail", "No thumbnail for this clip")
                return _send_json(self, {"ok": True, "clip_id": clip_id, "has_thumbnail": False, "message": "No usable thumbnail for this clip"})
            src = f"/media/thumb/{clip_id}.jpg?v={_thumb_version(clip['thumbnail_path'])}"
            if _parse_bool(params.get("redirect")):
                self.send_response(302)
                self.send_header("Location", src)
                self.send_header("Content-Length", "0")
                _cors(self)
                self.end_headers()
                return None
            return _send_json(self, {"ok": True, "clip_id": clip_id, "has_thumbnail": True, "src": src, "width": THUMB_WIDTH, "cache_hit": True})

        m = re.match(r"^/media/(thumb|frame)/(\d+)\.jpg$", path)
        if m:
            kind, clip_id = m.group(1), int(m.group(2))
            local = _thumb_local_path(clip_id)
            if not local.exists():
                with MIRROR.borrow() as conn:
                    clip = _query_one(conn, "SELECT thumbnail_path, absolute_path, relative_path, duration_seconds FROM clips WHERE clip_id = ?", (clip_id,))
                if clip is None:
                    return _send_error(self, 404, "clip_not_found", "clip not found")
                got: Optional[Path] = None
                if clip["thumbnail_path"]:
                    got = _copy_catalog_thumb(clip_id, clip["thumbnail_path"])
                if got is None and kind == "frame":
                    source = _resolve_path(clip["absolute_path"] or clip["relative_path"])
                    if source and os.path.exists(source):
                        got = _grab_frame(clip_id, source, clip["duration_seconds"])
                if got is None:
                    return _send_error(self, 404, "no_thumbnail", "No thumbnail available")
            return _send_file(self, local, "image/jpeg")

        if path.startswith("/media/previews/"):
            name = _sanitize_name(path.rsplit("/", 1)[-1], "preview")
            return _send_file(self, PREVIEW_DIR / name, "video/mp4", cache="public, max-age=86400")

        if path.startswith("/media/thumbs/"):  # legacy location
            name = _sanitize_name(path.rsplit("/", 1)[-1], "thumb")
            return _send_file(self, THUMB_DIR / name, "image/jpeg")

        return _send_error(self, 404, "not_found", "Not Found")

    def do_DELETE(self) -> None:
        if not self._authorized():
            return
        path, _ = self._route()
        m = re.match(r"^/api/bins/([0-9a-zA-Z_-]+)$", path)
        if m:
            bins = _bins()
            kept = [b for b in bins if str(b.get("id")) != m.group(1)]
            if len(kept) == len(bins):
                return _send_error(self, 404, "bin_not_found", "bin not found")
            _save_bins(kept)
            return _send_json(self, {"ok": True, "deleted": m.group(1)})
        return _send_error(self, 404, "not_found", "Not Found")

    def do_POST(self) -> None:
        path, _ = self._route()
        if path.startswith("/api/spike/"):
            spike = getattr(self.server, "editor_spike", None)
            if spike is None:
                self.close_connection = True
                return _send_error(self, 404, "spike_disabled", "Start with BROLL_EDITOR_SPIKE=1 to enable Phase 0")
            return spike.handle(self, path.removeprefix("/api/spike/"))
        if not self._authorized():
            return
        body = _parse_json_body(self)
        try:
            return self._post(path, body)
        except RuntimeError as exc:
            return _send_error(self, 503, "catalog_unavailable", str(exc))
        except sqlite3.Error as exc:
            return _send_error(self, 500, "db_error", str(exc))

    def _post(self, path: str, body: Optional[Dict[str, Any]]) -> None:
        if path == "/api/setup":
            try:
                settings, count = SETTINGS_STORE.validate(body)
                with self.server.setup_lock:
                    restart = APP_SETTINGS.configured
                    SETTINGS_STORE.save(settings)
                    if not restart:
                        activate_settings(settings)
                        start_catalog(self.server)
                return _send_json(self, {"ok": True, "clip_count": count, "restart_required": restart})
            except (ValueError, OSError) as exc:
                return _send_error(self, 400, "setup_invalid", str(exc))
        if path == "/api/admin/refresh":
            ok = MIRROR.rebuild()
            return _send_json(self, {"ok": ok, "mirror": MIRROR.status()}, 200 if ok else 503)

        if path == "/api/preferences":
            if not isinstance(body, dict):
                return _send_error(self, 400, "invalid_payload", "Expected JSON object")
            body.pop("bins", None)
            _save_state(body)
            return _send_json(self, {"ok": True, "saved": True, "at": _now()})

        if path == "/api/bins":
            if not isinstance(body, dict):
                return _send_error(self, 400, "invalid_payload", "Expected JSON object")
            name = str(body.get("name") or "").strip() or f"Bin {datetime.now().strftime('%b %d %H:%M')}"
            new = {"id": uuid.uuid4().hex[:10], "name": name, "clip_ids": _clean_ids(body.get("clip_ids")), "created_at": _now(), "updated_at": _now()}
            bins = _bins()
            bins.insert(0, new)
            _save_bins(bins)
            return _send_json(self, {"ok": True, "bin": _bin_summary(new)})

        m = re.match(r"^/api/bins/([0-9a-zA-Z_-]+)(?:/(delete|premiere))?$", path)
        if m:
            bin_id, action = m.group(1), m.group(2)
            bins = _bins()
            target = next((b for b in bins if str(b.get("id")) == bin_id), None)
            if target is None:
                return _send_error(self, 404, "bin_not_found", "bin not found")
            if action == "delete":
                _save_bins([b for b in bins if b is not target])
                return _send_json(self, {"ok": True, "deleted": bin_id})
            if action == "premiere":
                return self._premiere(_clean_ids(target.get("clip_ids")), (body or {}).get("project"), (body or {}).get("sequence"), True, str(target.get("name") or "B-roll bin"))
            body = body or {}
            if "name" in body and str(body["name"]).strip():
                target["name"] = str(body["name"]).strip()
            ids = _clean_ids(target.get("clip_ids"))
            if isinstance(body.get("clip_ids"), list):
                ids = _clean_ids(body["clip_ids"])
            if isinstance(body.get("add"), list):
                for i in _clean_ids(body["add"]):
                    if i not in ids:
                        ids.append(i)
            if isinstance(body.get("remove"), list):
                rm = set(_clean_ids(body["remove"]))
                ids = [i for i in ids if i not in rm]
            target["clip_ids"] = ids
            target["updated_at"] = _now()
            _save_bins(bins)
            return _send_json(self, {"ok": True, "bin": _bin_summary(target)})

        if path == "/api/premiere/import":
            if not body or not isinstance(body.get("clip_ids"), list) or not body["clip_ids"]:
                return _send_error(self, 400, "missing_clip_ids", "clip_ids must be a non-empty list")
            return self._premiere(_clean_ids(body["clip_ids"]), body.get("project"), body.get("sequence"), bool(body.get("make_bin")), body.get("bin_name"))

        if path == "/api/clips/edit":
            if not isinstance(body, dict):
                return _send_error(self, 400, "invalid_payload", "Expected JSON")
            clip_id = _as_int(str(body.get("clip_id")), None)
            if clip_id is None:
                return _send_error(self, 400, "invalid_clip_id", "clip_id required")
            return self._edit(clip_id, body)

        m = re.match(r"^/api/clips/(\d+)/edit$", path)
        if m:
            if not isinstance(body, dict):
                return _send_error(self, 400, "invalid_payload", "Expected JSON")
            return self._edit(int(m.group(1)), body)

        m = re.match(r"^/api/clips/(\d+)/revert$", path)
        if m:
            # Put the scorer's original reading back for one field.
            clip_id = int(m.group(1))
            field = str((body or {}).get("field") or "quality_stars")
            if field not in ALLOWED_EDIT_FIELDS:
                return _send_error(self, 400, "invalid_field", "field not editable")
            with MIRROR.borrow() as conn:
                first = _query_one(conn, "SELECT old_value FROM catalog_user_edits WHERE clip_id = ? AND field_name = ? ORDER BY id ASC LIMIT 1", (clip_id, field))
            if first is None:
                return _send_error(self, 404, "no_edits", "no human edit to revert")
            original: Any = first["old_value"]
            if field in {"quality_stars", "is_present", "is_proxy", "is_highlight"} and original is not None:
                original = _as_int(original, None)
            try:
                updated = _apply_edit(clip_id, {field: original}, "Reverted to scorer value")
            except Exception as exc:
                return _send_error(self, 400, "edit_failed", str(exc))
            return _send_json(self, {"ok": True, "clip": updated, "updated_at": _now()})

        return _send_error(self, 404, "not_found", "Not Found")

    def _edit(self, clip_id: int, body: Dict[str, Any]) -> None:
        updates = body.get("updates")
        if not isinstance(updates, dict):
            return _send_error(self, 400, "invalid_updates", "updates object required")
        if not os.path.exists(DB_PATH):
            return _send_error(self, 503, "source_unreachable", f"Catalog on the share is not reachable, edit not saved: {DB_PATH}")
        try:
            updated = _apply_edit(clip_id, updates, body.get("reason"))
        except Exception as exc:
            return _send_error(self, 400, "edit_failed", str(exc))
        return _send_json(self, {"ok": True, "clip": updated, "updated_at": _now()})

    def _premiere(self, ids: List[int], project: Optional[str], sequence: Optional[str], make_bin: bool, bin_name: Optional[str]) -> None:
        with MIRROR.borrow() as conn:
            rows = _fetch_clips_by_ids(conn, ids)
        paths = [str(r["absolute_path"] or _resolve_path(r["relative_path"]) or "") for r in rows]
        paths = [p for p in paths if p]
        if not paths:
            return _send_error(self, 404, "no_importable_clips", "No valid clip paths found")
        result = _call_bridge(paths, project, sequence, make_bin, bin_name)
        if not result.get("ok", False):
            result["paths"] = paths
            return _send_json(self, result, int(result.get("status", 500)))
        return _send_json(self, {"ok": True, "imported": paths, "bridge": result}, 200)


# --------------------------------------------------------------------------


def activate_settings(settings):
    global APP_SETTINGS, DB_PATH, MEDIA_ROOT, PREVIEW_DIR, STATE_PATH, CSV_TEMPLATE
    global THUMB_DIR, MIRROR_DIR, MIRROR_PATH, MIRROR_META
    APP_SETTINGS = settings
    DB_PATH, MEDIA_ROOT = settings.catalog_path, Path(settings.media_root)
    PREVIEW_DIR = Path(settings.cache_path) / settings.library_key
    STATE_PATH = SETTINGS_STORE.home / "config" / f"bins-{settings.library_key}.json"
    CSV_TEMPLATE = str(Path(DB_PATH).parent / "broll_quality_{year}.csv")
    THUMB_DIR, MIRROR_DIR = PREVIEW_DIR / "thumbs", PREVIEW_DIR / "mirror"
    MIRROR_PATH, MIRROR_META = MIRROR_DIR / "catalog_mirror.sqlite", MIRROR_DIR / "catalog_mirror.json"


def start_catalog(server):
    if getattr(server, "catalog_started", False) or not APP_SETTINGS.configured:
        return
    server.catalog_started = True
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    if os.getenv("BROLL_EDITOR_SPIKE") == "1":
        def lookup(ids):
            with MIRROR.borrow() as conn:
                return [{**_to_dict(row), "id": row["clip_id"]} for row in _fetch_clips_by_ids(conn, ids)]
        server.editor_spike = EditorSpike(MEDIA_ROOT, lookup)
        _log(f"Phase 0 pairing token: {server.editor_spike.token}")
    threading.Thread(target=MIRROR.ensure, daemon=True).start()
    threading.Thread(target=MIRROR.watch, daemon=True).start()


def create_server(port=PORT):
    server = ThreadingHTTPServer(("127.0.0.1", port), CatalogHandler)
    server.daemon_threads = True
    server.runtime_token = secrets.token_urlsafe(32)
    server.setup_lock = threading.Lock()
    start_catalog(server)
    return server


def main() -> None:
    import webbrowser
    server = create_server()
    url = f"http://127.0.0.1:{server.server_port}/session/{server.runtime_token}"
    _log("Vault is ready. Opening a private local browser session.")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
