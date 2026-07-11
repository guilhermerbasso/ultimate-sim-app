#!/usr/bin/env bash
# Fetch and verify the official Windows x64 cloudflared used by Streaming Auto-tunnel.
# The binary is always treated as data; neither path executes it.
set -euo pipefail

cd "$(dirname "$0")/.."

CLOUDFLARED_VERSION="2026.7.1"
CLOUDFLARED_ASSET="cloudflared-windows-amd64.exe"
CLOUDFLARED_SHA256="ccb0756de288d3c2c076d19764ca53e0849a10f2dd9c23f8656ac42bdeb45001"
CLOUDFLARED_URL="https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${CLOUDFLARED_ASSET}"
DEST="resources/cloudflared"
BIN="cloudflared.exe"
TARGET="$DEST/$BIN"

hash_file() {
  node -e 'const fs=require("node:fs"),crypto=require("node:crypto");console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1"
}

verify_file() {
  local file="$1" actual
  if [ ! -s "$file" ]; then
    echo "[fetch-win-cloudflared] ERROR: missing or empty: $file" >&2
    return 1
  fi
  actual="$(hash_file "$file")"
  if [ "$actual" != "$CLOUDFLARED_SHA256" ]; then
    echo "[fetch-win-cloudflared] ERROR: SHA256 mismatch for $file" >&2
    echo "[fetch-win-cloudflared] expected $CLOUDFLARED_SHA256, got $actual" >&2
    return 1
  fi
  echo "[fetch-win-cloudflared] verified $file ($CLOUDFLARED_VERSION, sha256:$actual)"
}

verify_package() {
  local version stem latest_version artifact
  version="$(node -p "require('./package.json').version")"
  stem="dist-win/Ultimate-Sim-App-${version}-x64"
  verify_file "dist-win/win-unpacked/resources/cloudflared/$BIN"
  for artifact in "dist-win/latest.yml" "$stem.exe" "$stem.exe.blockmap" "$stem.zip"; do
    if [ ! -s "$artifact" ]; then
      echo "[fetch-win-cloudflared] ERROR: missing or empty package artifact: $artifact" >&2
      return 1
    fi
  done
  latest_version="$(node -e 'const fs=require("node:fs"),yaml=require("yaml");process.stdout.write(String(yaml.parse(fs.readFileSync("dist-win/latest.yml","utf8")).version))')"
  if [ "$latest_version" != "$version" ]; then
    echo "[fetch-win-cloudflared] ERROR: latest.yml version $latest_version != package version $version" >&2
    return 1
  fi
  echo "[fetch-win-cloudflared] verified Windows package artifacts for $version"
}

case "${1:-}" in
  --verify)
    [ "$#" -le 2 ] || { echo "usage: $0 --verify [path]" >&2; exit 2; }
    verify_file "${2:-$TARGET}"
    exit
    ;;
  --verify-package)
    [ "$#" -eq 1 ] || { echo "usage: $0 --verify-package" >&2; exit 2; }
    verify_package
    exit
    ;;
  "")
    ;;
  *)
    echo "usage: $0 [--verify [path] | --verify-package]" >&2
    exit 2
    ;;
esac

mkdir -p "$DEST"
if [ -e "$TARGET" ] && verify_file "$TARGET"; then
  exit 0
fi

TMP="$DEST/.${BIN}.tmp.$$"
cleanup() { rm -f -- "$TMP"; }
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

echo "[fetch-win-cloudflared] fetching $CLOUDFLARED_URL ..."
curl --fail --location --silent --show-error --retry 3 --retry-delay 2 \
  --proto '=https' --tlsv1.2 --output "$TMP" "$CLOUDFLARED_URL"
verify_file "$TMP"
mv -f -- "$TMP" "$TARGET"
verify_file "$TARGET"
exit 0
