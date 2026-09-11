"""Read-only SQLite locations for local disks and Windows network shares."""
from pathlib import PurePath
from urllib.parse import urlsplit


def readonly_catalog_uri(path: PurePath) -> str:
    uri = path.as_uri()
    if urlsplit(uri).netloc:
        # SQLite normally rejects URI authorities. Keep the UNC server in the
        # path instead: file:////server/share/catalog.sqlite (empty authority).
        uri = "file:////" + uri[len("file://"):]
    return uri + "?mode=ro"
