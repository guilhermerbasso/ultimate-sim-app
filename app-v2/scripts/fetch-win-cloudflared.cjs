'use strict'
// electron-builder beforePack hook for cloudflared.exe.
// Reads the SHA-256 pin from fetch-win-cloudflared.sh (single source of truth)
// and verifies the binary before packaging.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

module.exports.beforePack = async function beforePack() {
  const sh = fs.readFileSync(path.join(__dirname, 'fetch-win-cloudflared.sh'), 'utf8')
  const expected = sh.match(/^CLOUDFLARED_SHA256="([0-9a-f]{64})"$/m)?.[1]
  const binary = path.join(__dirname, '..', 'resources', 'cloudflared', 'cloudflared.exe')
  if (!expected) throw new Error('[fetch-win-cloudflared] cloudflared SHA256 pin is missing')
  if (!fs.existsSync(binary) || !fs.statSync(binary).size) {
    throw new Error(`[fetch-win-cloudflared] Missing cloudflared resource: ${binary}`)
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex')
  if (actual !== expected) {
    throw new Error(`[fetch-win-cloudflared] SHA256 mismatch: expected ${expected}, got ${actual}`)
  }
  console.log(`[fetch-win-cloudflared] electron-builder preflight verified sha256:${actual}`)
}
