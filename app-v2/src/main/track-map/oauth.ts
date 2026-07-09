import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { URLSearchParams } from 'node:url'
import { BrowserWindow, safeStorage } from 'electron'

import type { TrackMapOAuthConfig } from '../../shared/track-map'
import { IRACING_PARTITION } from './browser-login'

const AUTHORIZE_URL = 'https://oauth.iracing.com/oauth2/authorize'
const TOKEN_HOST = 'oauth.iracing.com'
const TOKEN_PATH = '/oauth2/token'
const OAUTH_FILE = 'iracing-oauth.bin'
const REQUEST_TIMEOUT_MS = 15_000
const TOKEN_EXPIRY_SKEW_MS = 60_000

export interface IRacingOAuthTokenSet {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresAt: number
  refreshTokenExpiresAt: number
}

interface PersistedOAuth {
  version: 1
  config: TrackMapOAuthConfig
  tokens?: IRacingOAuthTokenSet
}

interface TokenResponseJson {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  refresh_token_expires_in?: unknown
  token_type?: unknown
}

export function base64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function createPkcePair(verifier = base64Url(randomBytes(32))): {
  verifier: string
  challenge: string
} {
  return {
    verifier,
    challenge: base64Url(createHash('sha256').update(verifier).digest())
  }
}

export function parseTokenResponse(
  json: TokenResponseJson,
  now = Date.now(),
  previous?: Pick<IRacingOAuthTokenSet, 'refreshToken' | 'refreshTokenExpiresAt'>
): IRacingOAuthTokenSet {
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new Error('Invalid OAuth response: access_token ou expires_in missing.')
  }
  const tokenType = typeof json.token_type === 'string' ? json.token_type : 'Bearer'
  if (tokenType.toLowerCase() !== 'bearer') {
    throw new Error(`Invalid OAuth response: token_type=${tokenType}`)
  }
  // RFC 6749 §5.1: a REFRESH response MAY omit a rotated `refresh_token` (the
  // existing one stays valid) and the non-standard `refresh_token_expires_in`.
  // Carry the previous values forward so silent renewal never fails just because
  // the server didn't re-echo them. The initial code exchange passes no
  // `previous`, so it still strictly requires a refresh_token.
  const refreshToken =
    typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : previous?.refreshToken
  if (!refreshToken) {
    throw new Error('Invalid OAuth response: refresh_token missing.')
  }
  const refreshTokenExpiresAt =
    typeof json.refresh_token_expires_in === 'number'
      ? now + json.refresh_token_expires_in * 1000
      : previous?.refreshTokenExpiresAt ?? now + 7 * 24 * 60 * 60 * 1000
  return {
    accessToken: json.access_token,
    refreshToken,
    tokenType: 'Bearer',
    expiresAt: now + json.expires_in * 1000,
    refreshTokenExpiresAt
  }
}

// Token-endpoint HTTP error carrying the status so the refresh path can tell a
// definitive 4xx (dead/rotated refresh token → clear session) from a transient
// 5xx/network failure (keep tokens, retry later).
class OAuthHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'OAuthHttpError'
  }
}

export class IRacingOAuthService {
  private readonly file: string
  private config: TrackMapOAuthConfig | null = null
  private tokens: IRacingOAuthTokenSet | null = null
  private refreshInFlight: Promise<string | null> | null = null

  constructor(userDataPath: string) {
    this.file = join(userDataPath, OAUTH_FILE)
  }

  encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  getConfig(): TrackMapOAuthConfig | null {
    return this.config ? { ...this.config, clientSecret: this.config.clientSecret ? '••••••••' : undefined } : null
  }

  hasClientId(): boolean {
    return Boolean(this.config?.clientId)
  }

  hasTokens(): boolean {
    return Boolean(this.tokens?.refreshToken || this.tokens?.accessToken)
  }

  async load(): Promise<void> {
    if (!this.encryptionAvailable()) return
    let cipher: Buffer
    try {
      cipher = await readFile(this.file)
    } catch {
      return
    }
    try {
      const parsed = JSON.parse(safeStorage.decryptString(cipher)) as Partial<PersistedOAuth>
      if (parsed.version !== 1 || !parsed.config || typeof parsed.config.clientId !== 'string') return
      this.config = {
        clientId: parsed.config.clientId,
        clientSecret:
          typeof parsed.config.clientSecret === 'string' && parsed.config.clientSecret
            ? parsed.config.clientSecret
            : undefined,
        updatedAt: typeof parsed.config.updatedAt === 'number' ? parsed.config.updatedAt : undefined
      }
      if (parsed.tokens && typeof parsed.tokens.accessToken === 'string') {
        this.tokens = parsed.tokens
      }
    } catch {
      await this.clear().catch(() => undefined)
    }
  }

  async saveConfig(config: TrackMapOAuthConfig): Promise<TrackMapOAuthConfig> {
    const clientId = config.clientId.trim()
    const clientSecret = config.clientSecret?.trim()
    this.config = {
      clientId,
      clientSecret: clientSecret || undefined,
      updatedAt: Date.now()
    }
    if (!clientId) this.tokens = null
    await this.persist()
    return this.getConfig() ?? { clientId: '' }
  }

  async clear(): Promise<void> {
    this.config = null
    this.tokens = null
    try {
      await rm(this.file, { force: true })
    } catch {
      // ignore
    }
  }

  async getAccessToken(forceRefresh = false): Promise<string | null> {
    if (!this.config?.clientId) return null
    if (
      !forceRefresh &&
      this.tokens?.accessToken &&
      this.tokens.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS
    ) {
      return this.tokens.accessToken
    }
    if (!this.tokens?.refreshToken) return null
    if (this.tokens.refreshTokenExpiresAt <= Date.now() + TOKEN_EXPIRY_SKEW_MS) return null
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.refreshAccessToken().finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  async authorize(parent?: BrowserWindow | null): Promise<IRacingOAuthTokenSet> {
    if (!this.config?.clientId) {
      throw new Error('Paste an iRacing OAuth client_id before connecting.')
    }
    const state = base64Url(randomBytes(24))
    const pkce = createPkcePair()
    const loopback = await startLoopback(state)
    let win: BrowserWindow | null = null
    try {
      const authorizeUrl = new URL(AUTHORIZE_URL)
      authorizeUrl.searchParams.set('client_id', this.config.clientId)
      authorizeUrl.searchParams.set('redirect_uri', loopback.redirectUri)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('code_challenge', pkce.challenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('state', state)
      authorizeUrl.searchParams.set('scope', 'iracing.auth')

      win = openOAuthWindow(authorizeUrl.toString(), parent)
      const closed = new Promise<never>((_resolve, reject) => {
        win?.once('closed', () => reject(new Error('OAuth canceled by user.')))
      })
      const code = await Promise.race([loopback.codePromise, closed])
      if (win && !win.isDestroyed()) win.close()
      const tokens = await this.exchangeCode(code, loopback.redirectUri, pkce.verifier)
      this.tokens = tokens
      await this.persist()
      return tokens
    } finally {
      loopback.close()
      if (win && !win.isDestroyed()) win.close()
    }
  }

  private async refreshAccessToken(): Promise<string | null> {
    if (!this.config?.clientId || !this.tokens?.refreshToken) return null
    try {
      const tokens = await this.postToken(
        {
          grant_type: 'refresh_token',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: this.tokens.refreshToken
        },
        { refreshToken: this.tokens.refreshToken, refreshTokenExpiresAt: this.tokens.refreshTokenExpiresAt }
      )
      this.tokens = tokens
      await this.persist()
      return tokens.accessToken
    } catch (error) {
      // A definitive 4xx (invalid_grant — the single-use refresh token was
      // rotated/revoked/expired) means the session is dead. Clear the tokens so
      // the app cleanly falls back to "needs OAuth login" instead of retrying a
      // dead token on every request. 429 (rate-limit) is a TRANSIENT 4xx — keep
      // the tokens and retry later. 5xx / network also keep the tokens.
      if (error instanceof OAuthHttpError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        this.tokens = null
        await this.persist().catch(() => undefined)
        return null
      }
      throw error
    }
  }

  private exchangeCode(code: string, redirectUri: string, verifier: string): Promise<IRacingOAuthTokenSet> {
    if (!this.config?.clientId) throw new Error('OAuth client_missing id.')
    return this.postToken({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  }

  private async postToken(
    fields: Record<string, string | undefined>,
    previous?: Pick<IRacingOAuthTokenSet, 'refreshToken' | 'refreshTokenExpiresAt'>
  ): Promise<IRacingOAuthTokenSet> {
    const body = new URLSearchParams()
    for (const [key, value] of Object.entries(fields)) {
      if (value) body.set(key, value)
    }
    const response = await httpsFormPost(TOKEN_HOST, TOKEN_PATH, body.toString())
    if (response.status < 200 || response.status >= 300) {
      throw new OAuthHttpError(
        response.status,
        `OAuth token endpoint returned HTTP ${response.status}: ${response.body.slice(0, 500)}`
      )
    }
    return parseTokenResponse(JSON.parse(response.body) as TokenResponseJson, Date.now(), previous)
  }

  private async persist(): Promise<void> {
    if (!this.encryptionAvailable()) throw new Error('safeStorage unavailable for saving OAuth.')
    const payload: PersistedOAuth = {
      version: 1,
      config: this.config ?? { clientId: '' },
      tokens: this.tokens ?? undefined
    }
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, safeStorage.encryptString(JSON.stringify(payload)), { mode: 0o600 })
  }
}

function openOAuthWindow(url: string, parent?: BrowserWindow | null): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 820,
    minWidth: 460,
    minHeight: 640,
    title: 'OAuth iRacing — Ultimate Sim App',
    parent: parent ?? undefined,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      partition: IRACING_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.loadURL(url).catch(() => {
    if (!win.isDestroyed()) win.close()
  })
  return win
}

async function startLoopback(expectedState: string): Promise<{
  redirectUri: string
  codePromise: Promise<string>
  close: () => void
}> {
  let server: Server | null = null
  let resolveCode: (code: string) => void
  let rejectCode: (error: Error) => void
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found')
        return
      }
      const state = url.searchParams.get('state') ?? ''
      const code = url.searchParams.get('code') ?? ''
      const error = url.searchParams.get('error') ?? ''
      if (state !== expectedState) throw new Error('Invalid OAuth state.')
      if (error) throw new Error(`OAuth returned an error: ${error}`)
      if (!code) throw new Error('OAuth callback did not include a code.')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><title>iRacing connected</title><body>iRacing connected. You can return to Ultimate Sim App.</body>')
      resolveCode(code)
    } catch (error) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(error instanceof Error ? error.message : String(error))
      rejectCode(error instanceof Error ? error : new Error(String(error)))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to open OAuth loopback.')
  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    codePromise,
    close: () => server?.close()
  }
}

function httpsFormPost(host: string, path: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        method: 'POST',
        host,
        port: 443,
        path,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'content-length': Buffer.byteLength(body, 'utf8').toString()
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error(`OAuth request timeout after ${REQUEST_TIMEOUT_MS}ms`)))
    req.end(body)
  })
}
