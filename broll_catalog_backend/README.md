# Vault local API

Start `python broll_catalog_backend/server_api.py` from the repository root after building `web/`. It opens the UI with a per-launch browser session. Installed users launch the desktop shortcut instead.

Library paths, cache, preview policy and editor choice are entered in first-run setup and persisted only in local application data. No share path or credential is shipped in source. Shared catalog writes are disabled.

The server binds to loopback only. API, media and frontend requests require the runtime session cookie. External browser origins are rejected. A settings change requires restart after an existing library has been opened.

Optional development controls: `BROLL_CATALOG_PORT` changes the browser-mode port; `BROLL_FRONTEND_DIST` selects a built frontend; `BROLL_MIRROR_CHECK_SECS` changes mirror polling; `BROLL_EDITOR_SPIKE=1` enables the separate editor transport. These contain no preset workstation values.

See the [desktop README](../README.md) and [editor spike runbook](../integrations/editor_spike/README.md).
