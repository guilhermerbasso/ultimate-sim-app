#!/usr/bin/env bash
# scripts/fetch-win-sherpa.sh
#
# Prepare the sherpa-onnx NEURAL TTS engine for a Windows installer built from a
# NON-Windows host (macOS/Linux CI). Two jobs:
#
#   1. Place the sherpa-onnx-win-x64 prebuilt (sherpa-onnx.node + onnxruntime /
#      sherpa-onnx-c-api DLLs) into node_modules so electron-builder can asarUnpack
#      it. npm skips cross-platform optional binaries (npm/cli#4828), so we fetch the
#      tarball directly and extract it in place — without running `npm install`
#      (which would clobber the host's own native binaries). Mirrors
#      scripts/fetch-win-llama.sh.
#
#   2. Populate resources/tts/espeak-ng-data — the SHARED sherpa VITS `dataDir`,
#      bundled ONCE for ALL voices (per-voice model.onnx + tokens.txt download on
#      demand at runtime). We reuse the legacy resources/piper/espeak-ng-data if it
#      exists, else extract it from one sherpa voice bundle (the build host has
#      tar+bzip2; the RUNTIME uses pure-JS seek-bzip — see src/main/tts/sherpa.ts).
#
# BEST-EFFORT: this script never aborts the build (dist:win does NOT wrap it in
# `|| true`, so we exit 0 even on partial failure). If the win-x64 engine or
# espeak-ng-data is missing, neural TTS simply falls back to DISTINCT OS voices on
# Windows — no crash. Run before `electron-builder --win`.
#
# Requires: curl, tar (with bzip2), node. On Windows: run in Git Bash or WSL.

set -uo pipefail

cd "$(dirname "$0")/.."

# ── 1. sherpa-onnx-win-x64 native engine ─────────────────────────────────────
VER="$(node -p "require('./node_modules/sherpa-onnx-node/package.json').version" 2>/dev/null || echo '')"
DEST="node_modules/sherpa-onnx-win-x64"

# The tarball is fetched with curl, which bypasses npm's own integrity check, so verify
# it against the sha512 COMMITTED in package-lock.json for the exact same version.
# The pin is reviewed in git and moves only when the lockfile moves.
lockfile_integrity() {
  node -e '
    const lock = require("./package-lock.json");
    const entry = lock.packages?.["node_modules/sherpa-onnx-win-x64"];
    if (!entry || entry.version !== process.argv[1] || !entry.integrity) process.exit(1);
    process.stdout.write(entry.integrity);
  ' "$1" 2>/dev/null || echo ''
}

verify_integrity() {
  local file="$1" expected="$2" actual
  actual="sha512-$(node -e 'const fs=require("node:fs"),crypto=require("node:crypto");process.stdout.write(crypto.createHash("sha512").update(fs.readFileSync(process.argv[1])).digest("base64"))' "$file")"
  if [ "$actual" != "$expected" ]; then
    echo "[fetch-win-sherpa] ERROR: integrity mismatch for $file" >&2
    echo "[fetch-win-sherpa] expected $expected (package-lock.json)" >&2
    echo "[fetch-win-sherpa] actual   $actual" >&2
    return 1
  fi
  return 0
}

sha256_of() {
  node -e 'const fs=require("node:fs"),crypto=require("node:crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1"
}

if [ -z "$VER" ]; then
  echo "[fetch-win-sherpa] WARN: sherpa-onnx-node not installed — neural TTS will use OS-voice fallback on Windows."
else
  if [ -f "$DEST/sherpa-onnx.node" ]; then
    echo "[fetch-win-sherpa] sherpa-onnx-win-x64@$VER already present — skipping engine."
  else
    EXPECTED_INTEGRITY="$(lockfile_integrity "$VER")"
    if [ -z "$EXPECTED_INTEGRITY" ]; then
      echo "[fetch-win-sherpa] ERROR: no package-lock.json integrity pin for sherpa-onnx-win-x64@$VER." >&2
      echo "[fetch-win-sherpa] Refusing to install an unverified native engine — run npm install to refresh the lockfile." >&2
    else
      echo "[fetch-win-sherpa] fetching sherpa-onnx-win-x64@$VER ..."
      WORK_ENGINE=".sherpa-engine-dl"
      rm -rf "$WORK_ENGINE"
      mkdir -p "$WORK_ENGINE"
      if curl -fSL --proto '=https' --tlsv1.2 -o "$WORK_ENGINE/win-x64.tgz" \
           "https://registry.npmjs.org/sherpa-onnx-win-x64/-/sherpa-onnx-win-x64-${VER}.tgz" \
         && verify_integrity "$WORK_ENGINE/win-x64.tgz" "$EXPECTED_INTEGRITY" \
         && tar -xzf "$WORK_ENGINE/win-x64.tgz" -C "$WORK_ENGINE"; then
        rm -rf "$DEST"
        mkdir -p "$DEST"
        cp -R "$WORK_ENGINE/package/." "$DEST/"
        if [ -f "$DEST/sherpa-onnx.node" ]; then
          echo "[fetch-win-sherpa] placed verified sherpa-onnx-win-x64@$VER (engine + DLLs)."
        else
          echo "[fetch-win-sherpa] WARN: sherpa-onnx.node missing after extract — OS-voice fallback on Windows."
        fi
      else
        echo "[fetch-win-sherpa] WARN: could not fetch or verify sherpa-onnx-win-x64@$VER — OS-voice fallback on Windows."
      fi
      rm -rf "$WORK_ENGINE"
    fi
  fi
fi

# ── 2. Shared espeak-ng-data (the sherpa VITS dataDir) ───────────────────────
TTS_DIR="resources/tts"
ESPEAK_DEST="$TTS_DIR/espeak-ng-data"
mkdir -p "$TTS_DIR"

if [ -d "$ESPEAK_DEST" ] && [ -f "$ESPEAK_DEST/phontab" ]; then
  echo "[fetch-win-sherpa] espeak-ng-data already present in $ESPEAK_DEST — skipping."
elif [ -d "resources/piper/espeak-ng-data" ] && [ -f "resources/piper/espeak-ng-data/phontab" ]; then
  echo "[fetch-win-sherpa] reusing legacy resources/piper/espeak-ng-data → $ESPEAK_DEST ..."
  rm -rf "$ESPEAK_DEST"
  cp -R "resources/piper/espeak-ng-data" "$ESPEAK_DEST"
  echo "[fetch-win-sherpa] espeak-ng-data copied."
else
  echo "[fetch-win-sherpa] extracting espeak-ng-data from a sherpa voice bundle ..."
  SEED_ID="pt_BR-faber-medium"
  BUNDLE_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-${SEED_ID}.tar.bz2"
  # `tts-models` is a MOVING release tag, so the asset behind this URL can change without
  # notice. Pin it by hash: the bundle is only unpacked when the bytes are the reviewed ones.
  BUNDLE_SHA256="7add3f923ad6bc25ca8a192805fd1a64d1b3893e4611c4a9719545a825039a83"
  WORK_DATA=".sherpa-espeak-dl"
  rm -rf "$WORK_DATA"
  mkdir -p "$WORK_DATA"
  if curl -fSL --proto '=https' --tlsv1.2 -o "$WORK_DATA/seed.tar.bz2" "$BUNDLE_URL" \
     && [ "$(sha256_of "$WORK_DATA/seed.tar.bz2")" = "$BUNDLE_SHA256" ] \
     && tar -xjf "$WORK_DATA/seed.tar.bz2" -C "$WORK_DATA" "vits-piper-${SEED_ID}/espeak-ng-data" 2>/dev/null \
     && [ -d "$WORK_DATA/vits-piper-${SEED_ID}/espeak-ng-data" ]; then
    rm -rf "$ESPEAK_DEST"
    mv "$WORK_DATA/vits-piper-${SEED_ID}/espeak-ng-data" "$ESPEAK_DEST"
    echo "[fetch-win-sherpa] espeak-ng-data extracted to $ESPEAK_DEST (verified sha256:$BUNDLE_SHA256)."
  else
    echo "[fetch-win-sherpa] WARN: could not obtain or verify espeak-ng-data — neural TTS will use OS-voice fallback on Windows."
  fi
  rm -rf "$WORK_DATA"
fi

# ── 3. License note ──────────────────────────────────────────────────────────
cat > "$TTS_DIR/LICENSE-tts.md" << 'EOF'
# Neural TTS (sherpa-onnx) — License Summary

Engine: sherpa-onnx (https://github.com/k2-fsa/sherpa-onnx) — Apache-2.0.
Voices: sherpa-onnx `tts-models` VITS piper bundles (the same upstream piper
voices, MIT). espeak-ng-data: espeak-ng (https://github.com/espeak-ng/espeak-ng)
— GPLv3, redistributed as the phonemizer data dir.

By default this app DOWNLOADS voice weights on demand at runtime; none are bundled.
The shared espeak-ng-data is bundled once under resources/tts/espeak-ng-data.

| Voice ID             | Source / Attribution                         | License |
|----------------------|----------------------------------------------|---------|
| pt_BR-faber-medium   | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| pt_BR-cadu-medium    | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| pt_BR-jeff-medium    | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| pt_BR-edresson-low   | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| en_US-lessac-medium  | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| en_US-amy-medium     | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| en_US-amy-low        | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |
| en_US-ryan-medium    | k2-fsa/sherpa-onnx tts-models (piper)         | MIT     |

Source: https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
EOF

echo ""
echo "[fetch-win-sherpa] done. resources/tts/ ready; sherpa-onnx-win-x64 staged for packaging."
exit 0
