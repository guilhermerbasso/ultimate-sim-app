import { describe, expect, it } from 'vitest'

import { buildDataApiAuthHeaders } from './iracing-api'
import { createPkcePair, parseTokenResponse } from './oauth'

describe('iRacing OAuth PKCE', () => {
  it('creates the S256 challenge for the RFC 7636 known vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(createPkcePair(verifier).challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('iRacing OAuth token parsing', () => {
  it('normalizes token expirations and accepts Bearer', () => {
    const tokens = parseTokenResponse(
      {
        access_token: 'access',
        refresh_token: 'refresh-1',
        expires_in: 600,
        refresh_token_expires_in: 604800,
        token_type: 'Bearer'
      },
      1_000
    )
    expect(tokens).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh-1',
      tokenType: 'Bearer',
      expiresAt: 601_000,
      refreshTokenExpiresAt: 604_801_000
    })
  })

  it('models refresh-token rotation by replacing the stored refresh token', () => {
    const first = parseTokenResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 600,
      refresh_token_expires_in: 604800,
      token_type: 'Bearer'
    })
    const rotated = parseTokenResponse({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 600,
      refresh_token_expires_in: 604800,
      token_type: 'Bearer'
    })
    expect(rotated.refreshToken).not.toBe(first.refreshToken)
    expect(rotated.refreshToken).toBe('refresh-2')
  })

  it('on refresh, carries forward the previous refresh token/expiry when the server omits them (RFC 6749 §5.1)', () => {
    const previous = { refreshToken: 'refresh-keep', refreshTokenExpiresAt: 999_000 }
    const refreshed = parseTokenResponse(
      { access_token: 'access-new', expires_in: 600, token_type: 'Bearer' },
      1_000,
      previous
    )
    expect(refreshed.accessToken).toBe('access-new')
    expect(refreshed.refreshToken).toBe('refresh-keep')
    expect(refreshed.refreshTokenExpiresAt).toBe(999_000)
    expect(refreshed.expiresAt).toBe(601_000)
  })

  it('still requires a refresh token on the INITIAL exchange (no previous to carry forward)', () => {
    expect(() => parseTokenResponse({ access_token: 'a', expires_in: 600, token_type: 'Bearer' })).toThrow(
      /refresh_token/
    )
  })

  it('rejects a non-Bearer token type', () => {
    expect(() =>
      parseTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 600, refresh_token_expires_in: 1, token_type: 'mac' })
    ).toThrow(/token_type/)
  })
})

describe('iRacing Data API auth selection', () => {
  it('prefers OAuth Bearer over cookies when both are present', () => {
    expect(
      buildDataApiAuthHeaders('oauth-token', [{ name: 'irsso_membersv2', value: 'cookie-token' }])
    ).toEqual({ headers: { authorization: 'Bearer oauth-token' }, authMode: 'oauth' })
  })

  it('falls back to cookies when no Bearer token exists', () => {
    expect(buildDataApiAuthHeaders(null, [{ name: 'irsso_membersv2', value: 'cookie-token' }])).toEqual({
      headers: { cookie: 'irsso_membersv2=cookie-token' },
      authMode: 'cookie'
    })
  })
})
