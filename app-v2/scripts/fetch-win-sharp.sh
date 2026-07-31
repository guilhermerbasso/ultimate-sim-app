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
# @img/sharp-win32-x64, selected by npm through optionalDependencies + os/cpu.
# `npm rebuild` cannot cross-target that, so this installs the platform package
# directly with --os/--cpu, which is the documented cross-platform path.
#
# Do NOT probe for node_modules/sharp: sharp is a transitive dependency and npm is
# free to nest it (it currently lands under @huggingface/transformers/node_modules),
# so a directory test silently reports "not installed" and skips on a tree where
# sharp is present. The lockfile is read instead, which is hoist-independent.
#
# NOTE: this adds a foreign-platform package to node_modules. Run `npm install`
# afterwards to restore a clean host (macOS/Linux) tree for local development.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

sharp_version="$(node -e '
  const lock = require("./package-lock.json")
  const hit = Object.entries(lock.packages ?? {}).find(
    ([path]) => path === "node_modules/sharp" || path.endsWith("/node_modules/sharp")
  )
  if (hit) process.stdout.write(hit[1].version ?? "")
' 2>/dev/null || echo "")"

if [ -z "${sharp_version}" ]; then
  echo "[fetch-win-sharp] sharp is not in the dependency tree — skipping (semantic search uses keyword fallback on Windows)."
  exit 0
fi

echo "[fetch-win-sharp] fetching @img/sharp-win32-x64@${sharp_version} (native addon + libvips) for the Windows build…"

if npm install --no-save --no-audit --no-fund \
    --os=win32 --cpu=x64 --include=optional \
    "@img/sharp-win32-x64@${sharp_version}" >/tmp/fetch-win-sharp.log 2>&1; then
  # 0.35.x suffixes the addon with the version (sharp-win32-x64-0.35.3.node), so glob it.
  if ls node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64*.node >/dev/null 2>&1; then
    echo "[fetch-win-sharp] OK: @img/sharp-win32-x64 addon present — semantic embeddings will work on Windows."
  else
    echo "[fetch-win-sharp] WARN: install ran but no win32-x64 addon found — semantic search will use the keyword fallback on Windows."
  fi
else
  echo "[fetch-win-sharp] WARN: install failed (see /tmp/fetch-win-sharp.log) — semantic search will use the keyword fallback on Windows."
fi

echo "[fetch-win-sharp] NOTE: node_modules now carries a win32-x64 sharp binary; run 'npm install' to restore local dev."
exit 0
