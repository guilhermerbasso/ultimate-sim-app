// Encrypted persistence for the iRacing PASSWORD-mode session cookie jar.
//
// Why this exists: the legacy email+password login (`POST /auth`) is now the
// PRIMARY path. iRacing accounts with 2FA enabled only challenge for a code when
// a fresh `/auth` POST is made — once we have authenticated we hold a session
// cookie jar (the `Set-Cookie` from /auth). Persisting that jar (encrypted with
// Electron `safeStorage`) lets us re-adopt the session on the NEXT launch and
// drive the data API immediately, WITHOUT a new /auth POST and therefore WITHOUT
// re-prompting 2FA. We only need 2FA again when the stored session no longer
// authenticates and a silent re-login is required.
//
// SECURITY: this file never stores the password or its hash — only the opaque
// session cookies iRacing handed us. They are encrypted at rest just like the
// credentials, and on platforms without safeStorage we simply refuse to persist.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'

import type { IRacingSessionCookie } from './iracing-api'

const SESSION_FILE = 'iracing-session.bin'

export interface PersistedSession {
  version: 1
  // The session cookies captured from the /auth Set-Cookie response.
  cookies: IRacingSessionCookie[]
  // Earliest auth-cookie expiry (epoch ms), when iRacing provided one.
  expiresAt?: number
  // When we captured/refreshed this session (epoch ms).
  capturedAt: number
}

export class IRacingSessionStore {
  private readonly file: string

  constructor(userDataPath: string) {
    this.file = join(userDataPath, SESSION_FILE)
  }

  encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  async load(): Promise<PersistedSession | null> {
    if (!this.encryptionAvailable()) return null
    let cipher: Buffer
    try {
      cipher = await readFile(this.file)
    } catch {
      return null
    }
    try {
      const plain = safeStorage.decryptString(cipher)
      const parsed = JSON.parse(plain) as Partial<PersistedSession>
      if (parsed.version !== 1 || !Array.isArray(parsed.cookies)) return null
      const cookies = parsed.cookies.filter(
        (c): c is IRacingSessionCookie =>
          !!c && typeof c.name === 'string' && typeof c.value === 'string'
      )
      if (cookies.length === 0) return null
      return {
        version: 1,
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: typeof c.domain === 'string' ? c.domain : undefined,
          path: typeof c.path === 'string' ? c.path : undefined
        })),
        expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined,
        capturedAt: typeof parsed.capturedAt === 'number' ? parsed.capturedAt : 0
      }
    } catch {
      // Decryption failed (key rotated, file tampered with). Clear so a fresh
      // login can repopulate it.
      await this.clear().catch(() => undefined)
      return null
    }
  }

  async save(session: PersistedSession): Promise<void> {
    if (!this.encryptionAvailable()) {
      throw new Error('safeStorage is not available on this machine')
    }
    const cipher = safeStorage.encryptString(JSON.stringify(session))
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, cipher, { mode: 0o600 })
  }

  async clear(): Promise<void> {
    try {
      await rm(this.file, { force: true })
    } catch {
      // ignore — a fresh save overwrites it anyway.
    }
  }
}
