#!/usr/bin/env bash
# scripts/verify-win-tts.sh
#
# Build-time GATE for the Windows neural-TTS engine. scripts/fetch-win-sherpa.sh is
# intentionally best-effort (it exits 0 even on a transient network failure), which
# means dist:win could otherwise produce a GREEN build that ships with NO neural
# engine — every user silently stuck on the OS-voice fallback, with no signal that
# anything is wrong.
#
# This script is STRICT: it FAILS the build (non-zero exit) if, after the fetch,
# either of the two assets that neural TTS cannot run without is missing:
#
#   1. node_modules/sherpa-onnx-win-x64/sherpa-onnx.node   (the Windows prebuilt)
#   2. resources/tts/espeak-ng-data/phontab                (the shared VITS dataDir)
#
# Wire it into dist:win AFTER fetch-win-sherpa.sh and BEFORE electron-builder.

set -euo pipefail

cd "$(dirname "$0")/.."

ENGINE="node_modules/sherpa-onnx-win-x64/sherpa-onnx.node"
ESPEAK="resources/tts/espeak-ng-data/phontab"

fail=0

if [ ! -f "$ENGINE" ]; then
  echo "[verify-win-tts] ERROR: missing Windows neural engine: $ENGINE" >&2
  fail=1
fi

if [ ! -f "$ESPEAK" ]; then
  echo "[verify-win-tts] ERROR: missing shared espeak-ng-data: $ESPEAK" >&2
  fail=1
fi

# A partial extract (the .node present but its sibling onnxruntime/sherpa-c-api
# DLLs missing) would pass the two checks above yet fail at runtime. Require at
# least one sibling *.dll whenever the engine .node is present.
if [ -f "$ENGINE" ]; then
  DLL_COUNT=$( (find node_modules/sherpa-onnx-win-x64 -name '*.dll' 2>/dev/null || true) | wc -l | tr -d ' ')
  if [ "${DLL_COUNT:-0}" -eq 0 ]; then
    echo "[verify-win-tts] ERROR: sherpa-onnx-win-x64 has the engine .node but NO sibling *.dll (partial extract)" >&2
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "[verify-win-tts] FAILED — refusing to ship a build with no neural TTS engine." >&2
  echo "[verify-win-tts] Re-run scripts/fetch-win-sherpa.sh (check network) before retrying dist:win." >&2
  exit 1
fi

echo "[verify-win-tts] OK — sherpa-onnx-win-x64 engine + espeak-ng-data present."
exit 0
