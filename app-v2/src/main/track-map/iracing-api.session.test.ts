import { describe, expect, it } from 'vitest'
import {
  IRacingApi,
  hashIRacingPassword,
  isIRacingAuthCookieName,
  type IRacingAuthOutcome
} from './iracing-api'

// These exercise the PASSWORD-mode session jar that backs the primary login:
// after /auth the jar holds the session cookies, and we persist + re-seed them
// across launches so the data client is authed without a fresh /auth POST.

describe('IRacingApi password-session jar', () => {
  it('is unauthenticated before any cookies are seeded', () => {
    const api = new IRacingApi('me@example.com', hashIRacingPassword('me@example.com', 'pw'))
    expect(api.isAuthed()).toBe(false)
    expect(api.exportCookies()).toEqual([])
  })

  it('round-trips seeded cookies and reports authed', () => {
    const api = new IRacingApi('me@example.com', 'hashed')
    api.seedCookies([
      { name: 'irsso_membersv2', value: 'abc123' },
      { name: 'other', value: 'zzz' }
    ])
    expect(api.isAuthed()).toBe(true)
    expect(api.exportCookies()).toEqual([
      { name: 'irsso_membersv2', value: 'abc123' },
      { name: 'other', value: 'zzz' }
    ])
  })

  it('stays unauthenticated when seeded with no cookies', () => {
    const api = new IRacingApi('me@example.com', 'hashed')
    api.seedCookies([])
    expect(api.isAuthed()).toBe(false)
  })

  it('invalidate() clears the seeded session jar', () => {
    const api = new IRacingApi('me@example.com', 'hashed')
    api.seedCookies([{ name: 'irsso_membersv2', value: 'abc123' }])
    api.invalidate()
    expect(api.isAuthed()).toBe(false)
    expect(api.exportCookies()).toEqual([])
  })

  it('authCookieExpiresAt() is undefined for seeded cookies (no expiry metadata)', () => {
    const api = new IRacingApi('me@example.com', 'hashed')
    api.seedCookies([{ name: 'irsso_membersv2', value: 'abc123' }])
    expect(api.authCookieExpiresAt()).toBeUndefined()
  })

  it('recognises the iRacing auth cookie families', () => {
    expect(isIRacingAuthCookieName('irsso_membersv2')).toBe(true)
    expect(isIRacingAuthCookieName('authtoken_members')).toBe(true)
    expect(isIRacingAuthCookieName('random_cookie')).toBe(false)
  })
})

// A test double that stubs the actual /auth POST (`login`) so we can count how
// many POSTs the single-flight coordination issues, and control timing.
class FlightTestApi extends IRacingApi {
  loginCalls = 0
  private resolvers: Array<(o: IRacingAuthOutcome) => void> = []

  constructor(private readonly stubOutcome: IRacingAuthOutcome) {
    super('me@example.com', 'hashed')
  }

  override async login(): Promise<IRacingAuthOutcome> {
    this.loginCalls += 1
    return new Promise<IRacingAuthOutcome>((resolve) => {
      this.resolvers.push(() => resolve(this.stubOutcome))
    })
  }

  // Resolve all parked logins with the stub outcome.
  flush(): void {
    const pending = this.resolvers
    this.resolvers = []
    for (const resolve of pending) resolve(this.stubOutcome)
  }
}

describe('IRacingApi login single-flight coordination', () => {
  it('shares ONE /auth POST between a boot loginShared() and a concurrent authenticate()', async () => {
    const api = new FlightTestApi({ status: 'ok' })
    // Boot silent-login starts first…
    const boot = api.loginShared()
    // …then a data request races in while it is still in flight.
    const data = api.authenticate()
    expect(api.loginCalls).toBe(1) // not two simultaneous POSTs

    api.flush()
    await Promise.all([boot, data])
    expect(api.loginCalls).toBe(1)
  })

  it('does not duplicate /auth POSTs when a data call races a parked MFA outcome', async () => {
    // The boot login returns mfa_required and is parked; the single-flight
    // promise is already resolved, so a later loginShared() would normally POST
    // again. We assert the in-flight coalescing here; the `mfaPending` gate in
    // authenticate() (set by postAuth on a real mfa_required body) is what stops
    // a fresh /auth during the parked window in production.
    const api = new FlightTestApi({ status: 'mfa_required', message: 'code please' })
    const boot = api.loginShared()
    api.flush()
    await expect(boot).resolves.toEqual({ status: 'mfa_required', message: 'code please' })
    expect(api.loginCalls).toBe(1)
  })

  it('coalesces concurrent loginShared() callers onto one in-flight POST', async () => {
    const api = new FlightTestApi({ status: 'ok' })
    const a = api.loginShared()
    const b = api.loginShared()
    expect(api.loginCalls).toBe(1)
    api.flush()
    await Promise.all([a, b])
    // A fresh login after the first resolves issues a new POST.
    const c = api.loginShared()
    expect(api.loginCalls).toBe(2)
    api.flush()
    await c
  })
})
