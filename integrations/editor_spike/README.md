# Vault desktop — Phase 0 spike

Status: implemented and tested with fixtures; **live Premiere/Resolve import proof is still pending**.
This is a developer spike, not the Windows installer or production editor integration.

## What is included

- Opt-in `/api/spike/*` POST routes on the existing loopback backend.
- Per-launch token pairing, catalog-ID lookup, containment/reachability checks, and a maximum of five clips per job.
- Editor heartbeat, explicit project targeting, single claim, expiry, and idempotent per-item receipts.
- Premiere UXP panel and Resolve Studio scripting adapter.
- A manual driver for reviewing the active project and queuing the same IDs to both editors.

The spike keeps its queue and token in process memory. It writes no activity, shared bins, or source media. It does not create sequences, save projects, generate previews, or copy footage. Existing catalog frontend workflows remain separate: its old Send to Premiere button still uses the old optional HTTP bridge, not this spike.

## Run the backend

From the repository root, in PowerShell:

```powershell
$env:BROLL_EDITOR_SPIKE = '1'
$env:BROLL_CATALOG_PORT = '8010'
python broll_catalog_backend/server_api.py
```

Complete first-run setup in the opened Vault window to choose the library and catalog. Library path environment overrides are no longer used. If another backend owns port 8010, stop that instance before starting the spike. Copy the **Phase 0 pairing token** printed at startup. Enter it into the panel and driver when prompted; it changes on backend restart. Never put the token into source files or shared metadata. This manual pairing is temporary until the desktop shell provides a proper pairing flow.

The catalog mirror must finish loading before queuing clips. This reuses the local mirror. Configuration and cache location are supplied by first-run setup; shared bin storage remains a later phase.

## Premiere

1. Open Premiere 25.6 or newer and a disposable test project.
2. In Adobe UXP Developer Tools, enable developer mode if required, add `integrations/premiere_spike/manifest.json`, and load it into Premiere.
3. Open **B-roll Vault Phase 0** from Premiere's UXP plugins menu.
4. Enter the runtime token and click **Connect / retry**. Keep the panel visible. It should show the active project name.
5. Use the driver below to queue clips. The panel will create `B-roll Vault/<bin name>` and display one result per catalog ID.

The manifest requests only networking to `http://127.0.0.1:8010`; no filesystem or process-launch permission is requested. Whether UNC imports need additional host permission is part of the live proof. No `.ccx` has been packaged yet. HTTP localhost behavior must also be verified on the actual Premiere build. The endpoint rejects browser Origin headers; if UXP supplies an Origin, record the exact value and review an explicit allowlist before changing this boundary.

## Resolve

Open Resolve Studio and a disposable test project. Check **Preferences > System > General > External scripting using > Local** if external scripting is unavailable. Then run:

```powershell
python integrations/editor_spike/resolve_adapter.py --diagnose
python integrations/editor_spike/resolve_adapter.py
```

The second command prompts for the runtime token and stays connected until Ctrl+C. It uses the standard Windows Resolve module location. A custom installation/module location is not handled in this spike.

This workstation's installed `fusionscript.dll` terminated Python 3.10 with native exit code `0xC0000005` when Resolve was closed. The adapter now checks that `Resolve.exe` is running before loading it. If native loading fails while Resolve is running, capture the interpreter/Resolve versions and exit code; keep native integration in a separate process for the desktop application.

## Queue and inspect the same bin

Choose up to five IDs from the catalog. The numbers below are examples; replace them with actual chosen clip IDs. Each driver invocation asks for the runtime token.

```powershell
python integrations/editor_spike/client.py status
python integrations/editor_spike/client.py send --editor premiere --ids 108 391 882 --bin 'Vault Phase 0'
python integrations/editor_spike/client.py send --editor resolve --ids 108 391 882 --bin 'Vault Phase 0'
python integrations/editor_spike/client.py status
```

The driver displays the active project and asks for `SEND` before queueing. Review each receipt's item statuses; `completed` means a receipt was received, **not** that every item succeeded. Missing sources remain itemized; out-of-root paths and unknown IDs reject the job. Duplicate detection is within the target editor bin only. Media already elsewhere in the project is not moved.

Heartbeats expire after 15 seconds; jobs expire after five minutes. Only one job can be claimed per editor at a time. Lost receipt responses are retried without re-running imports. Expired or abandoned claims are never automatically requeued: inspect the target bin before manually sending again. A backend or adapter restart loses in-memory state; inspect the editor before retrying. Clock fields in status are process-relative values, not calendar timestamps.

## Validation

```powershell
python -m unittest discover -s broll_catalog_backend/tests -v
python -m unittest discover -s integrations/editor_spike -v
node --test integrations/premiere_spike/importer.test.cjs
```

These tests use temporary files and simulated editor APIs. The backend suite exercises the real HTTP handler with a fixture catalog lookup, including token/Host/Origin enforcement. They do not establish real UXP or Resolve compatibility.

2026-09-10 verification: **17 tests passed** (10 backend, 3 Resolve, 4 Premiere); Python compilation and panel JavaScript syntax checks passed. `npm run build` passed after fixing two existing TypeScript errors (unused seed argument and an unchecked format value). The format list now copies facet data before appending selected values. Existing npm/Node compatibility and CSS import-order warnings remain for later frontend/toolchain cleanup.

### Workstation proof checklist

- Record editor version, Resolve edition, Python version, UXP Developer Tools version, and selected catalog IDs.
- Both editors receive the same five original UNC paths in the named bin; verify paths in each editor.
- Send again and verify target-bin duplicates are reported as existing.
- Include one missing source; valid items still succeed and missing items are listed.
- Test closed editor, no project, changed project, panel disconnect, failed import, and expired receipt.
- Verify no source files or shared activity changed; no sequence was created.
- Record evidence here before marking Phase 0 complete in the main plan.

Observed on 2026-09-10: Premiere executable **26.3.0**; Resolve executable **20.3.2.9**; neither editor running. Resolve Studio licensing has not been verified. Closed-Resolve diagnostic now exits with an actionable message instead of loading the crashing library.

## Plan review: decisions before Phase 1

1. **Bin updates need more than atomic rename.** Revision check followed by rename has a check/write race between workstations. Choose a tested SMB-compatible lock or an append-only revision protocol with explicit conflict resolution.
2. **References need a library identity.** Numeric clip IDs alone can point at different footage after changing/rebuilding catalogs. Add a persistent catalog/library ID to bins, activity, mirror metadata and jobs before sharing them.
3. **Desktop/plugin pairing needs a bootstrap design.** A random token is appropriate, but plugins must discover it without an unauthenticated token endpoint. Define pairing, token rotation and endpoint/port discovery during the editor proof.
4. **Current code still differs from desktop safety requirements.** The desktop foundation now disables shared rating writes, authenticates local routes, and stores configuration/cache in local application data. Shared bins and immutable activity remain to be implemented.
5. **Catalog refresh needs a coherent SQLite snapshot.** Validate offline startup and background replacement against Windows file locking and SQLite/WAL behavior. A database size/mtime alone is insufficient if catalog writers leave changes in WAL files; establish the publisher's checkpoint/snapshot contract.

The product defaults in section 17 can stay provisional during Phase 0. Editor compatibility and the live UNC boundary remain the release gate.

## API references

- [Adobe Project API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project): active project, transactions and `importFiles`.
- [Adobe FolderItem API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/folderitem): bin actions and child enumeration.
- [Adobe ClipProjectItem API](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem): source path and offline checks.
- [Adobe network recipe](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network/): explicit network permissions.
- Resolve's installed vendor reference: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\README.txt` (local copy dated 7 Oct 2025).
