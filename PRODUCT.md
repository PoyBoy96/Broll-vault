# Product

## Register

Operate — the user is mid-task. Design serves the work and then gets out of the way.

## Users

One primary user: a video editor and archivist who owns a large B-roll library and needs to know what's in it, what's good, what's missing, and what the automated scorer got wrong. They work in a dim edit bay with Premiere open on another display. They are fluent in footage, timecode, codecs, and folder conventions — they do not need the interface to explain what a proxy is.

They arrive at this tool in one of three states, and the interface has to serve all three without asking which:

1. **Looking for something specific.** "I need a wide of the plant exterior, 2024 or newer, that doesn't look terrible." Search, rank, preview, done. This is the most frequent visit and it should be the fastest path.
2. **Auditing coverage.** "What years are thin? Which folders never got thumbnails?" Reading the shape of the archive, not any single clip.
3. **Correcting the machine.** "The scorer called this 2-star and it's the best shot in the folder." Overriding a rating, marking a highlight, fixing a status — without touching the source media.

## Product purpose

Turn a large, opaque folder tree of B-roll into a catalog its owner can actually search, judge, and trust. Success is: the clip you need is on screen in under ten seconds, and a quality reading you disagree with takes one keystroke to fix.

Two things this product is not. It is not a media manager — it never moves, renames, or transcodes source files. And it is not an authority — the scorer's ratings are readings, not verdicts, and the interface must always make the human's override feel like the more important number.

## Brand personality

Techy, friendly, helpful — sourced from the studio's robot character, whose brand this inherits without ever depicting him. The useful reading of that character is not his glow; it's that he's a **well-made machined object**: solid, warm-toned, unintimidating, clearly built by someone who cared. That's the register.

Three words: **precise, warm, unhurried.**

Friendliness here is structural, not conversational. It shows up as generous hit targets, plain labels, states that tell you what happened, and never punishing the user for the archive's mess. It does not show up as jokes, mascots, or chatty microcopy on screens you stare at for hours.

## Anti-references

- **Neon-on-black tech dashboard.** Cyan glow, purple gradients, glassmorphism, glowing edges. This is where the source character drags every generated interface, and it's the single most saturated look in this category. The character's palette is welcome; his lighting is not.
- **Premiere panel cosplay.** Copying the NLE's chrome makes this look like a plugin instead of a peer tool. It shares Premiere's screen; it should not share its skin.
- **Stat-card dashboards.** Rows of big-number tiles above the thing the user actually came to do. Coverage numbers belong inside the table that lets you act on them.
- **Cards as page structure.** Same-size boxes of thumbnail-plus-title-plus-meta. This is a ledger; density is the feature.
- **Ratings presented as verdicts.** Red for a low score. Red means broken, not mediocre. A 2-star clip is a reading, and confusing the two teaches the user to distrust the color system.

## Design principles

1. **The list is the product.** Everything above, beside, or on top of the clip list is overhead and must justify its pixels. When in doubt, give the space back to rows.
2. **Available, not shouting.** Every fact the user might need is on screen or one keystroke away, and nothing competes for attention with the thing they're looking for. Recessive by default, legible on demand.
3. **The machine and the human speak in different colors.** Automated readings and human marks are never rendered in the same vocabulary. The user must always be able to tell, without clicking, which is which.
4. **Density is not clutter.** Clutter is undifferentiated weight. A thousand rows with clear hierarchy is calm; twelve cards with equal emphasis is noise.
5. **Nothing is destructive.** No action in this interface can alter source media. Overrides are additive and reversible, and the interface should feel safe enough to click around in.

## Accessibility & inclusion

Baseline WCAG 2.1 AA, verified by computation rather than eye.

- All body text ≥4.5:1, all controls, icons, and focus indicators ≥3:1, checked against every surface a token can land on. Disabled text is a deliberate documented exemption.
- Quality, status, and presence are never communicated by color alone — each carries a numeral, glyph, or label.
- Full keyboard path for the primary loop: search, move through rows, preview, rate, override. This is a power-user tool and the mouse should be optional.
- `prefers-reduced-motion` respected; the peek overlay and row transitions degrade to instant.
- Dark theme only, chosen from the use scene (dim edit bay, footage thumbnails needing a neutral surround), not from category habit. If a light theme is ever needed it gets composed, not inverted.
