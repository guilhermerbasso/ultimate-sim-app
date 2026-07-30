#!/usr/bin/env bash
# scripts/fetch-piper-voices.sh
#
# Downloads the Piper TTS engine (Windows x64) into resources/piper/ so
# electron-builder can package it as extraResources in the Windows installer.
#
# LEAN INSTALLER (default): bundles ONLY the engine binary. Voice models are
# DOWNLOADED on first use at runtime via the tts:ensureVoice IPC channel into the
# user's writable data dir — they are NOT shipped in the installer.
#
# Usage:
#   bash scripts/fetch-piper-voices.sh                 # binary only (default, lean)
#   bash scripts/fetch-piper-voices.sh --with-default  # binary + pt_BR-faber-medium
#   bash scripts/fetch-piper-voices.sh --with-voices   # binary + all catalog voices
#
# Run before `npm run dist:win`.
# Requires: curl, unzip (both standard on macOS/Linux CI machines)
# On Windows: run in Git Bash or WSL.

set -euo pipefail

# ── Mode: default bundles ONLY the binary (voices download on demand) ────────────
VOICE_MODE="none"   # none | default | all
for arg in "$@"; do
  case "${arg}" in
    --with-voices|--all-voices) VOICE_MODE="all" ;;
    --with-default|--with-default-voice) VOICE_MODE="default" ;;
    --binary-only) VOICE_MODE="none" ;;
    -h|--help)
      echo "Usage: $0 [--binary-only | --with-default | --with-voices]"
      exit 0
      ;;
    *) echo "  WARN: unknown arg '${arg}' (ignored)" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${SCRIPT_DIR}/../resources/piper"
VOICES_DIR="${DEST}/voices"
PIPER_VERSION="2023.11.14-2"
PIPER_ZIP_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_windows_amd64.zip"
# piper.exe is an EXECUTABLE: pin it by origin + version + hash and verify before
# anything is extracted. sha256 of piper_windows_amd64.zip @ 2023.11.14-2.
PIPER_ZIP_SHA256="f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea"
HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"

sha256_of() {
  node -e 'const fs=require("node:fs"),crypto=require("node:crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1"
}

mkdir -p "${VOICES_DIR}"

echo "==> Downloading Piper engine (Windows x64)…"
PIPER_ZIP="${DEST}/piper_windows_amd64.zip"
if [ ! -f "${DEST}/piper.exe" ]; then
  curl -fL --progress-bar --proto '=https' --tlsv1.2 -o "${PIPER_ZIP}" "${PIPER_ZIP_URL}"

  ACTUAL_SHA256="$(sha256_of "${PIPER_ZIP}")"
  if [ "${ACTUAL_SHA256}" != "${PIPER_ZIP_SHA256}" ]; then
    rm -f "${PIPER_ZIP}"
    echo "  ERROR: SHA-256 mismatch for piper_windows_amd64.zip" >&2
    echo "  expected ${PIPER_ZIP_SHA256}" >&2
    echo "  actual   ${ACTUAL_SHA256}" >&2
    exit 1
  fi
  echo "    verified piper_windows_amd64.zip (${PIPER_VERSION}, sha256:${ACTUAL_SHA256})"

  # 1. Flat-extract the binaries (piper.exe, onnxruntime.dll) — junk paths is fine here.
  unzip -jo "${PIPER_ZIP}" "piper/piper.exe" "piper/onnxruntime.dll" -d "${DEST}" 2>/dev/null || \
    unzip -jo "${PIPER_ZIP}" "piper.exe" "onnxruntime.dll" -d "${DEST}"

  # 2. Extract espeak-ng-data PRESERVING its directory structure (no -j).
  #    Archive layout is `piper/espeak-ng-data/*` (or `espeak-ng-data/*` in older releases).
  #    We extract into a temp dir then move so the final path is resources/piper/espeak-ng-data/.
  TMP_EXTRACT="${DEST}/_extract_tmp"
  mkdir -p "${TMP_EXTRACT}"
  if unzip -o "${PIPER_ZIP}" "piper/espeak-ng-data/*" -d "${TMP_EXTRACT}" 2>/dev/null && \
       [ -d "${TMP_EXTRACT}/piper/espeak-ng-data" ]; then
    rm -rf "${DEST}/espeak-ng-data"
    mv "${TMP_EXTRACT}/piper/espeak-ng-data" "${DEST}/espeak-ng-data"
  elif unzip -o "${PIPER_ZIP}" "espeak-ng-data/*" -d "${TMP_EXTRACT}" 2>/dev/null && \
       [ -d "${TMP_EXTRACT}/espeak-ng-data" ]; then
    rm -rf "${DEST}/espeak-ng-data"
    mv "${TMP_EXTRACT}/espeak-ng-data" "${DEST}/espeak-ng-data"
  else
    echo "  WARN: espeak-ng-data not found in archive — voices may not synthesise correctly."
  fi
  rm -rf "${TMP_EXTRACT}"

  rm -f "${PIPER_ZIP}"
  echo "    piper.exe installed."
else
  echo "    piper.exe already present, skipping."
fi

download_voice() {
  local lang_prefix="$1"   # e.g. "pt"
  local lang_code="$2"     # e.g. "pt_BR"
  local voice_name="$3"    # e.g. "faber"
  local quality="$4"       # e.g. "medium"
  local voice_id="${lang_code}-${voice_name}-${quality}"

  echo "==> Voice: ${voice_id}"
  local base_url="${HF_BASE}/${lang_prefix}/${lang_code}/${voice_name}/${quality}/${voice_id}"

  for ext in ".onnx" ".onnx.json"; do
    local file="${VOICES_DIR}/${voice_id}${ext}"
    if [ ! -f "${file}" ]; then
      if ! curl -fL --progress-bar --proto '=https' --tlsv1.2 -o "${file}" "${base_url}${ext}"; then
        rm -f "${file}"   # remove partial download
        echo "    ERROR: failed to download ${voice_id}${ext}"
        return 1
      fi
    else
      echo "    ${voice_id}${ext} already present, skipping."
    fi
  done
}

# ── Voices: DOWNLOADED ON DEMAND by default (lean installer) ───────────────────
# Only bundle voices when explicitly requested. At runtime the app fetches the
# chosen voice into userData via tts:ensureVoice, so the installer stays small.
case "${VOICE_MODE}" in
  default)
    echo "==> Bundling default voice (pt_BR-faber-medium)…"
    # HF path: pt/pt_BR/<voice>/<quality>/pt_BR-<voice>-<quality>.onnx(.json)
    download_voice "pt" "pt_BR" "faber" "medium" || echo "  WARN: pt_BR-faber-medium skipped."
    ;;
  all)
    echo "==> Bundling ALL catalog voices…"
    download_voice "pt" "pt_BR" "faber"    "medium" || echo "  WARN: pt_BR-faber-medium skipped."
    download_voice "pt" "pt_BR" "cadu"     "medium" || echo "  WARN: pt_BR-cadu-medium skipped."
    download_voice "pt" "pt_BR" "jeff"     "medium" || echo "  WARN: pt_BR-jeff-medium skipped."
    download_voice "pt" "pt_BR" "edresson" "low"    || echo "  WARN: pt_BR-edresson-low skipped."
    download_voice "en" "en_US" "lessac"   "medium" || echo "  WARN: en_US-lessac-medium skipped."
    download_voice "en" "en_US" "amy"      "medium" || echo "  WARN: en_US-amy-medium skipped."
    download_voice "en" "en_US" "amy"      "low"    || echo "  WARN: en_US-amy-low skipped."
    download_voice "en" "en_US" "ryan"     "medium" || echo "  WARN: en_US-ryan-medium skipped."
    ;;
  *)
    echo "==> Lean mode: NO voices bundled (downloaded on demand at runtime)."
    ;;
esac

# ── Fetch LICENSE files ───────────────────────────────────────────────────────
echo "==> Fetching Piper LICENSE…"
if [ ! -f "${DEST}/LICENSE" ]; then
  curl -fsSL --proto '=https' --tlsv1.2 -o "${DEST}/LICENSE" \
    "https://raw.githubusercontent.com/rhasspy/piper/master/LICENSE"
fi

# Voice attributions live in each voice's `.onnx.json`; this summary documents the
# full catalog (all MIT) regardless of which voices were bundled vs. downloaded.
cat > "${DEST}/LICENSE-voices.md" << 'EOF'
# Piper Voices — License Summary

All Piper voices (rhasspy/piper-voices) are distributed under the MIT License.
By default this app DOWNLOADS voices on demand at runtime; none are bundled.

| Voice ID                 | Source / Attribution               | License |
|--------------------------|------------------------------------|---------|
| pt_BR-faber-medium       | rhasspy/piper-voices (HuggingFace) | MIT     |
| pt_BR-cadu-medium        | rhasspy/piper-voices (HuggingFace) | MIT     |
| pt_BR-jeff-medium        | rhasspy/piper-voices (HuggingFace) | MIT     |
| pt_BR-edresson-low       | rhasspy/piper-voices (HuggingFace) | MIT     |
| en_US-lessac-medium      | rhasspy/piper-voices (HuggingFace) | MIT     |
| en_US-amy-medium         | rhasspy/piper-voices (HuggingFace) | MIT     |
| en_US-amy-low            | rhasspy/piper-voices (HuggingFace) | MIT     |
| en_US-ryan-medium        | rhasspy/piper-voices (HuggingFace) | MIT     |

Full voice model metadata (including original attributions) is in the
corresponding `.onnx.json` files.

Source: https://huggingface.co/rhasspy/piper-voices
EOF

echo ""
echo "✓ Done. resources/piper/ is ready for packaging (mode: ${VOICE_MODE})."
echo "  Run 'npm run dist:win' to build the Windows installer."
