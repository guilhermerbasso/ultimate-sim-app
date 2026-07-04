#!/usr/bin/env bash
# Place the @node-llama-cpp/win-x64 prebuilt CPU binary into node_modules so a Windows
# installer can be built from a NON-Windows host (macOS/Linux CI). npm skips or clobbers
# cross-platform optional binaries (npm/cli#4828), so we fetch the tarball directly and
# extract it in place — without running `npm install` (which would break the host's own
# native binaries). On a real Windows host this binary is already installed, so we no-op.
set -euo pipefail

cd "$(dirname "$0")/.."

VER="$(node -p "require('./node_modules/node-llama-cpp/package.json').version")"
DEST="node_modules/@node-llama-cpp/win-x64"

if [ -f "$DEST/bins/win-x64/llama-addon.node" ]; then
  echo "[fetch-win-llama] @node-llama-cpp/win-x64@$VER already present — skipping"
  exit 0
fi

echo "[fetch-win-llama] fetching @node-llama-cpp/win-x64@$VER ..."
TMP="$(mktemp -d)"
(
  cd "$TMP"
  npm pack "@node-llama-cpp/win-x64@$VER" >/dev/null
  tar -xzf node-llama-cpp-win-x64-*.tgz
)
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$TMP/package/." "$DEST/"
rm -rf "$TMP"

if [ -f "$DEST/bins/win-x64/llama-addon.node" ]; then
  echo "[fetch-win-llama] placed @node-llama-cpp/win-x64@$VER (CPU-only)"
else
  echo "[fetch-win-llama] ERROR: llama-addon.node missing after extract" >&2
  exit 1
fi

# Preflight assertion: the Windows installer cannot be verified on a macOS/Linux host, so
# assert here that the EXACT files electron-builder.yml force-includes + asarUnpacks are
# present. A partial extract (addon present but DLLs missing) still yields NoBinaryFoundError
# at runtime, so we check the dependent native libraries too — not just the .node addon.
BIN_DIR="$DEST/bins/win-x64"
missing=0
for f in llama-addon.node; do
  if [ ! -f "$BIN_DIR/$f" ]; then
    echo "[fetch-win-llama] ERROR: required native file missing: $BIN_DIR/$f" >&2
    missing=1
  fi
done
# node-llama-cpp's addon dynamically loads libllama/libggml DLLs from the same dir; if NONE
# are present the extract is incomplete and the backend will fail to load on Windows.
if ! ls "$BIN_DIR"/*.dll >/dev/null 2>&1; then
  echo "[fetch-win-llama] ERROR: no llama/ggml *.dll found in $BIN_DIR — incomplete extract" >&2
  missing=1
fi
# The package manifest must be resolvable so node-llama-cpp can `require` the win-x64 module.
if [ ! -f "$DEST/package.json" ]; then
  echo "[fetch-win-llama] ERROR: $DEST/package.json missing — node-llama-cpp cannot resolve the backend" >&2
  missing=1
fi
if [ "$missing" -ne 0 ]; then
  echo "[fetch-win-llama] FAILED preflight — the Windows build would throw NoBinaryFoundError" >&2
  exit 1
fi
echo "[fetch-win-llama] preflight OK — electron-builder must force-include & asarUnpack:"
echo "[fetch-win-llama]   $DEST/** (see electron-builder.yml files + asarUnpack)"
