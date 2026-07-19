// Voice Spotter / Engenheiro de áudio — shared config contract.
//
// SPOKEN race-engineer/spotter callouts driven by live telemetry. This is
// intentionally distinct from the "Sounds" menu (soundshift/incident/ABS/TCS),
// which only plays beeps/tones. The Voice Spotter SPEAKS using the Web Speech
// API (window.speechSynthesis) in the renderer.
//
// This file is the single source of truth shared between:
//   • src/main/modules/spotter.ts        → persistence (spotter.json + IPC)
//   • src/renderer/src/lib/spotter-runtime.ts → telemetry engine + TTS queue
//   • src/renderer/src/views/SpotterView.tsx  → configuration UI
//
// It carries NO DOM/Node dependencies so both tsconfigs can compile it.

import type { CarLeftRightState } from './telemetry'

export type SpotterLang = 'pt-BR' | 'en-US'

export type CalloutCategory = 'flags' | 'fuel' | 'pit' | 'proximity' | 'incidents' | 'shift' | 'lap'

export type CalloutId =
  // Flags (from TelemetrySnapshot.flags)
  | 'flag.green'
  | 'flag.yellow'
  | 'flag.blue'
  | 'flag.white'
  | 'flag.checkered'
  | 'flag.meatball'
  | 'flag.black'
  // Fuel (fuelLiters / fuelPerLap / lapsRemaining)
  | 'fuel.low'
  | 'fuel.lapsLeft'
  | 'fuel.box'
  // Pit (onPitRoad / pitLimiter / speedKmh / lapsRemaining)
  | 'pit.windowOpen'
  | 'pit.onPitRoad'
  | 'pit.speeding'
  // Proximity & gaps (radarCars / relatives / position)
  | 'proximity.spotter'
  | 'gap.ahead'
  | 'gap.behind'
  | 'position.change'
  // Incidents (incidentCount / incidentLimit)
  | 'incident.points'
  | 'incident.limit'
  // Shift (shiftIndicatorPct) — kept light, Sounds already beeps
  | 'shift.point'
  // Lap (lastLapTimeSec / bestLapTimeSec / deltaToBestSec / connected)
  | 'lap.delta'
  | 'lap.personalBest'
  | 'session.start'

// Per-callout tuning. voiceURI '' means "use the global default voice".
export interface CalloutConfig {
  enabled: boolean
  voiceURI: string
  rate: number // 0.5 .. 2.0 (SpeechSynthesisUtterance.rate)
  pitch: number // 0 .. 2.0
  volume: number // 0 .. 1 (multiplied by masterVolume at speak time)
  cooldownMs: number // minimum interval between repeats of THIS callout
  priority: number // 1 (low) .. 10 (critical) — queue ordering + preemption
}

// Numeric trigger thresholds. Surfaced in the UI under each category's
// "Avançado" block so the engine stays fully data-driven.
export interface SpotterThresholds {
  fuelLowLaps: number // fuel.low when laps-of-fuel <= this
  fuelBoxLaps: number // fuel.box when laps-of-fuel <= this AND < laps remaining
  pitSpeedLimitKmh: number // pit.speeding when on pit road, limiter off, above this
  pitWindowOpenLaps: number // pit.windowOpen when laps remaining <= this
  incidentWarnMargin: number // incident.limit when (limit - count) <= this
  gapChangeSec: number // min gap change (between calls) to say closing/pulling away
  proximityAheadMeters: number // |relativeY| under which a side car counts as alongside
  proximitySideMeters: number // |relativeX| under which a side car counts as alongside
}

export interface SpotterConfig {
  version: 1
  enabled: boolean // master engine on/off
  muted: boolean // global mute — engine keeps tracking state but stays silent
  masterVolume: number // 0 .. 1 master gain applied to every callout
  language: SpotterLang // phrase set + voice filtering hint; synced from app settings
  defaultVoiceURI: string // fallback voice for callouts with voiceURI === ''
  outputDeviceId: string // best-effort; see note below
  thresholds: SpotterThresholds
  callouts: Record<CalloutId, CalloutConfig>
  updatedAt: number
}

export const SPOTTER_CHANNELS = {
  getConfig: 'spotter:getConfig',
  setConfig: 'spotter:setConfig',
  configEvent: 'spotter:config'
} as const

export interface CalloutMeta {
  id: CalloutId
  category: CalloutCategory
  label: string
  description: string
  defaultEnabled: boolean
  defaultPriority: number
  defaultCooldownMs: number
}

// Catalog drives both the default config and the UI. Order = display order.
export const CALLOUT_CATALOG: CalloutMeta[] = [
  // ── Flags ──────────────────────────────────────────────────────────────────
  { id: 'flag.green', category: 'flags', label: 'Green', description: 'Start / restart — track clear.', defaultEnabled: true, defaultPriority: 5, defaultCooldownMs: 8000 },
  { id: 'flag.yellow', category: 'flags', label: 'Yellow', description: 'Yellow flag (local/full-course) — caution, slow down.', defaultEnabled: true, defaultPriority: 9, defaultCooldownMs: 6000 },
  { id: 'flag.blue', category: 'flags', label: 'Blue', description: 'Let the faster car through.', defaultEnabled: true, defaultPriority: 7, defaultCooldownMs: 6000 },
  { id: 'flag.white', category: 'flags', label: 'White', description: 'Final lap.', defaultEnabled: true, defaultPriority: 5, defaultCooldownMs: 8000 },
  { id: 'flag.checkered', category: 'flags', label: 'Checkered', description: 'Race finish.', defaultEnabled: true, defaultPriority: 6, defaultCooldownMs: 30000 },
  { id: 'flag.meatball', category: 'flags', label: 'Meatball', description: 'Black/orange flag — damage, go to the pits.', defaultEnabled: true, defaultPriority: 8, defaultCooldownMs: 10000 },
  { id: 'flag.black', category: 'flags', label: 'Black', description: 'Penalty.', defaultEnabled: true, defaultPriority: 8, defaultCooldownMs: 10000 },
  // ── Fuel ───────────────────────────────────────────────────────────────────
  { id: 'fuel.low', category: 'fuel', label: 'Low fuel', description: 'Fuel below the configured lap limit.', defaultEnabled: true, defaultPriority: 7, defaultCooldownMs: 30000 },
  { id: 'fuel.lapsLeft', category: 'fuel', label: 'Fuel laps left', description: 'Announces remaining fuel laps once per lap.', defaultEnabled: false, defaultPriority: 4, defaultCooldownMs: 25000 },
  { id: 'fuel.box', category: 'fuel', label: 'Box this lap', description: 'Not enough fuel to finish — stop in the pits.', defaultEnabled: true, defaultPriority: 8, defaultCooldownMs: 20000 },
  // ── Pit ────────────────────────────────────────────────────────────────────
  { id: 'pit.windowOpen', category: 'pit', label: 'Pit window open', description: 'Remaining laps inside the pit window.', defaultEnabled: false, defaultPriority: 5, defaultCooldownMs: 60000 },
  { id: 'pit.onPitRoad', category: 'pit', label: 'On pit road', description: 'You entered pit road.', defaultEnabled: true, defaultPriority: 4, defaultCooldownMs: 8000 },
  { id: 'pit.speeding', category: 'pit', label: 'Pit speeding', description: 'Above the pit-lane limit with the limiter off.', defaultEnabled: true, defaultPriority: 9, defaultCooldownMs: 1500 },
  // ── Proximity & gaps ────────────────────────────────────────────────────────
  { id: 'proximity.spotter', category: 'proximity', label: 'Car alongside', description: 'Car left, car right, or three-wide (radar/relatives).', defaultEnabled: true, defaultPriority: 10, defaultCooldownMs: 1200 },
  { id: 'gap.ahead', category: 'proximity', label: 'Gap ahead', description: 'Gap to the car ahead plus closing/opening trend.', defaultEnabled: false, defaultPriority: 3, defaultCooldownMs: 12000 },
  { id: 'gap.behind', category: 'proximity', label: 'Gap behind', description: 'Gap to the car behind plus closing/opening trend.', defaultEnabled: false, defaultPriority: 3, defaultCooldownMs: 12000 },
  { id: 'position.change', category: 'proximity', label: 'Position change', description: 'Announces the new position when it changes.', defaultEnabled: true, defaultPriority: 5, defaultCooldownMs: 4000 },
  // ── Incidents ───────────────────────────────────────────────────────────────
  { id: 'incident.points', category: 'incidents', label: 'Incident points', description: 'When incident points increase (track limits/contact).', defaultEnabled: false, defaultPriority: 4, defaultCooldownMs: 4000 },
  { id: 'incident.limit', category: 'incidents', label: 'Incident limit', description: 'Warning when the incident limit is getting close.', defaultEnabled: true, defaultPriority: 8, defaultCooldownMs: 15000 },
  // ── Shift ───────────────────────────────────────────────────────────────────
  { id: 'shift.point', category: 'shift', label: 'Shift point', description: 'Says "shift" at the optimal point. Light — the Sounds menu already beeps.', defaultEnabled: false, defaultPriority: 2, defaultCooldownMs: 400 },
  // ── Lap ─────────────────────────────────────────────────────────────────────
  { id: 'lap.delta', category: 'lap', label: 'Last-lap delta', description: 'Difference from the last lap to the best (+/- s).', defaultEnabled: false, defaultPriority: 3, defaultCooldownMs: 8000 },
  { id: 'lap.personalBest', category: 'lap', label: 'Personal best', description: 'When you set a new best lap.', defaultEnabled: true, defaultPriority: 4, defaultCooldownMs: 8000 },
  { id: 'session.start', category: 'lap', label: 'Session start', description: 'When telemetry goes live / the session starts.', defaultEnabled: true, defaultPriority: 5, defaultCooldownMs: 30000 }
]

export const CATEGORY_LABELS: Record<CalloutCategory, string> = {
  flags: 'Flags',
  fuel: 'Fuel',
  pit: 'Pit',
  proximity: 'Proximity & gaps',
  incidents: 'Incidents',
  shift: 'Shift',
  lap: 'Laps'
}

export const DEFAULT_SPOTTER_THRESHOLDS: SpotterThresholds = {
  fuelLowLaps: 3,
  fuelBoxLaps: 1.5,
  pitSpeedLimitKmh: 60,
  pitWindowOpenLaps: 10,
  incidentWarnMargin: 2,
  gapChangeSec: 0.3,
  proximityAheadMeters: 4,
  proximitySideMeters: 6
}

function defaultCalloutConfig(meta: CalloutMeta): CalloutConfig {
  return {
    enabled: meta.defaultEnabled,
    voiceURI: '',
    rate: 1,
    pitch: 1,
    volume: 1,
    cooldownMs: meta.defaultCooldownMs,
    priority: meta.defaultPriority
  }
}

function buildDefaultCallouts(): Record<CalloutId, CalloutConfig> {
  const callouts = {} as Record<CalloutId, CalloutConfig>
  for (const meta of CALLOUT_CATALOG) callouts[meta.id] = defaultCalloutConfig(meta)
  return callouts
}

export const DEFAULT_SPOTTER_CONFIG: SpotterConfig = {
  version: 1,
  enabled: true,
  muted: false,
  masterVolume: 1,
  language: 'en-US',
  // Empty means "resolve the Piper default for the active speech language".
  defaultVoiceURI: '',
  outputDeviceId: '',
  thresholds: DEFAULT_SPOTTER_THRESHOLDS,
  callouts: buildDefaultCallouts(),
  updatedAt: 0
}

// ─── Merge / sanitize (used by the main persistence module) ──────────────────

export type SpotterConfigPatch = {
  version?: 1
  enabled?: boolean
  muted?: boolean
  masterVolume?: number
  language?: SpotterLang
  defaultVoiceURI?: string
  outputDeviceId?: string
  thresholds?: Partial<SpotterThresholds>
  callouts?: Partial<Record<CalloutId, Partial<CalloutConfig>>>
  updatedAt?: number
}

export function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function sanitizeLanguage(lang: SpotterLang | undefined, fallback: SpotterLang): SpotterLang {
  return lang === 'pt-BR' || lang === 'en-US' ? lang : fallback
}

function sanitizeString(value: string | undefined, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function mergeCallout(base: CalloutConfig, patch: Partial<CalloutConfig> | undefined): CalloutConfig {
  const p = patch ?? {}
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
    voiceURI: sanitizeString(p.voiceURI, base.voiceURI),
    rate: clampNumber(p.rate, 0.5, 2, base.rate),
    pitch: clampNumber(p.pitch, 0, 2, base.pitch),
    volume: clampNumber(p.volume, 0, 1, base.volume),
    cooldownMs: Math.round(clampNumber(p.cooldownMs, 0, 120000, base.cooldownMs)),
    priority: Math.round(clampNumber(p.priority, 1, 10, base.priority))
  }
}

function mergeThresholds(base: SpotterThresholds, patch: Partial<SpotterThresholds> | undefined): SpotterThresholds {
  const p = patch ?? {}
  return {
    fuelLowLaps: clampNumber(p.fuelLowLaps, 0.5, 20, base.fuelLowLaps),
    fuelBoxLaps: clampNumber(p.fuelBoxLaps, 0.2, 10, base.fuelBoxLaps),
    pitSpeedLimitKmh: clampNumber(p.pitSpeedLimitKmh, 20, 120, base.pitSpeedLimitKmh),
    pitWindowOpenLaps: Math.round(clampNumber(p.pitWindowOpenLaps, 1, 100, base.pitWindowOpenLaps)),
    incidentWarnMargin: Math.round(clampNumber(p.incidentWarnMargin, 1, 20, base.incidentWarnMargin)),
    gapChangeSec: clampNumber(p.gapChangeSec, 0.05, 5, base.gapChangeSec),
    proximityAheadMeters: clampNumber(p.proximityAheadMeters, 1, 20, base.proximityAheadMeters),
    proximitySideMeters: clampNumber(p.proximitySideMeters, 1, 20, base.proximitySideMeters)
  }
}

// Always rebuilds callouts from the catalog so unknown/missing ids are dropped
// or filled with defaults, then layers base + patch on top of each known id.
export function mergeSpotterConfig(base: SpotterConfig, patch: SpotterConfigPatch): SpotterConfig {
  const callouts = {} as Record<CalloutId, CalloutConfig>
  for (const meta of CALLOUT_CATALOG) {
    const baseCallout = base.callouts[meta.id] ?? defaultCalloutConfig(meta)
    callouts[meta.id] = mergeCallout(baseCallout, patch.callouts?.[meta.id])
  }
  return {
    version: 1,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    muted: typeof patch.muted === 'boolean' ? patch.muted : base.muted,
    masterVolume: clampNumber(patch.masterVolume, 0, 1, base.masterVolume),
    language: sanitizeLanguage(patch.language, base.language),
    defaultVoiceURI: sanitizeString(patch.defaultVoiceURI, base.defaultVoiceURI),
    outputDeviceId: sanitizeString(patch.outputDeviceId, base.outputDeviceId),
    thresholds: mergeThresholds(base.thresholds, patch.thresholds),
    callouts,
    updatedAt: Date.now()
  }
}

// ─── Piper TTS ────────────────────────────────────────────────────────────────
//
// Piper is an MIT-licensed offline TTS engine (https://github.com/rhasspy/piper).
// The binary and voice models are NOT committed — run scripts/fetch-piper-voices.sh
// before building the Windows installer. All voices listed are MIT-licensed.
//
// Voice URI convention stored in CalloutConfig.voiceURI / defaultVoiceURI:
//   ''              → system default for the configured language (unchanged)
//   'piper:<id>'   → Piper engine, id maps to resources/piper/voices/<id>.onnx
//   any other str  → OS Web Speech voiceURI (SpeechSynthesisVoice.voiceURI)

export const TTS_CHANNELS = {
  listVoices: 'tts:listVoices',
  synth: 'tts:synth',
  // Download (on first use) a voice model into userData. Single-flight per voice.
  ensureVoice: 'tts:ensureVoice',
  // Main → Renderer: download progress for the voice ensured above.
  voiceProgress: 'tts:voiceProgress',
  // Renderer → Main: self-test of the neural (sherpa) engine. Reports whether the
  // engine is present/usable so the UI can warn when synth silently falls back to
  // OS voices (e.g. onnxruntime 0xC0000005 on some Windows CPUs).
  engineStatus: 'tts:engineStatus',
  // Main → Renderer: emitted immediately when runtime synthesis changes engine
  // health so capability leases stop advertising a crashed/disabled Piper path.
  engineStatusEvent: 'tts:engineStatusEvent'
} as const

// Result of the neural-engine self-test (TTS_CHANNELS.engineStatus):
//   • engine 'sherpa' + ok true   → neural synth works on this machine.
//   • engine 'sherpa' + ok false  → engine present but a synth probe failed
//                                    (reason carries the failure) → OS fallback.
//   • engine 'none'   + ok false  → native engine absent on disk → OS fallback.
export interface TtsEngineStatus {
  engine: 'sherpa' | 'none'
  ok: boolean
  reason?: string
}

export interface PiperVoiceInfo {
  id: string
  name: string
  lang: 'pt-BR' | 'en-US'
  quality: 'low' | 'medium' | 'high'
  installed: boolean
  /** Approx size of the extracted `model.onnx` — drives the post-extract size-verify gate. */
  onnxBytes?: number
  /** Approx size of the downloaded `.tar.bz2` sherpa bundle — drives the download progress bar. */
  bundleBytes?: number
}

// ENGINE: the neural voices are synthesised by sherpa-onnx (OfflineTts, VITS model
// type) — NOT the old piper.exe, which hard-crashed (0xC0000005) on many Windows
// CPUs. sherpa statically links onnxruntime and is far more robust.
//
// Voices are DOWNLOADED on demand (lean installer): the Windows installer bundles
// only the sherpa native engine + a SHARED espeak-ng-data; each voice's weights are
// fetched into userData on first use via TTS_CHANNELS.ensureVoice (see
// src/main/tts/piper.ts + sherpa.ts). The pt-BR voices stay first so the default
// (pt_BR-faber-medium) and its alternates lead. All four pt-BR voices
// (faber/cadu/jeff/edresson) are DISTINCT neural models — selecting a different id
// loads a different model.onnx, so they no longer all sound identical.
//
// `bundleBytes` are the real GitHub-release `content-length` of each `.tar.bz2`
// (verified via curl -sIL) → the download progress total. `onnxBytes` are the
// extracted `model.onnx` size → the 90% size-verify gate after extraction.
export const PIPER_VOICE_CATALOG: PiperVoiceInfo[] = [
  { id: 'pt_BR-faber-medium',    name: 'Faber (pt-BR)',    lang: 'pt-BR', quality: 'medium', installed: false, onnxBytes: 63_201_294, bundleBytes: 67_209_996 },
  { id: 'pt_BR-cadu-medium',     name: 'Cadu (pt-BR)',     lang: 'pt-BR', quality: 'medium', installed: false, onnxBytes: 62_946_444, bundleBytes: 67_229_060 },
  { id: 'pt_BR-jeff-medium',     name: 'Jeff (pt-BR)',     lang: 'pt-BR', quality: 'medium', installed: false, onnxBytes: 62_950_044, bundleBytes: 67_230_851 },
  { id: 'pt_BR-edresson-low',    name: 'Edresson (pt-BR)', lang: 'pt-BR', quality: 'low',    installed: false, onnxBytes: 63_104_660, bundleBytes: 67_103_760 },
  { id: 'en_US-lessac-medium',   name: 'Lessac (en-US)',   lang: 'en-US', quality: 'medium', installed: false, onnxBytes: 63_201_425, bundleBytes: 67_230_653 },
  { id: 'en_US-amy-medium',      name: 'Amy (en-US)',      lang: 'en-US', quality: 'medium', installed: false, onnxBytes: 63_201_425, bundleBytes: 67_223_746 },
  { id: 'en_US-amy-low',         name: 'Amy (en-US, leve)', lang: 'en-US', quality: 'low',   installed: false, onnxBytes: 63_104_657, bundleBytes: 67_095_344 },
  { id: 'en_US-ryan-medium',     name: 'Ryan (en-US)',     lang: 'en-US', quality: 'medium', installed: false, onnxBytes: 63_201_425, bundleBytes: 67_213_100 }
]

// sherpa-onnx hosts ready-made TTS voice bundles on its GitHub releases under the
// `tts-models` tag. Each `vits-piper-<id>.tar.bz2` contains `<id>.onnx`,
// `tokens.txt` and an `espeak-ng-data/` dir. We download the bundle and extract
// only `model.onnx` + `tokens.txt` per voice (the espeak-ng-data is bundled ONCE,
// shared, in resources). These bundles are the SAME upstream piper voices (MIT).
export const SHERPA_TTS_MODELS_BASE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models'

// The `.tar.bz2` sherpa voice bundle URL for a voice id. Returns null for a
// malformed id (so callers never build a bogus URL). PURE.
export function sherpaVoiceBundleUrl(voiceId: string): string | null {
  if (!/^([a-z]{2})_([A-Z]{2})-(.+)-(low|medium|high)$/.test(voiceId)) return null
  return `${SHERPA_TTS_MODELS_BASE}/vits-piper-${voiceId}.tar.bz2`
}

// Approx extracted `model.onnx` size (bytes) from the catalog — used for the 90%
// size-verify gate after extraction. Falls back to 0 (→ a minimum-byte gate) for
// unknown ids.
export function piperVoiceApproxBytes(voiceId: string): number {
  return PIPER_VOICE_CATALOG.find((v) => v.id === voiceId)?.onnxBytes ?? 0
}

// Approx `.tar.bz2` bundle size (bytes) — the download progress total. Falls back
// to 0 for unknown ids (the progress bar then tracks the HTTP content-length).
export function sherpaVoiceBundleBytes(voiceId: string): number {
  return PIPER_VOICE_CATALOG.find((v) => v.id === voiceId)?.bundleBytes ?? 0
}

export type PiperVoicePhase = 'resolving' | 'downloading' | 'verifying' | 'done' | 'error'

export interface PiperVoiceProgress {
  voiceId: string
  phase: PiperVoicePhase
  totalBytes: number
  downloadedBytes: number
  /** 0..1; 1 when done. */
  ratio: number
  /** Present when phase === 'error'. */
  error?: string
}

export interface EnsureVoiceResult {
  ok: boolean
  voiceId: string
  /** True when the voice is present on disk after the call (downloaded or bundled). */
  installed: boolean
  error?: string
}

export function parsePiperVoiceId(voiceURI: string): string | null {
  return voiceURI.startsWith('piper:') ? voiceURI.slice(6) : null
}

const PIPER_VOICE_ID_SET: ReadonlySet<string> = new Set(PIPER_VOICE_CATALOG.map((v) => v.id))

export function isValidPiperVoiceId(voiceId: string): boolean {
  if (voiceId.includes('/') || voiceId.includes('\\') || voiceId.includes('..')) return false
  return PIPER_VOICE_ID_SET.has(voiceId)
}

// Language baked into a Piper model id (e.g. 'pt_BR-faber-medium' → 'pt-BR').
// Used to pick a SAME-LANGUAGE OS fallback voice when the Piper engine/model is
// unavailable at speak time, so the user's language intent survives the fallback
// instead of collapsing to whatever the engine default happens to be.
export function piperVoiceLang(voiceId: string): SpotterLang | null {
  const found = PIPER_VOICE_CATALOG.find((v) => v.id === voiceId)
  return found ? found.lang : null
}

// ─── Voice resolution (pure; shared by the runtime + unit tests) ─────────────
//
// Minimal structural shape of a Web Speech voice. Keeping it here (instead of
// referencing the DOM `SpeechSynthesisVoice`) preserves this module's DOM-free
// contract while still letting the renderer pass real SpeechSynthesisVoice
// objects — they satisfy this interface structurally.
export interface VoiceLike {
  voiceURI: string
  lang: string
}

// Resolves WHICH voice to speak with. The critical rule that fixes "the voice
// never changes": when an EXPLICIT voiceURI is provided it is matched EXACTLY
// and NEVER degraded to a language default. Returning null when the explicit
// voice isn't in the list yet is intentional — the caller can then wait for the
// async voice list to populate instead of silently speaking with the wrong
// (same-every-time) voice. A language-based default is only used when NO
// explicit voiceURI is set (voiceURI === '').
export function pickVoice<T extends VoiceLike>(
  voices: readonly T[],
  voiceURI: string,
  lang: SpotterLang
): T | null {
  if (voiceURI) {
    return voices.find((v) => v.voiceURI === voiceURI) ?? null
  }
  const prefix = lang.slice(0, 2).toLowerCase()
  return (
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => (v.lang ?? '').toLowerCase().replace('_', '-').startsWith(prefix)) ??
    null
  )
}

// FNV-1a 32-bit string hash — small, fast, dependency-free, and STABLE across runs
// (so the same requested voice always maps to the same OS voice). Returns an
// unsigned 32-bit integer.
function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    // h *= 16777619, kept in 32-bit space via Math.imul.
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Picks a DISTINCT OS (Web Speech) voice for a requested neural voice id when the
// neural engine is unavailable (tts:synth returned null). This is the fix for "all
// voices sound identical": the old fallback spoke with an EMPTY voiceURI, so the OS
// always picked the single LANGUAGE DEFAULT — every neural voice collapsed to one
// OS voice. Instead we DETERMINISTICALLY map each requested voiceId to one of the
// same-language installed OS voices by hashing the id, so:
//   • two DIFFERENT requested voices map to DIFFERENT OS voices (when ≥2 exist), and
//   • the SAME requested voice always maps to the SAME OS voice (stable per run).
//
// `voiceId` is the requested voice — either a neural id (e.g. 'pt_BR-faber-medium')
// or a real OS voiceURI. An EXPLICIT exact match (voiceId === an available
// voiceURI) ALWAYS wins. Returns null when no same-language OS voice exists yet, so
// the caller can wait for the async voice list to populate.
export function pickDistinctOsVoice<T extends VoiceLike>(
  voiceId: string,
  availableVoices: readonly T[],
  lang: SpotterLang
): T | null {
  if (availableVoices.length === 0) return null

  // Explicit exact match always wins (e.g. the user picked a real OS voice).
  if (voiceId) {
    const exact = availableVoices.find((v) => v.voiceURI === voiceId)
    if (exact) return exact
  }

  // Same-language candidates: exact locale first, then language-prefix (handles
  // 'pt-PT' for 'pt-BR', and underscore locales like 'en_GB').
  const prefix = lang.slice(0, 2).toLowerCase()
  const sameLang = availableVoices.filter((v) => v.lang === lang)
  const candidates =
    sameLang.length > 0
      ? sameLang
      : availableVoices.filter((v) =>
          (v.lang ?? '').toLowerCase().replace('_', '-').startsWith(prefix)
        )
  if (candidates.length === 0) return null

  // Stable ordering (by voiceURI) so the hash→index mapping is independent of the
  // order getVoices() happens to return.
  const ordered = [...candidates].sort((a, b) => (a.voiceURI < b.voiceURI ? -1 : a.voiceURI > b.voiceURI ? 1 : 0))
  const index = hashString(voiceId) % ordered.length
  return ordered[index]
}

// Deterministic, subtle prosody offsets applied ONLY on the OS fallback path. When
// the OS has a SINGLE voice for the language, pickDistinctOsVoice returns that one
// voice for every neural id (collapsing them again); shifting pitch/rate per id
// keeps the user's different voices audibly distinct. Pure + deterministic, so a
// given voice id always sounds the same. Bands are narrow so callouts stay natural.
export function fallbackVoiceProsody(voiceId: string): { pitch: number; rate: number } {
  const h = hashString(voiceId)
  const pitch = 0.82 + ((h % 37) / 100) // 0.82 .. 1.18
  const rate = 0.94 + (((h >>> 7) % 13) / 100) // 0.94 .. 1.06
  return { pitch, rate }
}

// ─── Phrase builder (pure, bilingual) ────────────────────────────────────────

export type ProximitySide = 'left' | 'right' | 'three-wide'
export type GapTrend = 'closing' | 'pulling-away'

export interface PhraseParams {
  laps?: number
  gapSec?: number
  positionNumber?: number
  deltaSec?: number
  points?: number
  side?: ProximitySide
  trend?: GapTrend
}

function formatSeconds(sec: number, lang: SpotterLang): string {
  const fixed = Math.abs(sec).toFixed(1)
  return lang === 'pt-BR' ? fixed.replace('.', ',') : fixed
}

function trendWord(trend: GapTrend | undefined, lang: SpotterLang): string {
  if (!trend) return ''
  if (lang === 'pt-BR') return trend === 'closing' ? ', se aproximando' : ', abrindo'
  return trend === 'closing' ? ', closing' : ', pulling away'
}

// Builds the spoken text for a callout. Pure and exhaustive so the runtime and
// the "Testar" buttons share identical wording. Defaults to Portuguese (pt-BR) —
// PT is the product default; pass 'en-US' explicitly for the English phrase set.
export function buildPhrase(id: CalloutId, lang: SpotterLang = 'pt-BR', params: PhraseParams = {}): string {
  const pt = lang === 'pt-BR'
  switch (id) {
    case 'flag.green':
      return pt ? 'Verde, verde, verde' : 'Green, green, green'
    case 'flag.yellow':
      return pt ? 'Amarela, amarela, cuidado' : 'Yellow, yellow, yellow'
    case 'flag.blue':
      return pt ? 'Bandeira azul, deixe passar' : 'Blue flag, let them by'
    case 'flag.white':
      return pt ? 'Bandeira branca, última volta' : 'White flag, last lap'
    case 'flag.checkered':
      return pt ? 'Bandeirada, corrida encerrada' : 'Checkered flag, that is the end'
    case 'flag.meatball':
      return pt ? 'Bandeira preta e laranja, carro danificado, vá aos boxes' : 'Meatball flag, report to the pits'
    case 'flag.black':
      return pt ? 'Bandeira preta, penalidade' : 'Black flag, penalty'
    case 'fuel.low':
      return pt ? 'Combustível baixo' : 'Fuel is low'
    case 'fuel.lapsLeft': {
      const laps = Math.max(0, Math.floor(params.laps ?? 0))
      if (pt) return laps === 1 ? 'Uma volta de combustível restante' : `${laps} voltas de combustível restantes`
      return laps === 1 ? 'One lap of fuel left' : `${laps} laps of fuel left`
    }
    case 'fuel.box':
      return pt ? 'Entre nos boxes nesta volta por combustível' : 'Box this lap, box this lap, for fuel'
    case 'pit.windowOpen':
      return pt ? 'Janela de parada aberta' : 'Pit window is open'
    case 'pit.onPitRoad':
      return pt ? 'Você entrou na via dos boxes' : 'You are on pit road'
    case 'pit.speeding':
      return pt ? 'Excesso de velocidade nos boxes, reduza' : 'Speeding in the pit lane, slow down'
    case 'proximity.spotter':
      if (params.side === 'three-wide') return pt ? 'Três lado a lado, cuidado' : 'Three wide, three wide'
      if (params.side === 'right') return pt ? 'Carro à direita' : 'Car right'
      return pt ? 'Carro à esquerda' : 'Car left'
    case 'gap.ahead': {
      const gap = formatSeconds(params.gapSec ?? 0, lang)
      const unit = pt ? 'segundos' : 'seconds'
      return pt
        ? `${gap} ${unit} para o carro à frente${trendWord(params.trend, lang)}`
        : `${gap} ${unit} to the car ahead${trendWord(params.trend, lang)}`
    }
    case 'gap.behind': {
      const gap = formatSeconds(params.gapSec ?? 0, lang)
      const unit = pt ? 'segundos' : 'seconds'
      return pt
        ? `${gap} ${unit} para o carro atrás${trendWord(params.trend, lang)}`
        : `${gap} ${unit} to the car behind${trendWord(params.trend, lang)}`
    }
    case 'position.change': {
      const pos = Math.max(1, Math.floor(params.positionNumber ?? 0))
      return pt ? `Posição ${pos}` : `Position ${pos}`
    }
    case 'incident.points': {
      const points = Math.max(0, Math.floor(params.points ?? 0))
      return pt ? `Incidente, ${points} pontos` : `Incident, ${points} points`
    }
    case 'incident.limit':
      return pt ? 'Cuidado, limite de incidentes próximo' : 'Careful, incident limit approaching'
    case 'shift.point':
      return pt ? 'Troque a marcha' : 'Shift'
    case 'lap.delta': {
      const delta = params.deltaSec ?? 0
      const value = formatSeconds(delta, lang)
      if (Math.abs(delta) < 0.05) return pt ? 'Última volta, mesmo tempo' : 'Last lap, dead on'
      if (pt) return delta > 0 ? `Última volta, ${value} segundos mais lenta` : `Última volta, ${value} segundos mais rápida`
      return delta > 0 ? `Last lap, ${value} slower` : `Last lap, ${value} faster`
    }
    case 'lap.personalBest':
      return pt ? 'Melhor volta pessoal' : 'New personal best lap'
    case 'session.start':
      return pt ? 'Sessão iniciada, boa sorte' : 'Session started, good luck'
    default:
      return ''
  }
}

export function buildSpotterVoiceTestPhrase(lang: SpotterLang): string {
  return lang === 'pt-BR' ? 'Engenheiro de áudio online. Boa corrida.' : 'Audio engineer online. Have a good race.'
}

// ─── Proximity decision (authoritative, from iRacing CarLeftRight) ────────────
//
// The spoken left/right/three-wide callout MUST come from the decided CarLeftRight
// state (TelemetrySnapshot.carLeftRight), NEVER from the sign of a per-car
// relativeX — which, for iRacing, is fabricated by index parity in the provider
// and is only good enough to place radar dots. These helpers are pure and
// dependency-free so the runtime engine and unit tests share one decision path.

export interface ProximityPrev {
  left: boolean
  right: boolean
}

export interface ProximityDecision {
  announce: ProximitySide | null // side to speak now; null = stay silent this frame
  leftNow: boolean // car on the left right now (after the announce/disable gate)
  rightNow: boolean // car on the right right now
}

// Maps the decided CarLeftRight state to the spoken proximity side.
//   'left' → 'left', 'right' → 'right', 'both' → 'three-wide', else → null
export function proximitySideFromState(state: CarLeftRightState | undefined): ProximitySide | null {
  switch (state) {
    case 'left':
      return 'left'
    case 'right':
      return 'right'
    case 'both':
      return 'three-wide'
    default:
      return null
  }
}

// Decides whether to speak a proximity callout this frame and which side, using
// the AUTHORITATIVE CarLeftRight state plus edge detection against the previous
// frame (so a callout fires once on transition, not every frame). `gateOpen`
// reflects the proximity ahead/behind threshold gate — it only enables/disables
// WHETHER to announce; the side always comes from `state`. Two cars on the same
// side ('left'/'right') still announce that single side; 'both' is three-wide.
export function decideProximity(
  state: CarLeftRightState | undefined,
  gateOpen: boolean,
  prev: ProximityPrev
): ProximityDecision {
  const side = proximitySideFromState(state)
  const leftNow = gateOpen && (side === 'left' || side === 'three-wide')
  const rightNow = gateOpen && (side === 'right' || side === 'three-wide')
  let announce: ProximitySide | null = null
  if (side === 'three-wide' && leftNow && rightNow) {
    if (!(prev.left && prev.right)) announce = 'three-wide'
  } else if (leftNow && !prev.left) {
    announce = 'left'
  } else if (rightNow && !prev.right) {
    announce = 'right'
  }
  return { announce, leftNow, rightNow }
}
