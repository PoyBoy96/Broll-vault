"""Windows WebView2 host. All library configuration remains on the workstation."""
import os
from pathlib import Path
import subprocess
import sys
import threading
import webbrowser

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(ROOT / "broll_catalog_backend"))
os.environ["BROLL_FRONTEND_DIST"] = str(ROOT / "web/dist")

from app_release import RELEASES_URL, ReleaseChecker, download_installer
from server_api import create_server
from app_config import SettingsStore
import webview


class DesktopApi:
    def __init__(self):
        self._update_lock = threading.Lock()
        self._release_checker = ReleaseChecker()

    def choose_folder(self):
        result = webview.windows[0].create_file_dialog(webview.FileDialog.FOLDER)
        return result[0] if result else None

    def choose_catalog(self):
        result = webview.windows[0].create_file_dialog(webview.FileDialog.OPEN,
            file_types=("SQLite catalog (*.sqlite;*.sqlite3;*.db)",))
        return result[0] if result else None

    def open_releases(self, url):
        # Never navigate the privileged webview to external release content.
        if url != RELEASES_URL and not url.startswith(RELEASES_URL + "/tag/"):
            raise ValueError("Only this application's GitHub releases can be opened")
        webbrowser.open(url)

    def install_update(self):
        if os.name != "nt" or not getattr(sys, "frozen", False):
            raise RuntimeError("Automatic updates require the installed Windows app")
        if not self._update_lock.acquire(blocking=False):
            raise RuntimeError("An update is already downloading")
        try:
            if not SettingsStore().load().check_updates:
                raise RuntimeError("Update checks are turned off in Settings")
            release = self._release_checker.check()
            installer = download_installer(release)
            subprocess.Popen([str(installer), "/VERYSILENT", "/NORESTART", "/CLOSEAPPLICATIONS", "/SP-"],
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            webview.windows[0].destroy()
        finally:
            self._update_lock.release()

    def restart(self):
        args = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, str(Path(__file__).resolve())]
        subprocess.Popen(args, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        webview.windows[0].destroy()


def main():
    server = create_server(0)  # private port per launch; no LAN listener
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    api = DesktopApi()
    webview.create_window("B-roll Vault", f"http://127.0.0.1:{server.server_port}/session/{server.runtime_token}",
                          js_api=api, width=1440, height=960, min_size=(900, 650))
    try:
        webview.start(gui="edgechromium", private_mode=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
