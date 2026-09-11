# B-roll Vault

A Windows desktop catalog for searching, previewing and collecting footage while original media stays in place.

## First launch

Open B-roll Vault and choose your library folder, SQLite catalog, local cache, preview behavior and primary editor. No workstation or network-share location is included in the application. Settings are validated and saved in the current user's local application data directory. Changing libraries keeps separate local caches and bin definitions and takes effect after restarting Vault.

Catalogs, source footage, saved bins, credentials and workstation settings are never included in this repository. The shared catalog is read-only. Ratings display remains available; shared rating writes are disabled pending a metadata overlay. This version still uses local saved bins; shared bin storage is a later phase.

## Updates

The bell checks this repository's public GitHub Releases at startup and every 15 minutes while Vault is open. It displays **Update available** for a newer stable version. **Download** and **Learn more** open the corresponding GitHub release page in your browser. Download the Windows installer there and run it. The installer closes the previous installed version and relaunches Vault after a normal interactive update. Silent installs do not launch interactive windows.

Updates preserve configuration, caches and source media. Nothing installs in the background. Update checks can be switched off in Settings. No library data, paths, usage activity or Windows identity is sent to GitHub; only the public release request and application version in its User-Agent are sent. GitHub receives the usual network connection metadata.

## Development

Requires Python 3.10+ and Node.js 22+:

```powershell
python -m pip install -r desktop/requirements.txt
cd web
npm ci
npm run build
cd ..
python desktop/main.py
```

Alternatively run `python broll_catalog_backend/server_api.py` to open the built UI in a browser with a local session. Keep that process running. All API and media routes require a per-launch session and bind only to loopback. The unauthenticated Vite development proxy is no longer the default launch workflow.

The desktop requires the Microsoft Edge WebView2 Evergreen Runtime. No Node or Python installation is required by the packaged application. Optional FFmpeg must currently be installed separately for generated previews.

## Build and publish a Windows update

```powershell
python -m PyInstaller --clean --noconfirm desktop/vault.spec
# Compile desktop/installer.iss with Inno Setup 6 after building the frontend.
```

The result is `output/BrollVaultSetup.exe`. The installer is per-user, does not start with Windows and never removes library data during uninstall. Installers are currently unsigned; signing is pending a publisher certificate.

For subsequent releases, update `APP_VERSION` in `broll_catalog_backend/app_release.py`, the fallback version in `desktop/installer.iss`, and the frontend package version. Push the matching `vMAJOR.MINOR.PATCH` tag. The Windows release workflow runs tests, builds the installer and publishes it with a SHA-256 checksum and generated notes. Manual workflow runs produce build artifacts without publishing a release. Do not tag until the build is ready for users.

## Validation

```powershell
python -m unittest discover -s broll_catalog_backend/tests -v
python -m unittest discover -s integrations/editor_spike -v
node --test integrations/premiere_spike/importer.test.cjs
python scripts/check_publication.py
```

The publication check scans tracked text for common secret formats and private workstation paths, and rejects operational data files. It does not replace review. Optional local-only `VAULT_PRIVATE_TERMS` can add terms to the scan without placing them in source control.

See [the desktop plan](VAULT_DESKTOP_PLAN.md) and [editor spike runbook](integrations/editor_spike/README.md). Live editor integration is still an experimental Phase 0 workflow; the production desktop Send control is not yet connected to the spike adapters.
