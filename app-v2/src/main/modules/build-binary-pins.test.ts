import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPTS = join(process.cwd(), 'scripts')

function script(name: string): string {
  return readFileSync(join(SCRIPTS, name), 'utf8')
}

// Every binary that ends up EXECUTED on a user's machine — or that is unpacked into the
// installer — must be pinned by origin, version and hash before it is used. These scripts
// run on a build host with no other gate in front of them, so a moved release tag or a
// tampered CDN response would otherwise be packaged silently.
describe('build-time binary pinning', () => {
  it('pins cloudflared by version and SHA-256 and verifies before use', () => {
    const source = script('fetch-win-cloudflared.sh')

    expect(source).toMatch(/CLOUDFLARED_VERSION="\d{4}\.\d+\.\d+"/)
    expect(source).toMatch(/CLOUDFLARED_SHA256="[0-9a-f]{64}"/)
    expect(source).toContain('verify_file "$TMP"')
    expect(source).toContain('verify_file "$TARGET"')
  })

  it('pins the whisper.cpp Windows runtime and verifies the archive before extracting', () => {
    const source = script('fetch-win-whisper.sh')

    expect(source).toMatch(/WHISPER_VER="v\d+\.\d+\.\d+"/)
    expect(source).toMatch(/ASSET_SHA256="[0-9a-f]{64}"/)

    const verifyAt = source.indexOf('verify_sha256 "$WORK/whisper.zip"')
    const unzipAt = source.indexOf('unzip -q -o "$WORK/whisper.zip"')
    expect(verifyAt).toBeGreaterThan(0)
    expect(unzipAt).toBeGreaterThan(verifyAt)
  })

  it('verifies the sherpa engine tarball against the integrity pinned in package-lock.json', () => {
    const source = script('fetch-win-sherpa.sh')
    const lock = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string; integrity?: string }>
    }

    // The tarball is fetched with curl, which bypasses npm's own integrity check, so the
    // lockfile pin is the only thing standing between the build and an unverified addon.
    expect(source).toContain('node_modules/sherpa-onnx-win-x64')
    expect(source).toContain('verify_integrity "$WORK_ENGINE/win-x64.tgz" "$EXPECTED_INTEGRITY"')
    expect(source).toContain('Refusing to install an unverified native engine')

    const pin = lock.packages['node_modules/sherpa-onnx-win-x64']
    expect(pin?.version).toBeTruthy()
    expect(pin?.integrity).toMatch(/^sha512-/)
  })

  it('pins the espeak-ng-data bundle taken from the moving sherpa tts-models tag', () => {
    const source = script('fetch-win-sherpa.sh')

    expect(source).toMatch(/BUNDLE_SHA256="[0-9a-f]{64}"/)
    expect(source).toContain('[ "$(sha256_of "$WORK_DATA/seed.tar.bz2")" = "$BUNDLE_SHA256" ]')
  })

  it('pins the piper Windows engine archive and verifies it before extracting', () => {
    const source = script('fetch-piper-voices.sh')

    expect(source).toMatch(/PIPER_ZIP_SHA256="[0-9a-f]{64}"/)

    const verifyAt = source.indexOf('ACTUAL_SHA256="$(sha256_of "${PIPER_ZIP}")"')
    const unzipAt = source.indexOf('unzip -jo "${PIPER_ZIP}"')
    expect(verifyAt).toBeGreaterThan(0)
    expect(unzipAt).toBeGreaterThan(verifyAt)
  })

  it('resolves the llama backend through npm pack so the registry integrity check applies', () => {
    const source = script('fetch-win-llama.sh')

    expect(source).toContain('npm pack "@node-llama-cpp/win-x64@$VER"')
    expect(source).toContain("require('./node_modules/node-llama-cpp/package.json').version")
    expect(source).not.toMatch(/curl[^\n]*node-llama-cpp/)
  })

  it('downloads every pinned asset over https only', () => {
    for (const name of [
      'fetch-win-cloudflared.sh',
      'fetch-win-whisper.sh',
      'fetch-win-sherpa.sh',
      'fetch-piper-voices.sh'
    ]) {
      const source = script(name)
      // Collapse shell line continuations so a multi-line curl reads as one command.
      const commands = source.replace(/\\\r?\n\s*/g, ' ').split('\n')
      for (const line of commands) {
        if (!/(^|\s|&&\s*)curl\s/.test(line)) continue
        expect(line, `${name}: ${line.trim()}`).toContain("--proto '=https'")
      }
      expect(source, name).not.toMatch(/["']http:\/\//)
    }
  })
})
