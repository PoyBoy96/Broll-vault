"""Only public release metadata leaves this workstation. No catalog telemetry."""
import json
import re
import threading
import time
import urllib.error
import urllib.request

APP_VERSION = "0.1.0"
REPOSITORY = "PoyBoy96/Broll-vault"
RELEASES_URL = f"https://github.com/{REPOSITORY}/releases"


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
            "installer_available": any(a.get("name") == "BrollVaultSetup.exe" for a in release.get("assets", []))}


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
