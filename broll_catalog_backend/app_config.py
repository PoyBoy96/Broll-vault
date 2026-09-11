"""Workstation-only settings. No library location is shipped with the app."""
from dataclasses import asdict, dataclass
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

CATALOG_COLUMNS = {
    "clip_id", "relative_path", "absolute_path", "filename", "path_year", "review_year",
    "duration_seconds", "extension", "fps", "height", "width", "video_codec", "size_bytes",
    "inferred_recorded_date", "modified_at_utc", "quality_confidence", "quality_reasons",
    "quality_score_raw", "quality_stars", "review_status", "search_terms", "thumbnail_path",
}


def data_home():
    return Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local/share")) / "BrollVault"


@dataclass(frozen=True)
class Settings:
    schema_version: int = 1
    media_root: str = ""
    catalog_path: str = ""
    cache_path: str = ""
    preview_policy: str = "existing"
    primary_editor: str = "ask"
    check_updates: bool = True

    @property
    def configured(self):
        return bool(self.media_root and self.catalog_path and self.cache_path)

    @property
    def library_key(self):
        # Separate local mirrors/bins when changing libraries; never ship this value.
        return hashlib.sha256((self.media_root + "|" + self.catalog_path).casefold().encode()).hexdigest()[:20]


class SettingsStore:
    def __init__(self, home=None):
        self.home = Path(home) if home else data_home()
        self.path = self.home / "config/settings.json"

    def load(self):
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if raw.get("schema_version") != 1:
                return Settings()
            settings = Settings(**{k: raw[k] for k in Settings.__dataclass_fields__ if k in raw})
            if any(not isinstance(getattr(settings, key), str) for key in
                   ("media_root", "catalog_path", "cache_path", "preview_policy", "primary_editor")):
                return Settings()
            if settings.preview_policy not in ("existing", "stills", "on_demand") or settings.primary_editor not in ("ask", "premiere", "resolve"):
                return Settings()
            return settings
        except (OSError, ValueError, TypeError, AttributeError):
            return Settings()

    def validate(self, raw):
        if not isinstance(raw, dict):
            raise ValueError("Setup requires settings")
        for key in ("media_root", "catalog_path"):
            if not isinstance(raw.get(key), str) or not raw[key].strip():
                raise ValueError("Choose the library folder and catalog database")
        root, catalog = Path(raw["media_root"]), Path(raw["catalog_path"])
        if not root.is_absolute() or not root.is_dir():
            raise ValueError("The library folder must be an accessible absolute path")
        if not catalog.is_absolute() or not catalog.is_file():
            raise ValueError("Choose an accessible catalog database")
        if not isinstance(raw.get("cache_path", ""), str):
            raise ValueError("Cache location must be a folder path")
        cache = Path(raw.get("cache_path") or self.home / "cache")
        if not cache.is_absolute():
            raise ValueError("Cache location must be an absolute path")
        root, catalog, cache = root.resolve(), catalog.resolve(), cache.resolve()
        if str(cache).startswith("\\\\") or cache.is_relative_to(Path(__file__).resolve().parents[1]):
            raise ValueError("Choose a local cache outside the application source or installation folder")
        if cache == root or cache.is_relative_to(root):
            raise ValueError("Choose a local cache outside the source library")
        # No writes to the catalog or source tree during validation.
        with os.scandir(root) as entries:
            next(entries, None)
        try:
            with closing(sqlite3.connect(catalog.as_uri() + "?mode=ro", uri=True, timeout=5)) as conn:
                columns = {r[1] for r in conn.execute("PRAGMA table_info(clips)")}
                if not CATALOG_COLUMNS.issubset(columns):
                    raise ValueError("This database is not a supported Vault catalog")
                count = conn.execute("SELECT count(*) FROM clips").fetchone()[0]
        except sqlite3.Error:
            raise ValueError("The catalog could not be read as a SQLite database") from None
        preview = raw.get("preview_policy", "existing")
        editor = raw.get("primary_editor", "ask")
        if preview not in ("existing", "stills", "on_demand") or editor not in ("ask", "premiere", "resolve"):
            raise ValueError("Choose a valid preview policy and editor")
        cache.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=cache) as probe:
            probe.write(b"Vault cache permission check")
        return Settings(media_root=str(root), catalog_path=str(catalog), cache_path=str(cache),
                        preview_policy=preview, primary_editor=editor,
                        check_updates=raw.get("check_updates") is not False), count

    def save(self, settings):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(asdict(settings), handle, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def public(self):
        settings = self.load()
        return {"ok": True, "configured": settings.configured, "settings": asdict(settings),
                "default_cache": str(self.home / "cache")}
