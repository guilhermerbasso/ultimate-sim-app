## Plan v5 — real-dash car themes + 100 new iRacing widgets (+ CI/release fixes)

This PR is the consolidated v5 work. It **opens early** (with the CI/Node-24 fix, README and release-notes updates) and will **grow as the image-driven build waves land** on this branch. Please review; **I will not merge** — you merge after review.

### Included now
- **CI → Node 24** (fixes the deprecation warning): `actions/checkout@v4→v5`, `actions/setup-node@v4→v5`, `node-version: 20→24` in `ci.yml` + `build-windows-installer.yml`; `checkout@v5` in `codeql.yml`. The `build-win` job (NSIS `.exe` via `npm run dist:win`, attached to the Release on a `v*` tag) now runs on Node 24. Installer-workflow comments translated to English.
- **README** — Node 24+ requirement, and it summarizes the **last 3 releases** (2.43.0 / 2.42.0 / 2.41.0) in *What's new*; clarifies that **every release ships a built `.exe`** installer.

### Coming in this PR (build waves — commit per wave)
- **Track A — 13 real-car dashes** (Le Mans/WEC, GT3 Cup, Ferrari 488 Challenge, Ferrari 296 GT3, Aston Martin Vantage + Vantage GT3, Mercedes-AMG One + GT Track Series, Porsche 911 GT3 Cup, Mustang GTD, Corvette Z06 GT3.R, Lamborghini Huracán GT3). Each researched from the **real dashboard**, matched via a clean gpt-image reconstruction, then built + QA'd vs the real dash. Per car: full-dash **dashboard** + full-dash **overlay** + **10 single-info** widgets/overlays. No copyrighted photos/logos committed.
- **Track B — 100 new iRacing widgets/overlays** — one validated gpt-image per widget, built + visual-QA'd until clean; a mix of new telemetry channels and new visual styles.

### Release / delivery
- **Every release ships the Windows `.exe`** — produced by the `build-win` workflow and attached to the GitHub Release on a `v*` tag.
- Final wave will refresh CHANGELOG/RELEASE-NOTES + bump the version and prepare the draft release.

### Validation
Each wave: `npm run typecheck` (node+web) + `npx vitest run` + `node visual-audit/shoot-dashboards.mjs` (0 render errors). Previews exported to `Downloads/usa-previews` at the end.
