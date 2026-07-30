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
# Pinned by origin + version + hash. whisper-cli.exe is EXECUTED by the app, so the
# archive is verified before anything is extracted from it: a moved tag, a re-cut
# release or a tampered CDN response must fail the build, not ship a binary.
# sha256 of https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip
ASSET_SHA256="7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539"
URL="https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VER}/${ASSET}"
DEST="resources/whisper"
BIN="whisper-cli.exe"
# Repo-local scratch dir (never /tmp) — cleaned on exit.
WORK=".whisper-dl"
STAGE="${DEST}.stage.$$"
BACKUP="${DEST}.backup.$$"

REQUIRED_RUNTIME=(
  "$BIN"
  "whisper.dll"
  "ggml.dll"
  "ggml-base.dll"
  "ggml-cpu-alderlake.dll"
  "ggml-cpu-cannonlake.dll"
  "ggml-cpu-cascadelake.dll"
  "ggml-cpu-haswell.dll"
  "ggml-cpu-icelake.dll"
  "ggml-cpu-sandybridge.dll"
  "ggml-cpu-skylakex.dll"
  "ggml-cpu-sse42.dll"
  "ggml-cpu-x64.dll"
)

runtime_complete_at() {
  local dir="$1" file
  for file in "${REQUIRED_RUNTIME[@]}"; do
    [ -s "$dir/$file" ] || return 1
  done
}

sha256_of() {
  node -e 'const fs=require("node:fs"),crypto=require("node:crypto");console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1"
}

verify_sha256() {
  local file="$1" expected="$2" actual
  actual="$(sha256_of "$file")"
  if [ "$actual" != "$expected" ]; then
    echo "[fetch-win-whisper] ERROR: SHA-256 mismatch for $file" >&2
    echo "[fetch-win-whisper] expected $expected" >&2
    echo "[fetch-win-whisper] actual   $actual" >&2
    return 1
  fi
  echo "[fetch-win-whisper] verified $ASSET ($WHISPER_VER, sha256:$actual)"
}

if runtime_complete_at "$DEST"; then
  echo "[fetch-win-whisper] complete Windows runtime already present — skipping"
  exit 0
fi

echo "[fetch-win-whisper] fetching whisper.cpp ${WHISPER_VER} ($ASSET) ..."
rm -rf "$WORK" "$STAGE" "$BACKUP"
mkdir -p "$WORK"
cleanup() {
  if [ -d "$BACKUP" ] && [ ! -d "$DEST" ]; then
    mv "$BACKUP" "$DEST"
  fi
  rm -rf "$WORK" "$STAGE" "$BACKUP"
}
trap cleanup EXIT

curl -fSL --proto '=https' --tlsv1.2 -o "$WORK/whisper.zip" "$URL"
verify_sha256 "$WORK/whisper.zip" "$ASSET_SHA256"
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

mkdir -p "$STAGE"
for metadata in .gitignore .gitkeep; do
  [ -f "$DEST/$metadata" ] && cp "$DEST/$metadata" "$STAGE/"
done
cp "$SRC/$BIN" "$STAGE/"
for dll in whisper.dll ggml.dll ggml-base.dll; do
  [ -f "$SRC/$dll" ] && cp "$SRC/$dll" "$STAGE/"
done
# All CPU backend variants (alderlake/haswell/skylakex/sse42/x64/…).
cp "$SRC"/ggml-cpu-*.dll "$STAGE/" 2>/dev/null || true

if ! runtime_complete_at "$STAGE"; then
  echo "[fetch-win-whisper] ERROR: incomplete Windows runtime after extract" >&2
  for file in "${REQUIRED_RUNTIME[@]}"; do
    [ -s "$STAGE/$file" ] || echo "[fetch-win-whisper] missing: $file" >&2
  done
  exit 1
fi

if [ -d "$DEST" ]; then
  mv "$DEST" "$BACKUP"
fi
mv "$STAGE" "$DEST"
rm -rf "$BACKUP"

echo "[fetch-win-whisper] placed $(find "$DEST" -maxdepth 1 -type f | wc -l | tr -d ' ') file(s) in $DEST (binary + CPU DLLs)"
