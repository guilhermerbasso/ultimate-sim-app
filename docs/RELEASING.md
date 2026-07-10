# Releasing Ultimate Sim App

How to cut a GitHub Release so the in-app **auto-update works**.

> ⚠️ **The #1 rule:** a Release must include **every** electron-builder artifact — above all
> **`latest.yml`**. That file is what `electron-updater` reads to detect a new version. A release
> with only the `.exe` will install fine by hand but **auto-update will never find it**
> (this is exactly what broke the first cut of v2.50.0).

## Checklist

- [ ] Bump `version` in `app-v2/package.json` (e.g. `2.49.0` → `2.50.0`). The tag is `v<version>`.
- [ ] Build on Windows x64: `cd app-v2 && npm run dist:win`.
- [ ] Attach **all four** artifacts from `app-v2/dist-win/` to the Release:
  - `latest.yml` ← **required for auto-update**
  - `Ultimate-Sim-App-<version>-x64.exe`
  - `Ultimate-Sim-App-<version>-x64.exe.blockmap`
  - `Ultimate-Sim-App-<version>-x64.zip`
- [ ] Write the release notes in **English**, following the previous releases' format
      (title → intro → themed sections with **bold** bullets → `Full test suite: N tests passing.
      Typecheck clean.` → **What's Changed** → **Full Changelog** compare link).
- [ ] Create it as a **DRAFT** for manual review.
- [ ] **Publish** it when ready — see "Draft vs auto-update" below.

## 1. Bump the version

Edit `app-v2/package.json` → `"version"`. electron-builder stamps this into the `.exe`, the
installer name and `latest.yml`, and the app compares against it on "Check for updates".
Do this on a branch and ship it through a PR (we don't commit to `main` directly).

## 2. Build the Windows installer

```bash
cd app-v2
npm run dist:win
```

This fetches the local llama/whisper/sherpa/tts binaries, runs `electron-vite build`, then
`electron-builder --win --publish never`. Output lands in `app-v2/dist-win/`.

**If it fails on `vigemclient`** (`Error: Could not find any Visual Studio installation`): that
optional gamepad/ViGEm native module needs Visual Studio to rebuild. On a machine without VS you can
package without it (the app degrades gracefully — it's an `optionalDependencies`):

```bash
# from app-v2/
Rename-Item node_modules\vigemclient vigemclient.disabled   # PowerShell
npx electron-builder --win --publish never                  # electron-vite build already ran
Rename-Item node_modules\vigemclient.disabled vigemclient   # restore afterwards
```

(The proper fix is to build on a machine with the Visual Studio Build Tools installed.)

## 3. Artifacts that MUST be attached

| File | Why it matters |
|---|---|
| **`latest.yml`** | The update feed: version + file name + **sha512** + size. `electron-updater` downloads this first; **without it there is no auto-update.** |
| `…-x64.exe` | The NSIS installer users download. Its sha512/size must match `latest.yml` (they do when built together). |
| `…-x64.exe.blockmap` | Enables differential (delta) downloads so updates are smaller. |
| `…-x64.zip` | Portable build + referenced by the update flow. |

## 4. Create the release (draft, all assets)

Use the GitHub CLI and pass **all four files** (write the notes to a `.md` file first):

```bash
gh release create v<version> \
  --repo guilhermerbasso/ultimate-sim-app \
  --draft \
  --title "Ultimate Sim App v<version> — <headline>" \
  --notes-file release-notes.md \
  app-v2/dist-win/latest.yml \
  "app-v2/dist-win/Ultimate-Sim-App-<version>-x64.exe" \
  "app-v2/dist-win/Ultimate-Sim-App-<version>-x64.exe.blockmap" \
  "app-v2/dist-win/Ultimate-Sim-App-<version>-x64.zip"
```

Verify the assets:

```bash
gh release view v<version> --repo guilhermerbasso/ultimate-sim-app --json isDraft,assets \
  -q '{draft: .isDraft, assets: [.assets[].name]}'
```

You should see `latest.yml`, the `.exe`, the `.blockmap` and the `.zip`.

## 5. Draft vs auto-update

`electron-updater` (GitHub provider, configured in `app-v2/electron-builder.yml`) only reads the
**latest _published_ release**. **Draft releases are invisible to it** — while v2.50.0 is a draft,
the "Check for updates" button in older versions correctly reports "up to date".

So the flow is: keep the release as a **draft** while you review it, then **Publish** it. Once
published, older installs will find it on the next check (startup + every 4h + the manual button).

## How auto-update works (reference)

- Config: `app-v2/electron-builder.yml` → `publish: { provider: github, owner, repo }`.
- Code: `app-v2/src/main/modules/updater.ts` (`electron-updater` `autoUpdater`). Runs only in a
  packaged app; checks on startup (after ~8s), every 4h, and on the manual button.
- On check it fetches `latest.yml` from the latest published release, compares `version`, and if
  newer downloads the `.exe` (validated against the `sha512` in `latest.yml`).

## Common mistake (what broke v2.50.0)

Creating the release with **only** `…-x64.exe` attached. The installer worked by hand, but every
older install's "Check for updates" found nothing because **`latest.yml` was missing**. Fix: upload
the missing files to the existing release —

```bash
gh release upload v<version> --repo guilhermerbasso/ultimate-sim-app \
  app-v2/dist-win/latest.yml \
  "app-v2/dist-win/Ultimate-Sim-App-<version>-x64.exe.blockmap" \
  "app-v2/dist-win/Ultimate-Sim-App-<version>-x64.zip"
```
