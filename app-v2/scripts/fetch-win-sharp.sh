#!/usr/bin/env bash
# scripts/fetch-win-sharp.sh
#
# Best-effort: fetch sharp's win32-x64 prebuilt (native addon + bundled libvips) so
# @xenova/transformers (semantic search embeddings) actually LOADS on the packaged
# Windows app. @xenova imports `sharp` at module load; without the win32-x64 binary
# `import('@xenova/transformers')` throws and EmbeddingsEngine.isAvailable() returns
# false -> semantic search silently degrades to the keyword fallback.
#
# Run before `electron-builder --win` (the dist:win script wraps this in `|| true`,
# so a failure here is NON-FATAL: the app still ships and semantic search falls back
# to keyword search on Windows — no crash, and the UI already labels that mode).
#
# NOTE: this mutates node_modules/sharp to win32-x64. Run `npm install` afterwards to
# restore the host (macOS/Linux) binary for local development.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

if [ ! -d node_modules/sharp ]; then
  echo "[fetch-win-sharp] sharp not installed — skipping (semantic search uses keyword fallback on Windows)."
  exit 0
fi

echo "[fetch-win-sharp] fetching sharp win32-x64 prebuilt (libvips) for the Windows build…"
rm -rf node_modules/sharp/build node_modules/sharp/vendor

if npm_config_platform=win32 npm_config_arch=x64 SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm rebuild sharp >/tmp/fetch-win-sharp.log 2>&1; then
  if ls node_modules/sharp/build/Release/sharp-win32-x64.node >/dev/null 2>&1; then
    echo "[fetch-win-sharp] OK: sharp-win32-x64.node present — semantic embeddings will work on Windows."
  else
    echo "[fetch-win-sharp] WARN: rebuild ran but win32-x64 binary not found — semantic search will use the keyword fallback on Windows."
  fi
else
  echo "[fetch-win-sharp] WARN: rebuild failed (see /tmp/fetch-win-sharp.log) — semantic search will use the keyword fallback on Windows."
fi

echo "[fetch-win-sharp] NOTE: node_modules/sharp is now win32-x64; run 'npm install' to restore local dev."
exit 0
