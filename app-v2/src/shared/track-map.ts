// Shared types for the track-map data layer.
//
// The track-map module produces two complementary outputs that the renderer
// (dashboards/overlays) can draw on top of:
//
//   1. `iracing-svg` — the OFFICIAL iRacing Data API SVG layers (same source
//      SimHub uses). Requires the user to provide iRacing credentials once;
//      after that we cache the layers per track_id under userData and serve
//      them as plain text to the renderer.
//
//   2. `learned`     — a normalized polyline (0..1 viewBox) inferred from a
//      clean flying lap captured from telemetry. Works offline, on every sim,
//      and on Mac. Used as a fallback when the iRacing SVG is unavailable.
//
// The renderer keeps ZERO knowledge of how the data was produced: it just gets
// a `TrackMapData` object and renders whichever fields are populated.

export type TrackMapSource = 'iracing-svg' | 'learned' | 'none'

// SVG layer keys that come from the iRacing `track/assets` endpoint. We expose
// them all so the renderer can compose the map (background → inactive → active
// → pitroad → start-finish → turns) just like SimHub does.
export interface TrackMapSvgLayers {
  background?: string
  inactive?: string
  active?: string
  pitroad?: string
  startFinish?: string
  turns?: string
}

// A point on the learned polyline, normalized so both axes live in [0, 1].
export interface TrackMapPoint {
  x: number
  y: number
}

// Plain `[minX, minY, width, height]` tuple matching SVG's `viewBox` attribute.
// Always set to `[0, 0, 1, 1]` for `learned` maps so renderers can use a single
// transform for both kinds.
export type TrackMapViewBox = [number, number, number, number]

// Exact layout selector used by map lookup IPC. `trackId` is authoritative when
// available; otherwise callers must provide the venue + configuration pair.
export interface TrackMapLayoutLookup {
  trackId?: number
  trackName: string
  trackConfigName?: string
}

// Live state of the telemetry lap-learner while it is recording the current
// lap. This is the SimHub-style path: the car's position is captured every
// tick and the polyline grows until the lap closes. Surfacing it lets the UI
// draw the trace WHILE it is being recorded and show a REAL progress value
// (lapDistPct coverage of the current recording lap) instead of a static one.
export interface TrackMapRecording {
  // True while a clean lap is actively being captured for the current track.
  active: boolean
  // 0..1 — how much of the current recording lap has been covered so far
  // (driven distance as a fraction of the lap). Reaches ~1 right before the
  // learned map is finalized.
  progress: number
  // Number of raw samples captured so far this lap (diagnostic / UI hint).
  sampleCount: number
  // Which acquisition mode the learner locked onto for this lap.
  mode?: 'lat-lon' | 'velocity-yaw'
  // 'warming' while the car drives toward the start/finish line to anchor the
  // recording (mid-lap start); 'recording' once the lap is being captured.
  phase?: 'warming' | 'recording'
  // True when this capture was forced by the user ("Gravar mapa agora").
  manual?: boolean
  // Partial, normalized (0..1 viewBox) polyline captured so far. Open path
  // (NOT closed) because the lap is still in progress. May be empty when fewer
  // than two samples exist yet.
  polyline?: TrackMapPoint[]
  // Always [0,0,1,1] — kept so renderers can treat it like a `learned` map.
  viewBox?: TrackMapViewBox
}

export interface TrackMapData {
  source: TrackMapSource
  // Canonical immutable layout key (`id:<TrackID>` when authoritative, otherwise
  // normalized venue + configuration). Prevents same-venue layouts from sharing.
  layoutKey?: string
  // Best-effort identifiers. May be undefined when source === 'none'.
  trackId?: number
  trackName?: string
  trackConfigName?: string

  // iracing-svg payload — all layers cached on disk and read back as strings
  // so the renderer can inline them into the DOM (DOMParser / dangerouslySet).
  // `svg` is the "active" layer for convenience (kept for backwards-compat).
  svg?: string
  svgLayers?: TrackMapSvgLayers

  // learned payload — normalized 0..1 polyline + optional start/finish marker.
  polyline?: TrackMapPoint[]
  startFinishPct?: number // 0..1 — index into polyline where the lap wraps.

  // Always [0,0,1,1] for `learned`; for `iracing-svg` we forward the viewBox
  // declared inside the SVG when we can parse it cheaply, otherwise undefined.
  viewBox?: TrackMapViewBox

  // Present only for the CURRENT track while the learner is capturing a lap.
  // Independent of `source`: it can accompany `source: 'none'` (first lap, no
  // map yet) so the UI can draw the live trace, or `source: 'learned'` while a
  // newer lap is being re-recorded over an older cached one.
  recording?: TrackMapRecording
}

// ─── Credentials & status ───────────────────────────────────────────────────
// The credential surface is intentionally minimal: the user provides email +
// raw password ONCE, we hash + encrypt + persist, and from then on the only
// thing the renderer can observe is the auth status.

export interface TrackMapCredentialsInput {
  email: string
  password: string
}

// Payload for `trackmap:submitMfa` — the verification code iRacing emails/asks
// for when the account has multi-factor / verification enabled.
export interface TrackMapMfaInput {
  code: string
}

export type TrackMapAuthStatus =
  | 'unconfigured' // no credentials saved yet
  | 'ready' // credentials saved, last auth attempt succeeded
  | 'authenticating' // request in flight (incl. embedded browser login open)
  | 'mfa-required' // login accepted but iRacing wants a verification code
  | 'needs-login' // credentials saved but auth was rejected / expired
  | 'rate-limited' // members-ng returned 429
  | 'error' // network / unexpected error
  | 'disabled' // Electron safeStorage not available on this machine

// How the active iRacing session was established:
//   • 'browser'  — the PRIMARY path: the user logged in once through the real
//     iRacing web page (CAPTCHA/2FA handled there) and we captured the session
//     cookie. No password is stored.
//   • 'password' — the LEGACY/advanced headless email+password path. Still works
//     for accounts that kept legacy/read-only auth enabled.
export type TrackMapLoginMethod = 'oauth' | 'browser' | 'password'

export interface TrackMapOAuthConfig {
  clientId: string
  clientSecret?: string
  updatedAt?: number
}

export interface TrackMapDataApiDiagnostic {
  status: number
  body: string
  authMode: 'oauth' | 'cookie' | 'none'
}

// Always-available telemetry-learner diagnostics, surfaced to the UI so the user
// can see WHY a map is (or isn't) being learned and force a capture. Independent
// of `currentSource` — present even when nothing is recording (e.g. "too slow").
export interface TrackMapLearnState {
  // 'idle' (not capturing), 'warming' (driving to the S/F line to anchor), or
  // 'recording' (actively capturing the lap).
  phase: 'idle' | 'warming' | 'recording'
  // 0..1 driven fraction of the current recording lap (0 while warming/idle).
  progress: number
  sampleCount: number
  // True when the active capture was forced via "Gravar mapa agora".
  manual: boolean
  mode?: 'lat-lon' | 'velocity-yaw'
  // Machine reason + PT-BR label for the current state, e.g. 'too-slow'.
  reason: string
  reasonLabel: string
  // True when a learned map already exists for the current track.
  hasMap: boolean
}

export interface TrackMapStatus {
  auth: TrackMapAuthStatus
  email?: string
  lastAuthAt?: number // epoch ms
  lastErrorMessage?: string
  // True when safeStorage reports encryption is available — credentials cannot
  // be persisted at all when this is false, so the renderer can show a hint.
  encryptionAvailable: boolean
  // Track currently being served by `trackmap:getForCurrentTrack`. Updated on
  // every successful resolve so the renderer can show "Spa-Francorchamps" etc.
  currentTrackName?: string
  currentTrackConfigName?: string
  currentLayoutKey?: string
  currentSource?: TrackMapSource
  // Live telemetry-learner diagnostics + progress for the status panel.
  learn?: TrackMapLearnState
  // Which auth path is currently active (undefined when not logged in). Lets the
  // renderer tell the user whether the captured browser session or the legacy
  // password login is in effect.
  loginMethod?: TrackMapLoginMethod
  // For `loginMethod === 'browser'`: when the captured session cookie expires
  // (epoch ms), when iRacing provides an expiry. Undefined for session-only
  // cookies. The renderer uses it to warn the user to re-login.
  sessionExpiresAt?: number
  oauthConfigured?: boolean
  oauthClientId?: string
  dataApiAvailable?: boolean
  dataApiMessage?: string
}

// Result of `trackmap:setCredentials` and `trackmap:submitMfa`. We RETURN this
// (instead of throwing) for the happy and MFA paths so the renderer can branch:
//   • 'ok'           → authenticated; credentials persisted.
//   • 'mfa_required' → iRacing accepted the password but wants a verification
//                      code; the renderer must prompt for it and then call
//                      `trackmap:submitMfa`.
// Hard failures (bad password, network, rate-limit) still reject the IPC call
// so the existing error surface keeps working unchanged.
export interface TrackMapAuthResult {
  status: 'ok' | 'mfa_required'
  // User-facing hint (PT-BR) for the MFA prompt, when provided by iRacing.
  message?: string
  // Snapshot of the auth status after the attempt, so callers can update UI in
  // one round-trip without a follow-up `getStatus`.
  trackMap: TrackMapStatus
}

// Result of `trackmap:browserLogin` — the embedded-browser login flow. The IPC
// call resolves only AFTER the login window closes, so the renderer can keep a
// local "opening…" state while it is pending and branch on the outcome:
//   • 'ok'        → the iRacing session cookie was captured and is now in use.
//   • 'cancelled' → the user closed the login window (or it failed to open)
//                   without completing login. The offline learned map keeps
//                   working regardless.
// Capture diagnostics surfaced by the embedded-browser login so the renderer can
// explain WHY a capture failed instead of a silent "nada acontece":
//   • authCookieSeen — a recognised iRacing auth cookie was present in the jar.
//   • probeVerdict   — verdict of the authenticated /data/member/info probe.
//   • cookieCount    — total cookies in the iRacing partition (all domains).
export interface TrackMapLoginDiagnostics {
  authCookieSeen: boolean
  probeVerdict: 'authed' | 'unauthed' | 'unknown'
  cookieCount: number
}

export interface TrackMapBrowserLoginResult {
  status: 'ok' | 'cancelled'
  // User-facing (PT-BR) hint, e.g. the cancellation reason.
  message?: string
  // Auth-status snapshot after the attempt (mirrors TrackMapAuthResult).
  trackMap: TrackMapStatus
  // Best-effort capture diagnostics (see TrackMapLoginDiagnostics). Present when
  // the login window could gather them; undefined when it threw before opening.
  diagnostics?: TrackMapLoginDiagnostics
}

// ─── IPC channel names ──────────────────────────────────────────────────────
// Re-exported as a const so callers (preload allowlist, renderer hooks) can
// import a single symbol instead of typing string literals. The preload bridge
// already permits the `trackmap:` prefix.

export const TRACK_MAP_CHANNELS = {
  getForCurrentTrack: 'trackmap:getForCurrentTrack',
  getForTrack: 'trackmap:getForTrack',
  setCredentials: 'trackmap:setCredentials',
  submitMfa: 'trackmap:submitMfa',
  // PRIMARY login path: open the real iRacing web login in an embedded window,
  // let the user clear CAPTCHA/2FA, then capture + persist the session cookie.
  browserLogin: 'trackmap:browserLogin',
  oauthLogin: 'trackmap:oauthLogin',
  getOAuthConfig: 'trackmap:getOAuthConfig',
  setOAuthConfig: 'trackmap:setOAuthConfig',
  testDataApi: 'trackmap:testDataApi',
  clearCredentials: 'trackmap:clearCredentials',
  getStatus: 'trackmap:getStatus',
  refresh: 'trackmap:refresh',
  // Telemetry-learner manual controls. `startLearning` forces a capture to begin
  // RIGHT NOW (anchored at the car's current position, mid-lap allowed) so the
  // user never has to be near the start/finish line; `cancelLearning` aborts the
  // in-flight capture. Both also act as "Reiniciar gravação".
  startLearning: 'trackmap:startLearning',
  cancelLearning: 'trackmap:cancelLearning',
  // Broadcast emitted whenever the cached map for the active track changes.
  // Payload is the fresh `TrackMapData`.
  updated: 'trackmap:updated'
} as const

export type TrackMapChannel = (typeof TRACK_MAP_CHANNELS)[keyof typeof TRACK_MAP_CHANNELS]
