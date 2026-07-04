#!/usr/bin/env bash
# Place the Windows whisper.cpp CPU binary (whisper-cli.exe + its runtime DLLs) into
# resources/whisper/ so a Windows installer can bundle OFFLINE speech-to-text. Mirrors
# scripts/fetch-win-llama.sh: we fetch the official ggml-org/whisper.cpp release ZIP and
# extract ONLY the binary + the CPU ggml DLLs it needs — the ggml MODEL is NOT bundled
# (it downloads on demand at runtime; see src/main/stt/whisper-model.ts).
#
# electron-builder.yml copies resources/whisper/ → <app>/Resources/whisper via
# extraResources, which is where src/main/stt/whisper.ts looks (process.resourcesPath).
set -euo pipefail

cd "$(dirname "$0")/.."

WHISPER_VER="v1.9.1"
ASSET="whisper-bin-x64.zip"
URL="https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VER}/${ASSET}"
DEST="resources/whisper"
BIN="whisper-cli.exe"
# Repo-local scratch dir (never /tmp) — cleaned on exit.
WORK=".whisper-dl"

if [ -f "$DEST/$BIN" ]; then
  echo "[fetch-win-whisper] $DEST/$BIN already present — skipping"
  exit 0
fi

echo "[fetch-win-whisper] fetching whisper.cpp ${WHISPER_VER} ($ASSET) ..."
rm -rf "$WORK"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

curl -fSL -o "$WORK/whisper.zip" "$URL"
unzip -q -o "$WORK/whisper.zip" -d "$WORK/extracted"

# The ZIP lays files under a Release/ folder. Copy ONLY the CPU runtime: the CLI binary,
# whisper.dll, the ggml core DLLs and every ggml-cpu-*.dll backend (whisper-cli picks the
# best one for the host CPU at runtime). SDL2/parakeet/server binaries are intentionally
# dropped to keep the installer lean.
SRC="$(dirname "$(find "$WORK/extracted" -name "$BIN" | head -n1)")"
if [ -z "$SRC" ] || [ ! -f "$SRC/$BIN" ]; then
  echo "[fetch-win-whisper] ERROR: $BIN not found in archive" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$SRC/$BIN" "$DEST/"
for dll in whisper.dll ggml.dll ggml-base.dll; do
  [ -f "$SRC/$dll" ] && cp "$SRC/$dll" "$DEST/"
done
# All CPU backend variants (alderlake/haswell/skylakex/sse42/x64/…).
cp "$SRC"/ggml-cpu-*.dll "$DEST/" 2>/dev/null || true

if [ -f "$DEST/$BIN" ]; then
  echo "[fetch-win-whisper] placed $(ls -1 "$DEST" | wc -l | tr -d ' ') file(s) in $DEST (binary + CPU DLLs)"
else
  echo "[fetch-win-whisper] ERROR: $BIN missing after extract" >&2
  exit 1
fi
