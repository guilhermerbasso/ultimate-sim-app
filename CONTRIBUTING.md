# Contributing

Thanks for helping improve Ultimate Sim App.

## Workflow

1. Open an issue for bugs, feature requests, or larger design changes.
2. Fork or branch from `main`.
3. Open a pull request for review.
4. Wait for maintainer approval before merge.
5. Keep pull requests focused and explain the user-facing change.
6. Add or update tests when behavior changes.
7. Run relevant checks before opening a pull request.

## Review and merge policy

All community contributions must be reviewed and approved by Guilherme Basso before they are merged. Direct pushes to `main` are reserved for maintainers only.

When GitHub branch protection is available for this repository, `main` should require pull requests, at least one approval, resolved conversations, and no force-pushes or branch deletion.

## Development commands

```bash
cd app-v2
npm install
npm run typecheck
npm run test
npm run build
```

## Code guidelines

- Prefer small, clear changes over broad rewrites.
- Keep Electron security defaults intact.
- **Every tracked text file is UTF-8 without a byte-order mark.** Windows PowerShell 5.1 writes a
  BOM for `Set-Content -Encoding UTF8` / `Out-File -Encoding utf8` and reads with the ANSI code
  page, which silently corrupts accented characters. Read **and** write with an explicit UTF-8
  encoding — see **[docs/ENCODING.md](docs/ENCODING.md)**. Enable the local guards once per clone:

  ```bash
  git config core.hooksPath .githooks
  ```

- Do not commit generated folders such as `node_modules/`, `out/`, or `dist-win/`.
- Do not commit credentials, tokens, private keys, or local `.env` files.
- Keep hardware, firmware, and app documentation in sync when protocol behavior changes.

## Release artifacts

Build outputs and installers are generated from reviewed source and attached to GitHub Releases,
never committed. **Every release must attach all electron-builder artifacts — especially
`latest.yml`, which the in-app auto-updater reads to detect new versions.** A release with only the
`.exe` installs by hand but silently breaks auto-update.

See **[docs/RELEASING.md](docs/RELEASING.md)** for the full step-by-step process (version bump →
`npm run dist:win` → attach `latest.yml` + `.exe` + `.blockmap` + `.zip` → keep as draft → publish).
When a release is **published**, the `Update README on release` workflow opens a PR that refreshes
the README's version and **What's new** highlights automatically.
