# Contributing

Thanks for helping improve Ultimate Sim App.

## Workflow

1. Open an issue for bugs, feature requests, or larger design changes.
2. Fork or branch from `main`.
3. Keep pull requests focused and explain the user-facing change.
4. Add or update tests when behavior changes.
5. Run relevant checks before opening a pull request.

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
- Do not commit generated folders such as `node_modules/`, `out/`, or `dist-win/`.
- Do not commit credentials, tokens, private keys, or local `.env` files.
- Keep hardware, firmware, and app documentation in sync when protocol behavior changes.

## Release artifacts

Build outputs and installers should be generated from reviewed source and attached to GitHub Releases rather than committed directly.
