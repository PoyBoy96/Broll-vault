# B-roll Vault Desktop — Scoped Product and Implementation Plan

## 1. Outcome

Ship one Windows installer that gives each videographer a local B-roll Vault application. The application reads a catalog and media from a user-selected B-roll storage root, provides fast search and previews, saves reusable bins, and sends selected source paths into the active Premiere Pro or DaVinci Resolve project without moving, renaming, transcoding, or copying the source clips.

There is no central application server and no Vault account system. The application server runs only on the current workstation while Vault is open. Windows identity may be recorded as descriptive activity metadata, but it is not authentication or authorization.

## 2. Product decisions

### Included in version 1

- Windows desktop installer and first-run setup.
- User-selected B-roll storage root; no operational data is stored in the source-code repository.
- Discovery and validation of the catalog database and media tree.
- Local database mirror for responsive searches.
- Existing Vault search, filters, ratings display, thumbnails, hover previews, peek view, and bins.
- Premiere Pro UXP plugin that connects to the local Vault application.
- DaVinci Resolve adapter that connects to the locally running Resolve application.
- Send a named Vault bin to the active project as an editor bin containing links to original source paths.
- Shared, account-free bin definitions stored as small metadata files in the configured Vault data folder.
- Shared successful-import activity that powers Recently Used and Exclude Recently Used filters.
- Windows username and computer name captured as optional descriptive activity fields.
- Configuration, diagnostics, repair, and editor-selection settings.
- Motion-rich onboarding and state transitions that respect reduced-motion preferences.
- XML/path-list fallback when direct Premiere integration is unavailable.

### Explicitly excluded from version 1

- Moving or copying source footage.
- Creating editing proxies for Premiere or Resolve.
- Cloud hosting, user accounts, passwords, SSO, or remote access.
- MCP or AI chat as a required part of the workflow.
- Writing arbitrary metadata into source video files.
- Automatically creating a timeline or changing project frame-rate settings.
- Background services that run when Vault is closed.
- Multi-platform packaging. Windows is the initial supported platform.

### Possible later additions

- Optional Create Selects Sequence after a successful bin import.
- Personal versus team-shared bin views.
- Comments, project codes, and campaign metadata.
- An MCP facade for natural-language search and bin creation.
- macOS package and path mapping.
- Managed application/plugin updates.

## 3. Why FFmpeg is present

FFmpeg is not used to import clips into Premiere or Resolve, and it does not alter the originals.

Vault uses FFmpeg only when it needs a browser-compatible visual derivative:

1. Generate a still when the catalog has no thumbnail.
2. Generate a short, low-resolution hover preview because browsers cannot reliably play many camera-original codecs and containers.

These derivatives are disposable cache files. The original clip remains unchanged on the B-roll share, and editor import always uses the original source path.

Version 1 should make preview behavior configurable:

- **On-demand previews (recommended):** generate missing stills and short previews locally and cache them.
- **Stills only:** never generate motion previews.
- **Existing previews only:** use derivatives already present in the catalog and never invoke FFmpeg.

The installer may bundle a known FFmpeg build or install Vault without it. If FFmpeg is unavailable, search, bins, existing thumbnails, and editor import must still work. The UI should describe the result as “Motion preview unavailable,” not as an offline clip.

## 4. Runtime architecture

### Shared storage

The user selects a B-roll root during setup. Vault discovers or creates this structure without modifying media folders:

```text
<BROLL_ROOT>\
├── ... original B-roll folders ...
└── _CATALOG\
    ├── broll_catalog.sqlite
    ├── thumbnails\                 existing/generated catalog thumbnails, if present
    └── VaultData\
        ├── schema.json
        ├── bins\
        │   ├── <bin-id>.json
        │   └── ...
        └── activity\
            └── YYYY\MM\
                ├── <timestamp>__<event-id>.json
                └── ...
```

`VaultData` contains metadata only. It never contains original clips. Each bin or activity event is its own file, written to a temporary filename and atomically renamed, so two workstations do not overwrite one shared JSON document.

If the selected share is read-only, Vault enters read-only team mode:

- Search and editor import still work.
- Bins may be saved locally as a fallback.
- Shared activity cannot be recorded.
- The header clearly displays the limitation and offers Repair Setup.

### Local workstation storage

```text
%LOCALAPPDATA%\BrollVault\
├── config\settings.json
├── cache\
│   ├── catalog_mirror.sqlite
│   ├── catalog_mirror.json
│   ├── thumbs\
│   └── previews\
├── logs\
└── runtime\
```

Local data has distinct responsibilities:

- `settings.json`: paths, primary editor, preview policy, and UI preferences.
- `catalog_mirror.sqlite`: read-optimized copy of the catalog; replaced when the source signature changes.
- `thumbs` and `previews`: disposable derivative cache.
- `logs`: bounded diagnostics with no video contents.
- `runtime`: ephemeral local job queue/token data; removed when Vault exits cleanly.

The source repository is never used for installed configuration or runtime storage.

### Local application server

While Vault is open, the executable starts a loopback-only API on `127.0.0.1`. It serves the packaged React application and handles catalog queries, previews, bins, activity, and editor jobs. It must never listen on the LAN.

The executable owns server startup and shutdown. Users never see a terminal window and do not need Python or Node installed.

## 5. Catalog lifecycle

- Vault does not crawl the full B-roll tree on every launch.
- On startup, it locates the shared catalog database and compares its size/modified-time signature with the local mirror metadata.
- If unchanged, Vault opens immediately using the local mirror.
- If changed, Vault builds a replacement mirror in the background and atomically swaps it in.
- If the share is temporarily unavailable but a valid local mirror exists, Vault opens in Offline Catalog mode. Previewing uncached media and editor import are disabled until source paths become reachable.
- If no catalog exists, setup offers Locate Catalog or Build Catalog. Build Catalog is a separate, explicit operation with progress and cancellation; it is never silently triggered at launch.

The shared catalog should be treated as read-only by ordinary clients in version 1. Existing write-through rating edits should move to a metadata overlay or remain disabled until a collision-safe shared-edit design is implemented. Direct concurrent SQLite writes over SMB are outside the supported version-1 design.

## 6. Bins

A Vault bin is a small JSON definition, not a folder of copied footage:

```json
{
  "schema_version": 1,
  "id": "01J...",
  "name": "Riverside exterior selects",
  "clip_ids": [108, 391, 882],
  "created_at": "2026-09-10T16:20:00Z",
  "updated_at": "2026-09-10T16:31:00Z",
  "created_by": {
    "windows_user": "DOMAIN\\editor",
    "computer": "EDIT-01"
  }
}
```

“Stored locally” previously meant a bin existed only in `%LOCALAPPDATA%` on one PC. That is not the recommended final behavior if bins should follow the shared B-roll library. The revised version-1 design stores normal bins in `_CATALOG\VaultData\bins`, making them visible to all Vault workstations. Windows identity is informational and can support a “Mine” filter, but all users can see shared bins.

Each bin file is independent. Updates use a revision/updated-at check to detect simultaneous edits and offer Save as Copy instead of silently overwriting another user’s change.

## 7. Windows identity and activity

Vault may automatically read:

- Windows domain and username, for example `EXAMPLE\editor`.
- Computer name, for example `EDIT-03`.
- Application version and selected editor.

This requires no Vault login. It is an attribution label only; it must not be presented as verified identity or used to grant access.

Activity is recorded only after the editor plugin/adapter confirms that an import succeeded. Selecting, previewing, or adding a clip to a Vault bin does not mark it used.

One successful send writes one immutable activity event:

```json
{
  "schema_version": 1,
  "event_id": "01J...",
  "occurred_at": "2026-09-10T16:42:09Z",
  "editor": "premiere",
  "project_name": "Fall Campaign",
  "bin_name": "Riverside exterior selects",
  "clip_ids": [108, 391, 882],
  "result": "success",
  "windows_user": "EXAMPLE\\editor",
  "computer": "EDIT-03"
}
```

Vault aggregates these events into the local catalog mirror and exposes:

- `last_used_at`
- `use_count`
- `last_used_by`
- `last_used_in`
- `last_project_name`

User-facing filters:

- Never used
- Used recently
- Exclude used in the last 7 days
- Exclude used in the last 30 days
- Exclude used in the last 90 days
- Used in Premiere / Resolve
- Used by me

The default search should not silently hide recently used footage. “Exclude recently used” is an explicit saved preference because reuse tolerance varies by project.

If attribution is considered unnecessary, the same activity system works with `windows_user` omitted. Date, editor, project, and clip IDs remain useful.

## 8. First-run setup experience

Setup appears inside the installed desktop application, not in a command prompt. It is resumable and stores progress after every completed screen.

### Screen 1 — Welcome

- Explain: search, preview, collect, send.
- State clearly that Vault never moves or changes original footage.
- Primary action: Set up Vault.

Motion: the Vault mark assembles from three machined pieces, then settles. No unattended looping.

### Screen 2 — Choose B-roll library

- Folder picker for the B-roll root.
- Show the selected path in full.
- Scan only for expected landmarks, not every clip:
  - `_CATALOG`
  - `broll_catalog.sqlite`
  - thumbnail directories
  - presence of likely media files in sampled folders
- If multiple databases are found, show name, modified date, and approximate clip count.
- Allow Choose a different catalog.

Motion: selected folder compresses into a breadcrumb chip; discovered resources arrive as staggered rows.

### Screen 3 — Storage and permissions

- Proposed shared metadata folder: `<BROLL_ROOT>\_CATALOG\VaultData`.
- Proposed local cache: `%LOCALAPPDATA%\BrollVault\cache`.
- Optional advanced controls to change either location.
- Preview policy selector: On-demand motion, Stills only, Existing only.
- Cache size limit with a recommended default and Clear Cache explanation.
- Run tests:
  - read B-roll root
  - read catalog
  - create/delete a harmless test file in VaultData
  - write local cache
- Explain exact consequences of a failed write test.

No Windows firewall exception should be requested because the server is loopback-only. If folder credentials are required, Windows handles them through the normal network credential flow; Vault does not store SMB passwords.

Motion: permission checks travel down a short status rail and resolve into labeled results, not just colored icons.

### Screen 4 — Choose primary editor

- Premiere Pro
- DaVinci Resolve
- Both / Ask each time
- Note: this can be changed later.
- Detect installed versions and warn about unsupported versions.

Motion: selection moves into the primary position with a restrained spring; connection line resolves toward the Vault icon.

### Screen 5A — Premiere setup

- Explain the local plugin relationship.
- Install Premiere Plugin button for the bundled `.ccx`.
- Detect plugin connection when Premiere and the plugin panel are open.
- Show three test states: Premiere detected, plugin loaded, Vault connected.
- Provide Open installation instructions and Retry.
- Keep XML export available if installation is skipped.

### Screen 5B — Resolve setup

- Detect Resolve installation.
- Explain that Resolve must be running for direct import.
- Test scripting API access.
- If required, show the exact Resolve preference that enables local scripting.
- Provide Retry and Skip for now.

### Screen 6 — Review

- B-roll root
- Catalog path and clip count
- Shared metadata path/write state
- Local cache path and preview policy
- Primary editor
- Premiere/Resolve integration state
- Finish and Open Vault

Motion: completed choices collapse into a compact receipt, followed by a 220–260 ms transition into the real Vault shell. Do not play a separate splash animation after completion.

### Later access

Settings contains a Setup & Connections section with:

- Change B-roll library
- Change metadata/cache locations
- Change primary editor
- Repair/reinstall Premiere plugin
- Test Premiere
- Test Resolve
- Preview policy and cache controls
- Show detected Windows identity
- Re-run setup

Changing the B-roll root requires validation before replacing the working configuration. The previous configuration remains recoverable until the new one passes.

## 9. Premiere Pro integration

### Components

- Vault desktop local API and job queue.
- B-roll Vault UXP plugin installed into Premiere.
- A small dockable Premiere panel showing connection, active project, last transfer, and Retry.

### Connection

- The UXP plugin is the client.
- While the panel is active, it polls a loopback endpoint at a modest interval or uses a WebSocket in a later revision.
- Network permission is restricted to the exact localhost origin.
- The plugin sends its Premiere version, active-project name/identifier, and plugin version during its heartbeat.
- Vault displays Connected only after a recent heartbeat.

### Send operation

1. User selects a saved bin or checked clips.
2. User clicks Send to Premiere.
3. Vault confirms the detected active project and target bin name.
4. Vault validates every path is beneath the configured B-roll root and reachable.
5. Vault creates a short-lived job.
6. The plugin claims the job.
7. The plugin finds or creates `B-roll Vault/<bin name>` in the active project.
8. The plugin imports original UNC paths into that bin.
9. The plugin detects already-present media where practical and avoids unnecessary duplicates.
10. The plugin returns imported, existing, missing, and failed items.
11. Vault writes shared activity only for confirmed imported/existing items considered successfully available in the target bin.

The operation never creates a sequence in version 1.

### Failure behavior

- Premiere closed: Open Premiere and the B-roll Vault plugin to connect.
- No active project: Open or create a Premiere project.
- Plugin outdated: Update Plugin action.
- Missing media: show exact files and keep successful imports.
- Plugin disconnects mid-job: job remains retryable and activity is not recorded until confirmation.
- Direct integration unavailable: Download Premiere XML and Copy Paths remain visible.

## 10. DaVinci Resolve integration

Resolve does not need a second web plugin for version 1. The desktop application invokes the local Resolve scripting API when Resolve is running.

Send operation:

1. Detect running Resolve and active project.
2. Validate source paths.
3. Get the project Media Pool.
4. Find or create `B-roll Vault/<bin name>`.
5. Set it as the current Media Pool folder.
6. Import the original paths.
7. Restore the user’s prior current folder if appropriate.
8. Return per-item results and write confirmed activity.

Setup and diagnostics must identify when external scripting is unavailable. Version 1 should document Resolve Studio as the supported direct-integration target until testing proves the required API works in the team’s installed Resolve editions.

## 11. Desktop packaging and installer

### Packaging direction

Reuse the existing React/Vite frontend and Python backend. Package them with:

- A Windows desktop shell using the system WebView2 runtime.
- A hidden child backend process or embedded Python runtime.
- Packaged frontend assets.
- Optional bundled FFmpeg binaries.
- Premiere `.ccx` package.
- Resolve adapter modules.

The user should receive one signed installer, provisionally named `BrollVaultSetup.exe`.

### Installer behavior

- Per-user installation by default; avoid administrator rights when possible.
- Install application binaries under the normal per-user application directory.
- Create Start Menu shortcut and optional desktop shortcut.
- Register uninstall information.
- Do not start with Windows; Vault runs when the user opens it.
- Do not request a firewall exception.
- Launch first-run setup after installation.
- Preserve configuration and shared bins during application upgrades.
- Offer a checkbox to clear only local cache during uninstall; never delete shared catalog, bins, activity, or source media.

### Updates

Initial internal distribution can use a versioned installer on the shared storage. On launch, Vault may read a small version manifest and display Update Available, but it should not self-update without explicit user action in version 1.

## 12. Motion and interaction direction

Motion should feel like a well-made mechanism: pieces align, rails advance, and choices settle into place. It should not look like a game launcher or neon technology dashboard.

Rules:

- Setup screen transitions: 220–320 ms.
- Small selection feedback: 150–220 ms.
- Use opacity and transform; avoid expensive blur animation.
- Selected cards settle with a short spring-like easing and no bounce loop.
- Discovered folders/results use a short stagger capped at approximately six visible items.
- Connection states use one purposeful draw/lock animation when the state changes, not a perpetual pulse.
- Success uses a brief ember accent because it represents the user’s action.
- Machine discovery/progress uses teal.
- Broken paths or failed permission checks use coral with a label/icon.
- Respect `prefers-reduced-motion`; replace movement with immediate state changes or short fades.
- Do not delay navigation while waiting for decorative animation.
- Do not animate ordinary Vault page load; motion is strongest in onboarding and state changes.

## 13. Security and safety boundaries

- Bind the local API only to `127.0.0.1`.
- Generate a random runtime token on every Vault launch; the desktop UI and editor integrations include it in requests.
- Restrict editor import paths to descendants of the configured B-roll root.
- Do not accept shell commands or arbitrary executable paths through the local API.
- Declare only the Premiere plugin permissions required for localhost networking and Premiere project operations.
- Do not collect or store SMB credentials.
- Sanitize bin names before creating editor folders or filenames.
- Write shared JSON metadata through temporary files and atomic rename.
- Keep activity events immutable; corrections create a new compensating event instead of rewriting history.
- Cap log size and omit media contents.
- Never delete source clips, catalog files, or shared metadata from the uninstall path.

## 14. Delivery phases

### Phase 0 — Technical spikes

- Prove Premiere UXP connection to localhost.
- Create a named Premiere bin and import a small list of UNC paths.
- Prove Resolve active-project detection, bin creation, and import.
- Verify behavior for duplicates, missing paths, editor closed, and no active project.
- Confirm minimum supported Premiere and Resolve versions on team workstations.

Exit: both editors can receive the same test Vault bin without copying source media.

### Phase 1 — Storage and configuration foundation

- Introduce typed application configuration outside the repository.
- Build folder/catalog discovery and validation.
- Formalize local cache layout and catalog mirror lifecycle.
- Implement VaultData schema, atomic bin files, and immutable activity events.
- Add Windows identity labeling.
- Remove ordinary-client write-through to shared SQLite or gate it off.

Exit: two workstations can open the same catalog, see the same shared bin, and write separate activity events safely.

### Phase 2 — First-run setup and settings

- Implement the six-screen onboarding flow.
- Add discovery, permission tests, editor detection, preview policy, and review receipt.
- Add Settings > Setup & Connections and repair flows.
- Implement motion and reduced-motion variants.

Exit: a new workstation can reach the Vault without editing environment variables or repository files.

### Phase 3 — Premiere production integration

- Build and package UXP plugin.
- Add heartbeat, local job lifecycle, bin creation/import, results, retry, and version compatibility.
- Add installer/instructions and XML/path fallback.
- Add confirmed activity writes.

Exit: an editor can install once, open Vault and Premiere, then send a bin with one click and receive an accurate receipt.

### Phase 4 — Resolve production integration

- Package scripting adapter.
- Add diagnostics and preference guidance.
- Implement bin/import/result flow and activity writes.
- Test supported Resolve editions and versions.

Exit: the same Vault bin workflow works in Resolve with equivalent feedback.

### Phase 5 — Windows distribution and hardening

- Package WebView shell, backend runtime, frontend, integrations, and optional FFmpeg.
- Produce installer/uninstaller and version metadata.
- Test fresh install, upgrade, repair, read-only share, disconnected share, cache recovery, and uninstall.
- Performance test search and previews against the real catalog and multiple workstations.

Exit: non-technical team members can install and operate Vault from the shared installer without a terminal.

## 15. Acceptance criteria

### Source-media safety

- No standard Vault operation moves, renames, edits, transcodes, or deletes a source clip.
- Editor bins reference the original configured B-roll paths.
- Preview derivatives are clearly separated into a disposable cache.

### Setup

- A clean Windows user can install and configure Vault without opening the repository.
- Setup detects the catalog or provides a clear locate/build choice.
- Folder permissions are tested before setup completes.
- Primary editor and preview policy can be changed later.

### Catalog

- An unchanged local mirror opens without recopying the shared database.
- A changed catalog refreshes safely without leaving a partial mirror.
- A temporarily unavailable share produces a useful degraded state.

### Bins and activity

- Bins contain clip references only and are visible from a second configured workstation.
- Simultaneous bin changes cannot silently overwrite each other.
- Recently Used is written only after editor confirmation.
- Users can exclude footage used within 7, 30, or 90 days.
- Windows identity can be displayed or omitted without affecting functionality.

### Premiere

- The plugin reports active connection and project.
- Send creates/fetches the intended bin and imports valid source paths.
- Partial failures are itemized.
- Disconnects do not produce false success activity.

### Resolve

- Vault detects the active Resolve project.
- Send creates/fetches the intended Media Pool bin and imports valid paths.
- Missing scripting access produces actionable setup guidance.

### UX and accessibility

- Onboarding animations remain responsive and never block progress.
- Reduced-motion mode is complete.
- Keyboard navigation and WCAG 2.1 AA expectations from the Vault design system remain intact.
- No success, failure, ownership, or connection state relies on color alone.

## 16. Test matrix

- Fresh Windows profile, normal user permissions.
- B-roll root accessible and writable metadata folder.
- B-roll root readable but metadata folder not writable.
- B-roll share disconnected at startup and disconnected mid-session.
- Catalog unchanged, updated, missing, invalid, and mid-refresh.
- FFmpeg present, absent, and unable to decode a source codec.
- Premiere closed, open without project, supported version, unsupported version, plugin missing, plugin outdated, and plugin disconnect during import.
- Resolve closed, open without project, scripting disabled, Studio-supported configuration, and failed import.
- Duplicate source already present in editor project.
- One missing clip among a valid bin.
- Two workstations creating bins simultaneously.
- Two workstations sending overlapping clip sets simultaneously.
- Windows username with spaces or non-ASCII characters.
- Reduced motion enabled.
- Upgrade and uninstall with shared metadata present.

## 17. Remaining product decisions

These decisions do not block the technical spike, but should be confirmed before Phase 1 is finalized:

1. Should all bins be team-visible by default, or should the UI start on “My bins” while still allowing shared access?
2. Should Windows username be recorded in shared activity by default, or should setup offer an attribution toggle?
3. What does “recent” mean as the default quick filter: 30 days is recommended, with 7/90-day alternatives.
4. Should local hover-preview cache have a default maximum size? A bounded cache is recommended; the exact default should be tested against real usage.
5. Are all Premiere users on version 25.6 or newer, and are Resolve users licensed for Resolve Studio where external scripting is supported?

## 18. Recommended immediate next step

Build Phase 0 as an isolated proof before packaging work:

- A minimal Premiere panel connects to the current local API and imports five selected catalog paths into a named bin.
- A minimal Resolve script imports the same five paths into a named Media Pool bin.
- Neither path writes activity yet.

This proves the editor boundary—the highest-risk part—while reusing the working catalog, search, preview, and bin foundations already present.

## 19. Implementation progress — 2026-09-10

Phase 0 has started. The opt-in local transport, Premiere UXP panel, Resolve adapter, manual driver, and automated fixture tests are implemented. See [Phase 0 runbook and plan review](integrations/editor_spike/README.md) for setup, validation, limitations, and the decisions needed before Phase 1.

The spike does not write activity or alter source media. The existing frontend Send to Premiere workflow is not yet connected to it. Live editor/UNC imports and team version compatibility remain unverified; **Phase 0's exit criterion is not yet met**. Packaging and Phase 1 storage migration have not started.

### Desktop foundation — 2026-09-11

User direction advances privacy, setup, publishing and updates ahead of live editor testing. The application now starts without a predefined library, validates user-selected catalog/cache paths and saves settings in local application data. Local sessions protect frontend/API/media access; shared catalog writes are disabled. Local bins and cache are separated by configured library.

A WebView2 desktop host, per-user Inno Setup installer and GitHub release build workflow have been added. The bell checks public releases and opens Download/Learn more on the release page. A normal interactive installer update closes the old application and launches the updated version; no background installation is performed. Existing settings and library data are preserved.

Historical notes, obsolete server snapshots, runtime data and build outputs are excluded from publication. A tracked-file publication scan guards against common credential formats and private workstation paths. Public release metadata is the only update-check payload; library/user metadata is not transmitted.

Remaining testing includes fresh install, interactive update/relaunch, unavailable shares and live Premiere/Resolve imports. Shared bin/activity storage, the full editor connection wizard and installer signing remain future work.
