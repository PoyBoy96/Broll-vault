# B-roll Vault — frontend

Vite + React + TypeScript. Dark only. Design system in `../DESIGN.md` (binding).

## Run

Build with `npm ci` and `npm run build` in this directory. From the repository root, run `python desktop/main.py` or `python broll_catalog_backend/server_api.py`. The latter opens a browser with a local authenticated session. Configure your paths on first launch. See the root README for details.

## What's where

| Path | What |
|---|---|
| `src/App.tsx` | state, keyboard, data loading, the shell |
| `src/components/FilterBar.tsx` | Campus / Ministry / Stars / Year / Needs-you chips (include `+`, exclude `−`) |
| `src/components/YearTable.tsx` | coverage table, newest year first, sortable |
| `src/components/Ledger.tsx` + `ClipRow.tsx` | virtualised list; pages load as you scroll |
| `src/components/Thumb.tsx` | the frame: catalog thumb → ffmpeg frame grab → ember "missing" tile |
| `src/components/Detail.tsx` | right panel: big frame, star editor, facts, add-to-bin |
| `src/components/Peek.tsx` | `Space` overlay; arrows walk, `1–5` rate |
| `src/components/BinsPanel.tsx` | saved bins: open, rename, XML export, copy paths, Premiere bridge |
| `src/hooks/usePreview.ts` | hover-with-dwell preview (180 ms), session cache |
| `src/state/filters.ts` | filters ⇄ URL. The address bar is the app's memory |
| `src/api/` | typed client; one error envelope |
| `src/styles/tokens.css` | generated from DESIGN.md — don't hand-edit colours |
| `public/fonts/` | Figtree + Martian Mono, self-hosted, SIL OFL |

## Keys

`/` search · `↑ ↓` (or `j k`) move · `Space` / `Enter` peek · `1–5` rate · `x` check · `B` new bin from checked (or the focused clip) · `Esc` clear / close.

Click a row to select it; double-click to peek. Shift-click checkboxes for a range.

## Filters

- **Campus** and **Ministry** chips are tri-state: click to include, hover and press `−` to exclude, click again to clear. Ministry is the folder inside the year folder (`LOCATION\2025\M1\…` → `M1`).
- **Stars** defaults to *Usable* = 3★ and up **plus unscored** (the scorer hasn't got to most of the archive yet). *Review for deletion* is the 1–2★ bucket; it's hidden from every other mode on purpose.
- **Needs you** is the ember group: things waiting on a human.
- Coverage rows are clickable — one click filters to that year, ctrl/shift-click adds years.

## Bins

A bin is a saved set of clips. From the Bins panel:

- **Download XML** → in Premiere, `File › Import` the `.xml`; it creates a bin with those clips linked to the originals on the share.
- **Copy paths** → paste into any import dialog.
- **Send to Premiere** appears only when `BROLL_PREMIERE_BRIDGE_URL` is configured for the API.

Bins persist under local application data, separately for each configured library. Shared bins are planned.
