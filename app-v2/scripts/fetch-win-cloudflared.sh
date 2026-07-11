#!/usr/bin/env bash
# Fetch the official Windows x64 cloudflared binary used by Streaming Auto-tunnel.
# electron-builder copies resources/cloudflared/ to process.resourcesPath/cloudflared/.
set -euo pipefail

cd "$(dirname "$0")/.."

CLOUDFLARED_VER="2026.7.1"
ASSET="cloudflared-windows-amd64.exe"
EXPECTED_SHA256="ccb0756de288d3c2c076d19764ca53e0849a10f2dd9c23f8656ac42bdeb45001"
URL="https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VER}/${ASSET}"
DEST="resources/cloudflared"
BIN="cloudflared.exe"
# Repo-local scratch directory; cleaned on exit.
WORK=".cloudflared-dl"

if [ -s "$DEST/$BIN" ]; then
  echo "[fetch-win-cloudflared] $DEST/$BIN already present — skipping"
  exit 0
fi

echo "[fetch-win-cloudflared] fetching cloudflared ${CLOUDFLARED_VER} for Windows x64 ..."
rm -rf "$WORK"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

curl -fSL --retry 3 --retry-delay 2 -o "$WORK/$BIN" "$URL"
if [ ! -s "$WORK/$BIN" ]; then
  echo "[fetch-win-cloudflared] ERROR: downloaded binary is empty" >&2
  exit 1
fi

ACTUAL_SHA256="$(node -e 'const fs=require("node:fs");const crypto=require("node:crypto");console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$WORK/$BIN")"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "[fetch-win-cloudflared] ERROR: SHA256 mismatch (expected $EXPECTED_SHA256, got $ACTUAL_SHA256)" >&2
  exit 1
fi

mkdir -p "$DEST"
mv "$WORK/$BIN" "$DEST/$BIN"
echo "[fetch-win-cloudflared] placed $DEST/$BIN"
