# gpt-image prompt specs — validator workflow

Every new/changed visual asset (widget, overlay, dashboard, touch panel) is produced with this flow:

1. **Draft the prompt in American English.** All gpt-image prompts MUST be written in US English.
2. **Validate the prompt (this gate) BEFORE generating.** The prompt only passes if it fully specifies every item
   in the checklist below. If anything is missing/ambiguous, rewrite until it does.
3. **Generate the reference** with the motorsport gpt-image tool (`size:1536x1024 quality:high`), save to `../refs/`.
4. **QA the image** — does it truly represent the asset, cleanly? If not, regenerate.
5. **Build** the component to match the reference.
6. **Visual QA vs the reference until clean** — nothing too small, overflowing, or overlapping; honor the clean rules.

## Prompt validator checklist (all boxes must be satisfiable from the prompt text)
- [ ] **Subject & purpose** — what the asset is and the single (or same-category) information it shows.
- [ ] **Exact data/values** — the concrete readouts and their sample values (e.g. `P4 / 24`, `-1.42s`, `88°C`).
- [ ] **Layout & sizing** — placement, relative sizes, what is dominant; nothing cramped.
- [ ] **Car/series theme** — when themed (Le Mans, WEC, GT3 Cup, Ferrari 488/296, Aston Martin GT3, AMG One / GT Track
      Series, Porsche GT3 Cup, Mustang GTD, Corvette Z06 GT3.R, Huracán GT3): the fonts, LED/tell-tale style, palette.
- [ ] **Color rules / conditional color** — warm = chrome/alert, cool/green = genuinely good; and any state colors
      (e.g. gap turning green when gaining, red when losing).
- [ ] **AVOID list (clean rules)** — explicitly state: NO title/label text (self-explanatory values only),
      TRANSPARENT background, NO borders/frames (hairline only if it truly aids reading), no clipping, no overlap.
- [ ] **Aspect/format** — target box aspect (e.g. wide LED strip, square corner, full 1024×600 dashboard).

## Per-asset spec template (copy per asset, filename = asset id)
```
# <asset-id>  (widget|overlay|dashboard|touch)
Reference: refs/<file>.png

## American-English prompt
<the exact prompt sent to gpt-image>

## Checklist notes
- Subject: ...
- Data/values: ...
- Layout/sizing: ...
- Theme: ...
- Color rules: ...
- AVOID: no titles; transparent bg; no borders; no clipping/overlap.

## QA outcome
- Image QA: pass/regens
- Build QA vs ref: pass (nothing small/overflow/overlap; clean rules honored)
```
