---
name: Vault
description: Cool navy ground, warm cream ink, teal for the machine and ember for the human. Rounded, roomy, and quiet — a footage catalog you can actually look at.

# OKLCH is normative. The hex values in the prose below are the sRGB rendering
# of these tokens and are informational only. Every foreground/background pair
# in this file was verified by computation. Re-run that check before changing
# any surface or ink value.
colors:
  # Surfaces — cool navy, layered tonally. No surface uses a shadow.
  abyss: "oklch(24% 0.035 250)"          # deepest: thumbnail wells, peek scrim
  ground: "oklch(30% 0.040 250)"         # page ground, inputs, inset rows
  panel: "oklch(35% 0.042 250)"          # cards, rails, the raised plane
  raised: "oklch(41% 0.045 250)"         # row hover, pressed controls
  edge: "oklch(48% 0.045 250)"           # empty meter segments, scrollbar thumb
  edge-hi: "oklch(58% 0.045 250)"        # control outlines

  # Ink — warm. This inversion is the whole personality: cool ground, warm text.
  cream: "oklch(95% 0.030 85)"           # headings, clip names, emphasis
  linen: "oklch(89% 0.024 85)"           # body, row text
  linen-2: "oklch(80% 0.020 85)"         # secondary
  linen-3: "oklch(75% 0.018 85)"         # metadata, paths, counts
  muted: "oklch(58% 0.020 250)"          # disabled — documented AA exemption

  # Machine vocabulary — cool. Everything the scorer produced.
  teal: "oklch(76% 0.105 205)"           # fills, meters, selection edge, focus ring
  teal-hi: "oklch(84% 0.100 200)"        # teal as text
  teal-dim: "oklch(56% 0.070 205)"
  teal-wash: "oklch(40% 0.060 205)"      # selected row ground
  slate: "oklch(80% 0.026 250)"          # low scorer confidence — deliberately colorless

  # Human vocabulary — warm. Your marks, and anything waiting on you.
  ember: "oklch(72% 0.155 47)"           # fills, your ratings, coverage gaps
  ember-hi: "oklch(82% 0.130 58)"        # ember as text
  ember-dim: "oklch(52% 0.090 47)"       # unfilled coverage, empty-state outlines
  ember-wash: "oklch(38% 0.070 45)"      # your-row ground, notices

  # Broken only. Never a low score.
  coral: "oklch(73% 0.155 25)"
  coral-hi: "oklch(82% 0.115 27)"

typography:
  display:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  row:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.84375rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  label:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.65625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.07em"
  data:
    fontFamily: "Martian Mono, ui-monospace, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.02em"
    fontFeature: "tnum 1"

rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  pill: "999px"

spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"

components:
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.xl}"
    padding: "20px"
  row:
    backgroundColor: "transparent"
    textColor: "{colors.linen}"
    typography: "{typography.row}"
    rounded: "{rounded.lg}"
    height: "56px"
    padding: "0 12px"
  row-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.cream}"
  row-selected:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.cream}"
  row-mine:
    backgroundColor: "oklch(33% 0.032 45)"   # a whisper of ember; the full wash read as an alert
    textColor: "{colors.cream}"
  search:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    height: "42px"
    padding: "0 20px 0 42px"
  button-warm:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.abyss}"
    rounded: "{rounded.pill}"
    height: "42px"
    padding: "0 20px"
  button-quiet:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.linen-2}"
    rounded: "{rounded.pill}"
    height: "42px"
    padding: "0 20px"
  chip-cool:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  chip-warm:
    backgroundColor: "{colors.ember-wash}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  thumbnail:
    backgroundColor: "{colors.abyss}"
    rounded: "{rounded.md}"
    width: "74px"
---

# Design System: Vault

## Overview

Cool navy ground, warm cream ink, rounded everything. The room is dim and the interface is calm in it; the warmth comes from the type and from a single orange that only ever means *a human is involved*.

This replaces an earlier all-graphite version that was correct on paper and cold on screen. The diagnosis is worth keeping because it generalizes: that build put neutral gray-white text on a warm gray ground, which reads as a log file no matter how good the spacing is. **Warm ink on a cool ground is the entire personality.** Invert it and this system dies.

Three commitments carry the rest:

- **Cool is the machine, warm is you.** Teal marks everything the scorer produced — readings, confidence, selection, actions. Ember marks everything that is yours or wants you — your overrides, unrated clips, missing coverage, gaps. The user can always tell, without clicking, whose judgment they're looking at. This is the design's one big idea and everything else defers to it.
- **Frames are visible by default.** This is a footage catalog. A row without a picture is a database record, and the previous version's biggest failure was that clips had no image until you hovered them. Every row carries a rounded 16:10 still.
- **Rounded and roomy, still dense.** 10–18px radii, real gaps between rows, 14px body. Density lives in the density switch, not in the default. Three levels, and even Compact keeps the frame.

## Colors

### The governing rule

| Origin | Vocabulary | Applies to |
|---|---|---|
| Scorer / pipeline | `teal` family, `slate` for low confidence | quality readings, confidence, presence, selection, primary actions |
| Person | `ember` family | your ratings and overrides, highlights, unrated clips, missing thumbnails, coverage gaps, pending review |
| Neither | `coral` | genuinely broken only: offline media, failed write, scorer error |

A rating you changed keeps ember for the life of the override — ember meter, a "Yours" pill, and a faint ember tint on the row. *(The full `ember-wash` row ground was tried and read as an alert rather than as ownership; the tint is deliberately quiet and the meter carries the meaning.)* The scorer's original reading stays visible underneath it in the detail panel so you can always see what it thought, and revert.

Note the useful widening: ember covers both "you did this" and "this is waiting on you." Both are the human's side of the line, and unifying them means the warm color is always answering the same question — *where do I come in?* The "Needs you" filter group is the direct expression of that.

### Surfaces

Tonal layering. No surface uses a shadow; elevation is a lightness step plus a radius.

| Token | sRGB | Use |
|---|---|---|
| `abyss` | `#12202f` | thumbnail wells, peek scrim |
| `ground` | `#1e2f41` | page ground, inputs, inset table rows |
| `panel` | `#293c50` | cards, rails — the raised plane the app lives on |
| `raised` | `#384c62` | row hover, pressed controls |
| `edge` | `#4a6076` | empty meter segments, scrollbar thumb |
| `edge-hi` | `#667d94` | control outlines |

### Ink

| Token | sRGB | On `ground` | Use |
|---|---|---|---|
| `cream` | `#f8edd8` | 11.8:1 | headings, clip names, the number that matters |
| `linen` | `#e2dac9` | 9.8:1 | body, row text |
| `linen-2` | `#c4bdb0` | 7.3:1 | secondary |
| `linen-3` | `#b3ada1` | 6.1:1 | metadata, paths, counts |
| `muted` | `#727c86` | 3.2:1 | **documented AA exemption.** Disabled controls only, never content |

Every ink above `muted` clears 4.5:1 on `ground` and `panel`. On `raised` — which is only ever the hover state — `linen-3` lands at 3.95:1, so **hover promotes ink one step**: `linen-3` becomes `linen-2`, and status colors go to their `-hi` variant. That rule is load-bearing, not decorative; without it the hover state fails AA on metadata.

### Accents

| Token | sRGB | Meaning |
|---|---|---|
| `teal` | `#4fc4d1` | machine fills, meters, selection edge, focus ring |
| `teal-hi` | `#72dee4` | teal used as text (the fill value is too dark for body copy) |
| `ember` | `#f18246` | human fills, your ratings, coverage gaps |
| `ember-hi` | `#ffb072` | ember used as text |
| `slate` | `#b2bfce` | low scorer confidence — colorless on purpose. An unsure reading should look unsure, and draining chroma says that better than a badge |
| `coral` | `#fa7c75` | broken. Never a low score |

### Color rules

- **Every chromatic accent has a fill value and a text value.** `teal` and `ember` pass 3:1 as marks but not 4.5:1 as body text; `teal-hi` and `ember-hi` exist for that. Using a fill token as text is a bug.
- Low quality is **not** red. A 2-star clip is a reading; red means the file is broken. Confusing them teaches the user to distrust the whole color system.
- Color is never the only code. Every reading carries a numeral, glyph, or word beside it.
- Inactive and disabled states go neutral, never a dimmed accent. A 40%-opacity teal is still teal and still pulls the eye.
- Don't cool the ink or warm the surfaces. The cool/warm inversion is the system.

## Typography

`Figtree` (SIL OFL, variable) for everything in the UI; `Martian Mono` (SIL OFL) for measured values only — timecode, duration, resolution, path, clip ID, counts. Monospace is doing its real job here, not wearing a costume for "technical."

Self-hosted variable WOFF2, Latin subset, `font-display: swap`, weights 400/500/600/700 only.

### Scale

Fixed rem, never fluid. Users view at a consistent DPI and a heading that shrinks inside a rail looks broken, not responsive.

| Role | Size | Weight | Use |
|---|---|---|---|
| `display` | 28px | 700 | the year, on a year page |
| `headline` | 17px | 600 | card titles |
| `title` | 15px | 600 | panel titles, detail clip name |
| `body` | 14px | 400 | prose, controls |
| `row` | 13.5px | 500 | clip names in the ledger |
| `label` | 10.5px | 600, +0.07em, caps | column headers, group labels |
| `data` | 11px | 400, `tnum` | anything measured |

### Rules

- **Tabular figures on anything that can change.** A scrolling column of proportional numerals jitters and reads as instability.
- Prose stays 45–75ch. Rows and tables are exempt.
- Light-on-dark: a touch more line-height than the same face takes on white. Do not also raise weight — Figtree 400 holds up on this ground.
- Clip names truncate with ellipsis but always expose the full value: `title` attribute at minimum, full string in the detail panel and peek.
- Paths sit under the name as a `data`-styled subtitle rather than in their own column. Two lines per row buys back a whole column of width and reads faster.

## Layout

Regions float as rounded cards on the ground with a 16px gutter. Nothing is flush to the window edge.

- **Top bar.** Brand, the search pill (centered, always visible, focused on load), density, Bins.
- **Filter bar**, full width, `panel`. Category tabs — Campus · Ministry · Stars · Year · Needs you — and the open category unrolls a row of pill chips beneath. Campus and Ministry chips are tri-state, the Artlist move: click to include, `−` to exclude, click again to clear. The "Needs you" chips are the ember group — the only warm controls, and they earn it. *(Replaced the 248px left rail on 2026-09-01: chips read faster than a stack of checkboxes and give the ledger the full width, which is the point of "the list is the product".)*
- **Main**, fluid. Filter bar, coverage card, then the ledger card which takes the remaining height.
- **Detail**, 316px, `panel`. Large frame, name, your rating, and the facts. Hidden below 1500px.
- **Bins**, 300px, `panel`, toggled from the top bar. Saved sets of clips, with export.

Search is always visible and takes focus on load. The most common visit is a search; the interface should already be waiting for it.

### The year overview

A sortable table, not stat cards and not a chart row. Bars are drawn inside their cell. The coverage bar's **track is `ember-dim` and its fill is `teal`** — so the unfilled portion is literally the warm "what's missing," and you read the gap rather than the achievement. Any column sorts; the coverage bars make the holes visible without re-sorting.

Every row links into a filtered ledger. Roughly 230px of vertical space, against the 400px a chart row would take. **Default order is newest year first** — the archive is read from now backwards — and years past the current one (path-parsing junk) are not shown.

### Spacing and density

4px base: 4, 8, 12, 16, 20, 24, 32. Tight within a group, generous between groups; more space above a heading than below it.

| Level | Row height | Thumb |
|---|---|---|
| Compact | 42px | 58px |
| Default | 56px | 74px |
| Roomy | 72px | 96px |

Type size holds across all three. Shrinking text is how density becomes illegibility.

### Responsive

Structural. Detail panel drops at 1500px, rail at 1080px, then the scorer-notes column. The frame, quality reading, and clip name never drop.

## Elevation & Depth

Surfaces are separated by lightness and radius, not shadow. Cards carry a 1px inset highlight (`--lift`) that reads as a lit top edge — enough to lift them off the ground without a drop shadow.

Real shadows exist for three things only, because they genuinely float: the peek overlay, popovers and dropdowns, and the command palette.

```
--float: 0 10px 30px -8px oklch(14% 0.03 250 / 0.65),
         0 3px 8px -2px  oklch(14% 0.03 250 / 0.45);
```

**Declare elevation once — border or shadow, never both.** A 1px border under a soft shadow is the ghost card.

Overlays must escape their container: use the popover API, `<dialog>`, or a portal. An absolutely positioned dropdown inside the scrolling ledger gets clipped.

## Shapes

Rounded is a commitment here, not a garnish.

| Token | Value | Use |
|---|---|---|
| `sm` | 6px | checkboxes, small tags, meter segments |
| `md` | 10px | thumbnails, buttons in dense contexts, table row ends |
| `lg` | 14px | ledger rows, notices, inner panels |
| `xl` | 18px | the top-level cards |
| `pill` | 999px | search field, buttons, chips, status pills, bars |

Selection is a 3px pill-capped bar inset at the row's left edge — the one legitimate colored left edge, because it marks selection rather than category. Everywhere else, a colored left border above 1px is banned.

Borders are 1px (1.5px on small controls where 1px disappears). Never a border and a shadow on the same element.

## Components

### Ledger row

Grid: **frame · quality meter · name over path · scorer notes · length · status.** Rounded 14px band with a 3px gap below it, no rules, no card.

The quality meter is five rounded segments plus the numeral. Teal when the scorer rated it, `slate` when confidence is low, ember when you overrode it, and hollow with an ember-dim outline when unrated. Unrated shows `–`, never `0`.

**Star filter vocabulary.** The default is *Usable*: 3★ and up **plus unscored** — most of the archive hasn't been scored yet and hiding it would hide the archive. There is no "2★ and up": anything below 3★ is a *Review for deletion* bucket, shown only when asked for. A star minimum never includes unscored clips.

Seven states required before this ships: default, hover (`raised`, ink promoted), focus (2px teal ring, 2px offset), selected (`teal-wash` + teal edge), yours (`ember-wash` + ember edge), loading (skeleton bands at `ground`, never a spinner), and offline (name recedes to `linen-3`, coral status pill).

### Thumbnail

74px at default, 16:10, 10px radius, `abyss` well. Missing thumbnails render as a `ground` tile with an ember-dim outline and an ember slash-frame glyph — a state, not a broken image. Offline media uses the same tile with a coral outline.

### Preview

Hover with a ~180ms dwell shows the still immediately and swaps to motion when ffmpeg returns; a cold clip stays on the still rather than stalling. No dwell means no request — a cursor crossing forty rows must not queue forty jobs against network storage.

`Space` opens the peek: large centered frame on an `abyss` scrim, arrow keys walk to adjacent clips with it open, `1`–`5` rates in place, `Esc` closes.

### Star editor

Five 34px buttons in the detail panel, and `1`–`5` on a focused row. Writes optimistically, then reconciles against the response. The scorer's original reading and confidence stay visible beneath, with a revert. Every write shows its result — success is a brief ember pulse on the row; failure surfaces the real error and leaves the old value in place. Never silently discard an edit.

### Empty states

Three, and they are not interchangeable:

- **No results for these filters** — name the active filters, offer to clear the narrowest.
- **This year has nothing catalogued** — a coverage gap, not a search failure. Link to folder diagnostics.
- **Nothing indexed yet** — teach the pipeline, don't apologize.

None of them say "Nothing here."

### Browser surfaces

Themed from the palette, because the parts nobody draws still carry the design: selection (`teal-wash` on `cream`), caret (`teal`), placeholders (`linen-3`), scrollbars (transparent track, `edge` pill thumb inset from the edge), focus ring (2px `teal`, 2px offset), `::marker`, autofill, and `tabular-nums` on every numeric cell.

## Do's and Don'ts

### Do

- Keep warm ink on cool ground. It is the design.
- Give every chromatic accent a fill value and a text value, and use the right one.
- Show the frame. Every row, every density.
- Let ember answer one question: where does the human come in?
- Promote ink one step on hover.
- Use tabular figures on anything that changes.
- Round everything, including the small stuff — meter segments, checkboxes, bar caps.
- Verify contrast by computation on every new pairing.
- Keep motion at 150–260ms, carrying state only.

### Don't

- Don't put neutral gray text on these surfaces. That is the previous version's failure, exactly.
- Don't use red for a low score. Amber-adjacent warmth means human; red means broken.
- Don't spend ember on decoration. Every warm mark must mean something.
- Don't fire previews on hover without the dwell.
- Don't add stat cards above the search field.
- Don't glow. No zero-offset colored halos, no gradient text, no glass as decoration.
- Don't ship a spinner where a skeleton belongs.
- Don't animate on page load. The user came to work.
- Don't reinvent standard affordances — scrollbars, selects, and checkboxes get themed, not replaced.
- Don't let a rating write fail silently.
