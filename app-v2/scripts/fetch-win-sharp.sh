#!/usr/bin/env bash
# scripts/fetch-win-sharp.sh
#
# Best-effort: fetch sharp's win32-x64 prebuilt (native addon + bundled libvips) so
# @huggingface/transformers (semantic search embeddings) actually LOADS on the packaged
# Windows app. Transformers.js imports `sharp` at module load; without the win32-x64
# binary `import('@huggingface/transformers')` throws and EmbeddingsEngine.isAvailable()
# returns false -> semantic search silently degrades to the keyword fallback.
#
# Run before `electron-builder --win` (the dist:win script wraps this in `|| true`,
# so a failure here is NON-FATAL: the app still ships and semantic search falls back
# to keyword search on Windows — no crash, and the UI already labels that mode).
#
# sharp >= 0.33 does NOT build from source and no longer keeps the addon in
# node_modules/sharp/build: the binary and libvips ship in the platform package
# @img/sharp-win32-x64 (plus @img/sharp-libvips-win32-x64), selected by npm through
# optionalDependencies + os/cpu. `npm rebuild` cannot cross-target that, so this
# installs the platform package directly with --os/--cpu, which is the documented
# cross-platform path.
#
# NOTE: this adds a foreign-platform package to node_modules. Run `npm install`
# afterwards to restore a clean host (macOS/Linux) tree for local development.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

if [ ! -d node_modules/sharp ]; then
  echo "[fetch-win-sharp] sharp not installed — skipping (semantic search uses keyword fallback on Windows)."
  exit 0
fi

sharp_version="$(node -p "require('./node_modules/sharp/package.json').version" 2>/dev/null || echo "")"
echo "[fetch-win-sharp] fetching sharp win32-x64 prebuilt (libvips) for the Windows build…"

if [ -n "${sharp_version}" ] && npm install --no-save --no-audit --no-fund \
    --os=win32 --cpu=x64 --include=optional \
    "@img/sharp-win32-x64@${sharp_version}" >/tmp/fetch-win-sharp.log 2>&1; then
  if [ -f node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node ]; then
    echo "[fetch-win-sharp] OK: @img/sharp-win32-x64 present — semantic embeddings will work on Windows."
  else
    echo "[fetch-win-sharp] WARN: install ran but win32-x64 binary not found — semantic search will use the keyword fallback on Windows."
  fi
else
  echo "[fetch-win-sharp] WARN: install failed (see /tmp/fetch-win-sharp.log) — semantic search will use the keyword fallback on Windows."
fi

echo "[fetch-win-sharp] NOTE: node_modules now carries a win32-x64 sharp binary; run 'npm install' to restore local dev."
exit 0
