"""Only public release metadata leaves this workstation. No catalog telemetry."""
import hashlib
import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

APP_VERSION = "0.1.3"
REPOSITORY = "PoyBoy96/Broll-vault"
RELEASES_URL = f"https://github.com/{REPOSITORY}/releases"
INSTALLER_NAME = "BrollVaultSetup.exe"
MAX_INSTALLER_BYTES = 300_000_000


def version_tuple(tag):
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", str(tag))
    return tuple(map(int, match.groups())) if match else None


def release_status(release):
    latest = version_tuple(release.get("tag_name"))
    url = release.get("html_url", "")
    if not url.startswith(RELEASES_URL + "/tag/"):
        raise ValueError("Release URL does not belong to the application repository")
    available = bool(latest and latest > version_tuple(APP_VERSION) and
                     not release.get("draft") and not release.get("prerelease"))
    return {"ok": True, "state": "available" if available else "current", "available": available,
            "current_version": APP_VERSION, "latest_version": release.get("tag_name"),
            "release_url": url, "title": str(release.get("name") or release.get("tag_name")),
            "installer_available": any(a.get("name") == INSTALLER_NAME for a in release.get("assets", []))}


class ReleaseChecker:
    def __init__(self):
        self.lock = threading.Lock()
        self.cached, self.checked = None, 0

    def check(self, enabled=True):
        base = {"ok": True, "available": False, "current_version": APP_VERSION, "release_url": RELEASES_URL}
        if not enabled:
            return {**base, "state": "disabled"}
        with self.lock:
            if self.cached and time.monotonic() - self.checked < 900:
                return self.cached
            request = urllib.request.Request(f"https://api.github.com/repos/{REPOSITORY}/releases/latest",
                headers={"Accept": "application/vnd.github+json", "User-Agent": f"BrollVault/{APP_VERSION}"})
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    raw = response.read(2_000_001)
                    if len(raw) > 2_000_000:
                        raise ValueError("Release response too large")
                    result = release_status(json.loads(raw))
            except urllib.error.HTTPError as exc:
                result = {**base, "state": "no_releases" if exc.code == 404 else "unavailable"}
            except (OSError, ValueError, TypeError, AttributeError):
                result = {**base, "state": "unavailable"}
            self.cached, self.checked = result, time.monotonic()
            return result


def download_installer(release):
    """Download the matching GitHub installer and verify its published SHA-256."""
    tag = release.get("latest_version", "")
    if (not release.get("available") or not release.get("installer_available") or
            not re.fullmatch(r"v\d+\.\d+\.\d+", tag) or
            version_tuple(tag) <= version_tuple(APP_VERSION) or
            release.get("release_url") != f"{RELEASES_URL}/tag/{tag}"):
        raise ValueError("No trusted newer Windows installer is available")

    base_url = f"{RELEASES_URL}/download/{tag}"
    headers = {"User-Agent": f"BrollVault/{APP_VERSION}"}
    checksum_request = urllib.request.Request(f"{base_url}/SHA256SUMS.txt", headers=headers)
    with urllib.request.urlopen(checksum_request, timeout=30) as response:
        checksum_file = response.read(4097)
    if len(checksum_file) > 4096:
        raise ValueError("Release checksum file is too large")
    match = re.fullmatch(r"([0-9a-fA-F]{64})  BrollVaultSetup\.exe\s*", checksum_file.decode("ascii"))
    if not match:
        raise ValueError("Release checksum file is invalid")
    expected_hash = match.group(1).lower()

    destination = Path(tempfile.gettempdir()) / "BrollVaultUpdates" / tag
    destination.mkdir(parents=True, exist_ok=True)
    installer = destination / INSTALLER_NAME
    if installer.is_file() and _file_hash(installer) == expected_hash:
        return installer

    temporary = destination / f"{INSTALLER_NAME}.{os.getpid()}.part"
    digest = hashlib.sha256()
    total = 0
    try:
        installer_request = urllib.request.Request(f"{base_url}/{INSTALLER_NAME}", headers=headers)
        with urllib.request.urlopen(installer_request, timeout=30) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_INSTALLER_BYTES:
                    raise ValueError("Release installer is too large")
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != expected_hash:
            raise ValueError("Release installer checksum does not match")
        os.replace(temporary, installer)
        return installer
    finally:
        temporary.unlink(missing_ok=True)


def _file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as installer:
        while chunk := installer.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
