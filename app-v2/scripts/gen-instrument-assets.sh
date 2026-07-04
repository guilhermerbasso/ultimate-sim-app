#!/usr/bin/env bash
# ── gen-instrument-assets.sh ──────────────────────────────────────────────────
# OPTIONAL wrapper around scripts/gen-instrument-assets.py. Generates brand-neutral
# SVG instrument enrichments + a manifest. NOT part of the mandatory build: the SVG
# instrument primitives render fully without these assets. If Python 3 is missing
# this exits 0 (no-op) so it can never break `electron-vite build`.
#
# Usage: bash scripts/gen-instrument-assets.sh [--out <dir>] [--sizes 160,200,260]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$(command -v python3 || command -v python || true)"

if [ -z "$PY" ]; then
  echo "[gen-instrument-assets] python3 not found — skipping (primitives render without assets)."
  exit 0
fi

exec "$PY" "$SCRIPT_DIR/gen-instrument-assets.py" "$@"
