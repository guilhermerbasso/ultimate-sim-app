export const RIG_PREFLIGHT_CHANNELS = {
  getState: 'rigPreflight:getState',
  setProfile: 'rigPreflight:setProfile',
  run: 'rigPreflight:run',
  waive: 'rigPreflight:waive',
  removeWaiver: 'rigPreflight:removeWaiver',
  acceptKnownGood: 'rigPreflight:acceptKnownGood',
  faultMatrix: 'rigPreflight:faultMatrix',
  revalidate: 'rigPreflight:revalidate',
  changed: 'rigPreflight:changed'
} as const

export type RigPreflightState = 'verified' | 'unknown' | 'fail' | 'waived-with-reason'
export type RigPreflightUnderlyingState = Exclude<RigPreflightState, 'waived-with-reason'>
export type RigPreflightCategory =
  | 'simulator'
  | 'displays'
  | 'serial'
  | 'audio'
  | 'haptics'
  | 'controls'
  | 'streaming'
  | 'resources'
  | 'baseline'

export type RigPreflightProfileMode = 'configured' | 'full-rig' | 'no-hardware'
export type RigEvidenceKind =
  | 'runtime'
  | 'os'
  | 'renderer'
  | 'config'
  | 'filesystem'
  | 'fault'
  | 'waiver'

export const RIG_PREFLIGHT_CHECK_IDS = {
  simulator: 'simulator.source',
  displays: 'displays.available',
  dashboardWindows: 'displays.dashboard-windows',
  simx: 'serial.simx',
  configuredSerial: 'serial.configured',
  esp32: 'serial.esp32',
  audioOutput: 'audio.output',
  audioInput: 'audio.input',
  tts: 'audio.tts',
  stt: 'audio.stt',
  haptics: 'haptics.route',
  gamepad: 'controls.gamepad',
  bindings: 'controls.bindings',
  streamingPort: 'streaming.port',
  ttsEngineResource: 'resources.tts-engine',
  ttsVoiceResource: 'resources.tts-voice',
  sttBinaryResource: 'resources.stt-binary',
  sttModelResource: 'resources.stt-model',
  cloudflaredResource: 'resources.cloudflared',
  knownGood: 'baseline.known-good'
} as const

export const RIG_PREFLIGHT_FAULT_IDS = [
  'serial-disconnect',
  'stale-evidence',
  'foreign-port-owner',
  'missing-stt-binary',
  'missing-tts-engine',
  'display-disconnect'
] as const

export type RigPreflightFaultId = (typeof RIG_PREFLIGHT_FAULT_IDS)[number]

export interface RigEvidenceProvenance {
  kind: RigEvidenceKind
  source: string
  detail?: string
}

export interface RigEvidenceMeta {
  observedAt: number
  owner?: string
  provenance: RigEvidenceProvenance[]
}

export interface RigPreflightRequirements {
  requireSimulator: boolean
  allowMockSimulator: boolean
  minDisplays: number
  minDashboardWindows: number
  requireSimX: boolean
  requireConfiguredSerial: boolean
  requireEsp32: boolean
  requireAudioOutput: boolean
  requireAudioInput: boolean
  requireTts: boolean
  requireStt: boolean
  requireHaptics: boolean
  requireGamepad: boolean
  requireControlBindings: boolean
  requireStreaming: boolean
  streamingPort: number
  requireStreamingTunnel: boolean
  requireKnownGood: boolean
}

export interface RigPreflightProfile {
  version: 1
  id: string
  revision: number
  hash: string
  name: string
  owner: string
  mode: RigPreflightProfileMode
  evidenceMaxAgeMs: number
  certificateTtlMs: number
  requirements: RigPreflightRequirements
  updatedAt: number
}

export type RigPreflightProfilePatch =
  Omit<Partial<RigPreflightProfile>, 'requirements'> & {
    requirements?: Partial<RigPreflightRequirements>
  }

export interface RigSimulatorObservation {
  meta: RigEvidenceMeta
  source: string
  active: string
  connected: boolean
  snapshotAt?: number
}

export interface RigDisplaysObservation {
  meta: RigEvidenceMeta
  displayIds: number[]
  openDashboardWindowIdentities: string[]
}

export interface RigSerialObservation {
  meta: RigEvidenceMeta
  availablePorts: string[]
  simxConnected: boolean
  simxIdentity?: string
  configuredIdentities: string[]
  connectedConfiguredIdentities: string[]
  observedConfiguredIdentities: string[]
  esp32RequiredIdentities: string[]
  esp32ConnectedIdentities: string[]
}

export interface RigAudioObservation {
  meta: RigEvidenceMeta
  enumerationSucceeded: boolean
  audioEngineOk: boolean
  audioContextState: string
  audioEngineError?: string
  outputIdentities: string[]
  outputLabels: string[]
  inputIdentities: string[]
  inputLabels: string[]
}

export interface RigTtsObservation {
  meta: RigEvidenceMeta
  enginePresent: boolean
  engineOk: boolean
  engineReason?: string
  installedVoiceIds: string[]
}

export interface RigSttObservation {
  meta: RigEvidenceMeta
  enabled: boolean
  binaryPresent: boolean
  modelPresent: boolean
  vadModelPresent: boolean
}

export interface RigHapticsObservation {
  meta: RigEvidenceMeta
  enabled: boolean
  muted: boolean
  enabledEffects: number
  outputDeviceId: string
  audioRouteAvailable: boolean
  arduinoEnabled: boolean
  arduinoDeviceId: string
  arduinoConnected: boolean
}

export interface RigControlsObservation {
  meta: RigEvidenceMeta
  gamepadIdentities: string[]
  bindingIdentities: string[]
  enabledBindingIdentities: string[]
  keyboardEmulationAvailable: boolean
  gamepadEmulationAvailable: boolean
}

export type RigPortOwnerState = 'app' | 'foreign' | 'free' | 'unknown'

export interface RigStreamingObservation {
  meta: RigEvidenceMeta
  running: boolean
  port: number | null
  accessMode: string
  autoTunnelAvailable: boolean
  ownerState: RigPortOwnerState
  ownerPid?: number
  ownerName?: string
  ownerDetail?: string
}

export interface RigPreflightObservation {
  collectedAt: number
  simulator?: RigSimulatorObservation
  displays?: RigDisplaysObservation
  serial?: RigSerialObservation
  audio?: RigAudioObservation
  tts?: RigTtsObservation
  stt?: RigSttObservation
  haptics?: RigHapticsObservation
  controls?: RigControlsObservation
  streaming?: RigStreamingObservation
}

export interface RigPreflightClientEvidence {
  observedAt: number
  audio?: Omit<RigAudioObservation, 'meta'>
  tts?: Omit<RigTtsObservation, 'meta'>
  stt?: Omit<RigSttObservation, 'meta'>
  haptics?: Omit<RigHapticsObservation, 'meta'>
  controls?: Omit<RigControlsObservation, 'meta'>
  streaming?: Omit<RigStreamingObservation, 'meta' | 'ownerState' | 'ownerPid' | 'ownerName' | 'ownerDetail'>
  esp32ConnectedIdentities?: string[]
}

export interface RigPreflightWaiver {
  id: string
  checkId: string
  reason: string
  owner: string
  createdAt: number
  expiresAt: number
}

export interface RigPreflightCheck {
  id: string
  category: RigPreflightCategory
  label: string
  applicability: 'required' | 'not-required'
  state: RigPreflightState
  underlyingState: RigPreflightUnderlyingState
  summary: string
  expected: string
  observed: string
  signatureMaterial: string
  delta: string[]
  owner: string
  observedAt: number
  freshUntil: number
  provenance: RigEvidenceProvenance[]
  remediation: string[]
  waiver?: RigPreflightWaiver
}

export interface RigPreflightCertificate {
  id: string
  issuedAt: number
  expiresAt: number
  expiryBasis: 'profile-ttl' | 'waiver'
  decision: 'ready' | 'ready-with-waivers' | 'blocked'
  coverage: number
  signature: string
  profileRevision: number
  profileHash: string
  knownGoodSignature: string | null
  drift: 'match' | 'mismatch' | 'not-established' | 'not-required'
  counts: Record<RigPreflightState, number>
  untestedCheckIds: string[]
  waivedCheckIds: string[]
}

export interface RigPreflightRun {
  id: string
  profileId: string
  profileName: string
  profileRevision: number
  profileHash: string
  startedAt: number
  completedAt: number
  signature: string
  checks: RigPreflightCheck[]
  certificate: RigPreflightCertificate
  eligibleAsKnownGood: boolean
}

export interface RigActiveCertificate {
  runId: string
  certificate: RigPreflightCertificate
  invalidatedAt: number | null
  invalidationReason: string | null
  invalidationProvenance: RigEvidenceProvenance[]
  revalidationRequired: boolean
  lastValidatedAt: number
}

export interface RigKnownGood {
  signature: string
  runId: string
  acceptedAt: number
  owner: string
}

export interface RigFaultResult {
  faultId: RigPreflightFaultId
  checkId: string
  expectedState: RigPreflightUnderlyingState
  actualState: RigPreflightState
  detected: boolean
  summary: string
}

export interface RigFaultMatrixRun {
  id: string
  runAt: number
  passed: number
  total: number
  results: RigFaultResult[]
}

export interface RigPreflightPersistedState {
  version: 1
  profile: RigPreflightProfile
  waivers: RigPreflightWaiver[]
  history: RigPreflightRun[]
  faultHistory: RigFaultMatrixRun[]
  knownGood: RigKnownGood | null
  activeCertificate: RigActiveCertificate | null
  updatedAt: number
}

export interface RigPreflightRunRequest {
  profile: RigPreflightProfile
  clientEvidence?: RigPreflightClientEvidence
}

export interface RigPreflightRevalidationResult {
  changed: boolean
  status: 'idle' | 'verified' | 'invalidated' | 'expired'
  reason?: string
}

export type RigPreflightStorageState = 'ok' | 'missing' | 'quarantined' | 'error'

export interface RigPreflightStorageStatus {
  state: RigPreflightStorageState
  blocked: boolean
  message: string | null
  quarantinePath: string | null
  occurredAt: number | null
}

export interface RigPreflightWaiverRequest {
  checkId: string
  reason: string
  owner: string
  expiresAt: number
}

export interface RigPreflightStateSnapshot extends RigPreflightPersistedState {
  activeCertificateExpired: boolean
  activeCertificateRevalidationRequired: boolean
  storage: RigPreflightStorageStatus
}

const CONFIGURED_REQUIREMENTS: RigPreflightRequirements = {
  requireSimulator: true,
  allowMockSimulator: false,
  minDisplays: 1,
  minDashboardWindows: 0,
  requireSimX: false,
  requireConfiguredSerial: false,
  requireEsp32: false,
  requireAudioOutput: true,
  requireAudioInput: false,
  requireTts: false,
  requireStt: false,
  requireHaptics: false,
  requireGamepad: false,
  requireControlBindings: false,
  requireStreaming: false,
  streamingPort: 0,
  requireStreamingTunnel: false,
  requireKnownGood: false
}

const FULL_RIG_REQUIREMENTS: RigPreflightRequirements = {
  ...CONFIGURED_REQUIREMENTS,
  minDashboardWindows: 1,
  requireSimX: true,
  requireConfiguredSerial: true,
  requireAudioInput: true,
  requireTts: true,
  requireStt: true,
  requireHaptics: true,
  requireGamepad: true,
  requireControlBindings: true,
  requireStreaming: true,
  requireKnownGood: true
}

const NO_HARDWARE_REQUIREMENTS: RigPreflightRequirements = {
  ...CONFIGURED_REQUIREMENTS,
  requireSimX: false,
  requireConfiguredSerial: false,
  requireEsp32: false,
  requireAudioInput: false,
  requireTts: false,
  requireStt: false,
  requireHaptics: false,
  requireGamepad: false,
  requireControlBindings: false,
  requireStreaming: false,
  requireStreamingTunnel: false,
  requireKnownGood: false
}

function requirementsFor(mode: RigPreflightProfileMode): RigPreflightRequirements {
  if (mode === 'full-rig') return { ...FULL_RIG_REQUIREMENTS }
  if (mode === 'no-hardware') return { ...NO_HARDWARE_REQUIREMENTS }
  return { ...CONFIGURED_REQUIREMENTS }
}

export function createRigPreflightProfile(
  mode: RigPreflightProfileMode = 'configured',
  now = Date.now(),
  owner = 'Rig owner'
): RigPreflightProfile {
  return {
    version: 1,
    id: 'local-rig',
    revision: 1,
    hash: '',
    name: mode === 'full-rig' ? 'Full race rig' : mode === 'no-hardware' ? 'No-hardware rig' : 'Configured rig',
    owner,
    mode,
    evidenceMaxAgeMs: 60_000,
    certificateTtlMs: 15 * 60_000,
    requirements: requirementsFor(mode),
    updatedAt: now
  }
}

export function applyRigPreflightPreset(
  current: RigPreflightProfile,
  mode: RigPreflightProfileMode,
  now = Date.now()
): RigPreflightProfile {
  const preset = createRigPreflightProfile(mode, now, current.owner)
  return {
    ...preset,
    id: current.id,
    revision: current.revision,
    hash: current.hash,
    evidenceMaxAgeMs: current.evidenceMaxAgeMs,
    certificateTtlMs: current.certificateTtlMs,
    requirements: {
      ...preset.requirements,
      streamingPort: current.requirements.streamingPort
    }
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export function normalizeEvidenceTimestamp(value: unknown, now = Date.now()): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(value, now)
}

export function stableSortedIdentities(values: readonly string[]): string[] {
  return [...new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'en'))
}

export function canonicalRigEsp32Identity(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let identity = value.trim().toLowerCase()
  if (!identity) return null
  while (/^(?:profile|wifi|esp32):/.test(identity)) {
    identity = identity.replace(/^(?:profile|wifi|esp32):/, '').trim()
  }
  return identity ? `esp32:${identity}` : null
}

function text(value: unknown, fallback: string, max = 120): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : fallback
}

export function normalizeRigPreflightProfile(
  input: RigPreflightProfilePatch | null | undefined,
  now = Date.now()
): RigPreflightProfile {
  const mode: RigPreflightProfileMode =
    input?.mode === 'full-rig' || input?.mode === 'no-hardware' ? input.mode : 'configured'
  const base = createRigPreflightProfile(mode, now)
  const req = input?.requirements ?? {}
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback
  return {
    version: 1,
    id: text(input?.id, base.id, 80),
    revision: clampInt(input?.revision, 1, Number.MAX_SAFE_INTEGER, base.revision),
    hash: typeof input?.hash === 'string' ? input.hash.trim().slice(0, 128) : base.hash,
    name: text(input?.name, base.name, 120),
    owner: text(input?.owner, base.owner, 120),
    mode,
    evidenceMaxAgeMs: clampInt(input?.evidenceMaxAgeMs, 5_000, 30 * 60_000, base.evidenceMaxAgeMs),
    certificateTtlMs: clampInt(input?.certificateTtlMs, 60_000, 24 * 60 * 60_000, base.certificateTtlMs),
    requirements: {
      requireSimulator: bool(req.requireSimulator, base.requirements.requireSimulator),
      allowMockSimulator: bool(req.allowMockSimulator, base.requirements.allowMockSimulator),
      minDisplays: clampInt(req.minDisplays, 0, 16, base.requirements.minDisplays),
      minDashboardWindows: clampInt(req.minDashboardWindows, 0, 16, base.requirements.minDashboardWindows),
      requireSimX: bool(req.requireSimX, base.requirements.requireSimX),
      requireConfiguredSerial: bool(req.requireConfiguredSerial, base.requirements.requireConfiguredSerial),
      requireEsp32: bool(req.requireEsp32, base.requirements.requireEsp32),
      requireAudioOutput: bool(req.requireAudioOutput, base.requirements.requireAudioOutput),
      requireAudioInput: bool(req.requireAudioInput, base.requirements.requireAudioInput),
      requireTts: bool(req.requireTts, base.requirements.requireTts),
      requireStt: bool(req.requireStt, base.requirements.requireStt),
      requireHaptics: bool(req.requireHaptics, base.requirements.requireHaptics),
      requireGamepad: bool(req.requireGamepad, base.requirements.requireGamepad),
      requireControlBindings: bool(req.requireControlBindings, base.requirements.requireControlBindings),
      requireStreaming: bool(req.requireStreaming, base.requirements.requireStreaming),
      streamingPort: clampInt(req.streamingPort, 0, 65_535, base.requirements.streamingPort),
      requireStreamingTunnel: bool(req.requireStreamingTunnel, base.requirements.requireStreamingTunnel),
      requireKnownGood: bool(req.requireKnownGood, base.requirements.requireKnownGood)
    },
    updatedAt: normalizeEvidenceTimestamp(input?.updatedAt, now) || now
  }
}

interface CheckInput {
  id: string
  category: RigPreflightCategory
  label: string
  required: boolean
  owner: string
  maxAgeMs: number
  now: number
  meta?: RigEvidenceMeta
  state: RigPreflightUnderlyingState
  summary: string
  expected: string
  observed: string
  signatureMaterial?: string
  delta?: string[]
  remediation?: string[]
}

function evaluatedCheck(input: CheckInput): RigPreflightCheck {
  if (!input.required) {
    return {
      id: input.id,
      category: input.category,
      label: input.label,
      applicability: 'not-required',
      state: 'verified',
      underlyingState: 'verified',
      summary: 'Explicitly excluded by the active rig profile.',
      expected: 'Not required',
      observed: 'Profile marks this check as not required',
      signatureMaterial: 'not-required',
      delta: [],
      owner: input.owner,
      observedAt: input.now,
      freshUntil: input.now + input.maxAgeMs,
      provenance: [{ kind: 'config', source: 'rig-preflight profile', detail: 'Explicit not-required scope' }],
      remediation: []
    }
  }

  const observedAt = input.meta?.observedAt ?? 0
  const missing = !input.meta || !Number.isFinite(observedAt) || observedAt <= 0
  const stale = !missing && input.now - observedAt > input.maxAgeMs
  const baseState: RigPreflightUnderlyingState = missing || stale ? 'unknown' : input.state
  const staleBy = stale ? Math.max(0, input.now - observedAt - input.maxAgeMs) : 0
  return {
    id: input.id,
    category: input.category,
    label: input.label,
    applicability: 'required',
    state: baseState,
    underlyingState: baseState,
    summary: missing
      ? 'No local evidence was collected.'
      : stale
        ? 'Evidence is stale and cannot prove readiness.'
        : input.summary,
    expected: input.expected,
    observed: missing ? 'No evidence' : input.observed,
    signatureMaterial: missing || stale
      ? baseState
      : (input.signatureMaterial ?? input.observed),
    delta: missing
      ? ['Evidence missing']
      : stale
        ? [`Evidence exceeded the freshness limit by ${Math.ceil(staleBy / 1000)}s`]
        : (input.delta ?? []),
    owner: input.meta?.owner || input.owner,
    observedAt,
    freshUntil: observedAt > 0 ? observedAt + input.maxAgeMs : 0,
    provenance: input.meta?.provenance ?? [],
    remediation: missing || stale
      ? ['Run the preflight again to collect fresh local evidence.', ...(input.remediation ?? [])]
      : (input.remediation ?? [])
  }
}

function activeWaiver(
  checkId: string,
  waivers: RigPreflightWaiver[],
  now: number
): RigPreflightWaiver | undefined {
  return waivers
    .filter((waiver) => waiver.checkId === checkId && waiver.reason.trim() && waiver.expiresAt > now)
    .sort((a, b) => b.createdAt - a.createdAt)[0]
}

export function applyRigPreflightWaiver(
  check: RigPreflightCheck,
  waivers: RigPreflightWaiver[],
  now: number
): RigPreflightCheck {
  if (check.applicability !== 'required' || check.underlyingState === 'verified') return check
  const waiver = activeWaiver(check.id, waivers, now)
  if (!waiver) {
    const expired = waivers
      .filter((candidate) => candidate.checkId === check.id && candidate.expiresAt <= now)
      .sort((a, b) => b.expiresAt - a.expiresAt)[0]
    return expired
      ? {
          ...check,
          remediation: [
            `Waiver expired at ${new Date(expired.expiresAt).toISOString()}; fix the issue or create a new time-bounded waiver.`,
            ...check.remediation
          ]
        }
      : check
  }
  return {
    ...check,
    state: 'waived-with-reason',
    summary: `Waived by ${waiver.owner}: ${waiver.reason}`,
    waiver,
    provenance: [
      ...check.provenance,
      { kind: 'waiver', source: waiver.owner, detail: `${waiver.reason} (expires ${new Date(waiver.expiresAt).toISOString()})` }
    ]
  }
}

function withWaiver(
  input: CheckInput,
  waivers: RigPreflightWaiver[],
  now: number
): RigPreflightCheck {
  return applyRigPreflightWaiver(evaluatedCheck(input), waivers, now)
}

function listed(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none'
}

export function evaluateRigPreflightChecks(
  profile: RigPreflightProfile,
  observation: RigPreflightObservation,
  waivers: RigPreflightWaiver[] = [],
  now = Date.now()
): RigPreflightCheck[] {
  const r = profile.requirements
  const maxAgeMs = profile.evidenceMaxAgeMs
  const owner = profile.owner
  const checks: RigPreflightCheck[] = []
  const add = (input: Omit<CheckInput, 'owner' | 'maxAgeMs' | 'now'>): void => {
    checks.push(withWaiver({ ...input, owner, maxAgeMs, now }, waivers, now))
  }

  const sim = observation.simulator
  const simMeta = sim?.connected && sim.snapshotAt
    ? { ...sim.meta, observedAt: Math.min(sim.meta.observedAt, sim.snapshotAt) }
    : sim?.meta
  const simAllowed = Boolean(
    sim?.connected &&
    sim.source !== 'off' &&
    sim.active !== 'none' &&
    (r.allowMockSimulator || (sim.active !== 'mock' && sim.source !== 'mock'))
  )
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.simulator,
    category: 'simulator',
    label: 'Simulator source',
    required: r.requireSimulator,
    meta: simMeta,
    state: simAllowed ? 'verified' : 'fail',
    summary: simAllowed ? `Live ${sim?.active} telemetry is connected.` : 'The required simulator source is not ready.',
    expected: r.allowMockSimulator ? 'Connected simulator source (mock allowed)' : 'Connected real simulator source',
    observed: sim ? `source=${sim.source}; active=${sim.active}; connected=${sim.connected}` : 'No simulator status',
    signatureMaterial: sim ? `${sim.source}:${sim.active}:${sim.connected}` : 'no-simulator',
    delta: simAllowed ? [] : ['Launch/select the simulator and wait for a current telemetry snapshot.'],
    remediation: ['Open Telemetry, select Auto or the intended simulator, then verify that live data is updating.']
  })

  const displays = observation.displays
  const displayIds = [...new Set(displays?.displayIds ?? [])].sort((a, b) => a - b)
  const displayCount = displayIds.length
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.displays,
    category: 'displays',
    label: 'Displays',
    required: r.minDisplays > 0,
    meta: displays?.meta,
    state: displayCount >= r.minDisplays ? 'verified' : 'fail',
    summary: displayCount >= r.minDisplays ? `${displayCount} display(s) detected.` : 'Required displays are missing.',
    expected: `At least ${r.minDisplays} display(s)`,
    observed: `${displayCount} display(s): ${displayIds.join(', ') || 'none'}`,
    signatureMaterial: displayIds.join('|'),
    delta: displayCount >= r.minDisplays ? [] : [`Missing ${r.minDisplays - displayCount} display(s)`],
    remediation: ['Reconnect the display, enable it in Windows Display Settings, and rerun preflight.']
  })
  const dashboardWindowIdentities = stableSortedIdentities(displays?.openDashboardWindowIdentities ?? [])
  const dashboardWindows = dashboardWindowIdentities.length
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.dashboardWindows,
    category: 'displays',
    label: 'Dashboard windows',
    required: r.minDashboardWindows > 0,
    meta: displays?.meta,
    state: dashboardWindows >= r.minDashboardWindows ? 'verified' : 'fail',
    summary: dashboardWindows >= r.minDashboardWindows
      ? `${dashboardWindows} dashboard window(s) are healthy.`
      : 'Required dashboard windows are not open.',
    expected: `At least ${r.minDashboardWindows} open dashboard window(s)`,
    observed: `${dashboardWindows} open dashboard window(s): ${listed(dashboardWindowIdentities)}`,
    signatureMaterial: dashboardWindowIdentities.join('|'),
    delta: dashboardWindows >= r.minDashboardWindows ? [] : [`Open ${r.minDashboardWindows - dashboardWindows} more dashboard window(s)`],
    remediation: ['Open the intended dashboard on the target display and rerun preflight.']
  })

  const serial = observation.serial
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.simx,
    category: 'serial',
    label: 'SIM-X primary',
    required: r.requireSimX,
    meta: serial?.meta,
    state: serial?.simxConnected ? 'verified' : 'fail',
    summary: serial?.simxConnected ? 'SIM-X is connected through the shared SerialHub.' : 'SIM-X is disconnected.',
    expected: 'Connected SIM-X primary device',
    observed: serial?.simxConnected ? serial.simxIdentity || 'connected' : 'disconnected',
    signatureMaterial: serial?.simxConnected ? serial.simxIdentity || 'connected-unidentified' : 'disconnected',
    delta: serial?.simxConnected ? [] : ['SIM-X connection missing'],
    remediation: ['Open Devices, choose the stable SIM-X port, connect it, and rerun preflight.']
  })
  const configuredIdentities = stableSortedIdentities(serial?.configuredIdentities ?? [])
  const connectedConfiguredIdentities = stableSortedIdentities(serial?.connectedConfiguredIdentities ?? [])
  const observedConfiguredIdentities = stableSortedIdentities(serial?.observedConfiguredIdentities ?? [])
  const connectedConfigured = new Set(connectedConfiguredIdentities)
  const disconnectedIdentities = configuredIdentities.filter((identity) => !connectedConfigured.has(identity))
  const configuredReady = configuredIdentities.length > 0 && disconnectedIdentities.length === 0
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.configuredSerial,
    category: 'serial',
    label: 'Configured serial / Arduino devices',
    required: r.requireConfiguredSerial,
    meta: serial?.meta,
    state: configuredReady ? 'verified' : 'fail',
    summary: configuredReady
      ? `${connectedConfiguredIdentities.length} configured serial device(s) connected by stable identity.`
      : 'One or more configured serial devices are absent.',
    expected: 'Every configured serial/Arduino device connected by stable identity',
    observed: `desired=${listed(configuredIdentities)}; connected=${listed(connectedConfiguredIdentities)}; observed=${listed(observedConfiguredIdentities)}; disconnected=${listed(disconnectedIdentities)}`,
    signatureMaterial: `desired=${configuredIdentities.join('|')};connected=${connectedConfiguredIdentities.join('|')};observed=${observedConfiguredIdentities.join('|')}`,
    delta: configuredReady ? [] : configuredIdentities.length
      ? disconnectedIdentities.map((identity) => `${identity} disconnected`)
      : ['No serial device is configured'],
    remediation: ['Reconnect devices from Arduinos, resolve exclusive COM-port conflicts, and verify VID/PID/serial identity.']
  })
  const esp32RequiredIdentities = stableSortedIdentities(
    (serial?.esp32RequiredIdentities ?? [])
      .map(canonicalRigEsp32Identity)
      .filter((identity): identity is string => identity !== null)
  )
  const esp32ConnectedIdentities = stableSortedIdentities(
    (serial?.esp32ConnectedIdentities ?? [])
      .map(canonicalRigEsp32Identity)
      .filter((identity): identity is string => identity !== null)
  )
  const esp32Connected = new Set(esp32ConnectedIdentities)
  const missingEsp32 = esp32RequiredIdentities.filter((identity) => !esp32Connected.has(identity))
  const esp32Ready = esp32RequiredIdentities.length > 0
    ? missingEsp32.length === 0
    : esp32ConnectedIdentities.length > 0
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.esp32,
    category: 'serial',
    label: 'ESP32 devices',
    required: r.requireEsp32,
    meta: serial?.meta,
    state: esp32Ready ? 'verified' : 'fail',
    summary: esp32Ready ? 'Configured ESP32 devices are connected.' : 'A required ESP32 is not connected.',
    expected: 'Every configured ESP32 connected over USB/serial or LAN',
    observed: `desired=${listed(esp32RequiredIdentities)}; connected=${listed(esp32ConnectedIdentities)}`,
    signatureMaterial: `desired=${esp32RequiredIdentities.join('|')};connected=${esp32ConnectedIdentities.join('|')}`,
    delta: esp32Ready ? [] : missingEsp32.length
      ? missingEsp32.map((identity) => `${identity} disconnected`)
      : ['ESP32 connection or profile is missing'],
    remediation: ['Use ESP32 Wi-Fi Discover/Connect or reconnect its USB serial profile, then rerun preflight.']
  })

  const audio = observation.audio
  const outputIdentities = stableSortedIdentities(audio?.outputIdentities ?? [])
  const inputIdentities = stableSortedIdentities(audio?.inputIdentities ?? [])
  const outputReady = Boolean(
    audio?.enumerationSucceeded &&
    audio.audioEngineOk &&
    audio.audioContextState === 'running' &&
    outputIdentities.length > 0
  )
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.audioOutput,
    category: 'audio',
    label: 'Audio output',
    required: r.requireAudioOutput,
    meta: audio?.meta,
    state: outputReady ? 'verified' : 'fail',
    summary: outputReady ? 'Audio engine and at least one output route are available.' : 'Audio output could not be verified.',
    expected: 'Working local audio engine with an enumerated output route',
    observed: audio
      ? `enumerated=${audio.enumerationSucceeded}; context=${audio.audioContextState}; engine=${audio.audioEngineOk}; outputs=${listed(outputIdentities)} (${listed(audio.outputLabels)})${audio.audioEngineError ? `; ${audio.audioEngineError}` : ''}`
      : 'No audio evidence',
    signatureMaterial: audio
      ? `enumerated=${audio.enumerationSucceeded};context=${audio.audioContextState};outputs=${outputIdentities.join('|')}`
      : 'no-audio',
    delta: outputReady ? [] : ['Audio engine or output route unavailable'],
    remediation: ['Select a valid Windows output in Sounds/Haptics and run the silent audio probe again.']
  })
  const inputReady = Boolean(audio?.enumerationSucceeded && audio.audioContextState === 'running' && inputIdentities.length > 0)
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.audioInput,
    category: 'audio',
    label: 'Microphone input',
    required: r.requireAudioInput,
    meta: audio?.meta,
    state: inputReady ? 'verified' : 'fail',
    summary: inputReady ? 'At least one microphone input is visible.' : 'No microphone input was detected.',
    expected: 'At least one local microphone input',
    observed: `${inputIdentities.length} input(s): ${listed(inputIdentities)} (${listed(audio?.inputLabels ?? [])})`,
    signatureMaterial: `enumerated=${audio?.enumerationSucceeded ?? false};context=${audio?.audioContextState ?? 'missing'};inputs=${inputIdentities.join('|')}`,
    delta: inputReady ? [] : ['Microphone input missing'],
    remediation: ['Connect/enable the microphone and allow microphone access in Windows Privacy settings.']
  })

  const tts = observation.tts
  const installedVoiceIds = stableSortedIdentities(tts?.installedVoiceIds ?? [])
  const ttsReady = Boolean(tts?.engineOk && installedVoiceIds.length > 0)
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.tts,
    category: 'audio',
    label: 'Text-to-speech',
    required: r.requireTts,
    meta: tts?.meta,
    state: ttsReady ? 'verified' : 'fail',
    summary: ttsReady ? 'Local neural TTS and an installed voice are ready.' : 'Local TTS is missing an engine or voice.',
    expected: 'Healthy local TTS engine and at least one installed voice',
    observed: tts
      ? `enginePresent=${tts.enginePresent}; engineOk=${tts.engineOk}; voices=${listed(installedVoiceIds)}${tts.engineReason ? `; ${tts.engineReason}` : ''}`
      : 'No TTS status',
    signatureMaterial: tts
      ? `engine=${tts.enginePresent}:${tts.engineOk};voices=${installedVoiceIds.join('|')}`
      : 'no-tts',
    delta: ttsReady ? [] : ['TTS engine/voice unavailable'],
    remediation: ['Open Voice / TTS, install a matching voice, and repair bundled sherpa/espeak resources if the engine probe fails.']
  })

  const stt = observation.stt
  const sttReady = Boolean(stt?.enabled && stt.binaryPresent && stt.modelPresent)
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.stt,
    category: 'audio',
    label: 'Speech-to-text',
    required: r.requireStt,
    meta: stt?.meta,
    state: sttReady ? 'verified' : 'fail',
    summary: sttReady ? 'Offline STT binary and model are ready.' : 'Offline STT is disabled or missing resources.',
    expected: 'STT enabled with whisper binary and selected model',
    observed: stt
      ? `enabled=${stt.enabled}; binary=${stt.binaryPresent}; model=${stt.modelPresent}; vad=${stt.vadModelPresent}`
      : 'No STT status',
    delta: sttReady ? [] : ['STT binary/model/config not ready'],
    remediation: ['Enable STT, install the selected whisper model, and repair the packaged whisper binary if absent.']
  })

  const haptics = observation.haptics
  const hapticsRoute = Boolean(
    haptics &&
    haptics.enabled &&
    !haptics.muted &&
    haptics.enabledEffects > 0 &&
    (haptics.audioRouteAvailable || (haptics.arduinoEnabled && haptics.arduinoConnected))
  )
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.haptics,
    category: 'haptics',
    label: 'Haptics route',
    required: r.requireHaptics,
    meta: haptics?.meta,
    state: hapticsRoute ? 'verified' : 'fail',
    summary: hapticsRoute ? 'Haptics has an enabled effect and a live output route.' : 'Haptics is disabled, muted, or unrouted.',
    expected: 'Enabled, unmuted haptics with at least one effect and a live audio/Arduino route',
    observed: haptics
      ? `enabled=${haptics.enabled}; muted=${haptics.muted}; effects=${haptics.enabledEffects}; outputDeviceId=${haptics.outputDeviceId || 'system-default'}; audioRoute=${haptics.audioRouteAvailable}; arduinoEnabled=${haptics.arduinoEnabled}; arduinoDeviceId=${haptics.arduinoDeviceId || 'none'}; arduinoConnected=${haptics.arduinoConnected}`
      : 'No haptics config',
    signatureMaterial: haptics
      ? `enabled=${haptics.enabled};muted=${haptics.muted};effects=${haptics.enabledEffects};output=${haptics.outputDeviceId || 'system-default'};audioRoute=${haptics.audioRouteAvailable};arduinoEnabled=${haptics.arduinoEnabled};arduinoDevice=${haptics.arduinoDeviceId || 'none'};arduinoConnected=${haptics.arduinoConnected}`
      : 'no-haptics',
    delta: hapticsRoute ? [] : ['Haptics output path incomplete'],
    remediation: ['Enable an effect, select the bass-shaker output or connected companion Arduino, unmute, and rerun preflight.']
  })

  const controls = observation.controls
  const gamepadIdentities = stableSortedIdentities(controls?.gamepadIdentities ?? [])
  const bindingIdentities = stableSortedIdentities(controls?.bindingIdentities ?? [])
  const enabledBindingIdentities = stableSortedIdentities(controls?.enabledBindingIdentities ?? [])
  const gamepadReady = gamepadIdentities.length > 0
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.gamepad,
    category: 'controls',
    label: 'Physical controls',
    required: r.requireGamepad,
    meta: controls?.meta,
    state: gamepadReady ? 'verified' : 'fail',
    summary: gamepadReady ? `${gamepadIdentities.length} stable game controller identity/identities detected.` : 'No game controller is visible.',
    expected: 'At least one connected Web Gamepad/HID controller',
    observed: `${gamepadIdentities.length}: ${listed(gamepadIdentities)}`,
    signatureMaterial: gamepadIdentities.join('|'),
    delta: gamepadReady ? [] : ['Controller not detected'],
    remediation: ['Reconnect the wheel/button box, press a button to wake the Gamepad API, then open Input Monitor.']
  })
  const bindingsReady = enabledBindingIdentities.length > 0
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.bindings,
    category: 'controls',
    label: 'Control bindings',
    required: r.requireControlBindings,
    meta: controls?.meta,
    state: bindingsReady ? 'verified' : 'fail',
    summary: bindingsReady ? 'Enabled control bindings are configured.' : 'No enabled control binding is configured.',
    expected: 'At least one enabled binding',
    observed: `${enabledBindingIdentities.length}/${bindingIdentities.length} enabled (${listed(enabledBindingIdentities)}); keyboard emulation=${controls?.keyboardEmulationAvailable ?? false}; gamepad emulation=${controls?.gamepadEmulationAvailable ?? false}`,
    signatureMaterial: `all=${bindingIdentities.join('|')};enabled=${enabledBindingIdentities.join('|')};keyboard=${controls?.keyboardEmulationAvailable ?? false};gamepad=${controls?.gamepadEmulationAvailable ?? false}`,
    delta: bindingsReady ? [] : ['Control bindings missing or disabled'],
    remediation: ['Configure and enable the required Controls & Keyboard bindings, then test them before racing.']
  })

  const streaming = observation.streaming
  const desiredPort = r.streamingPort
  const portMatches = Boolean(
    streaming?.running &&
    streaming.port &&
    (desiredPort === 0 || streaming.port === desiredPort)
  )
  let streamingState: RigPreflightUnderlyingState = 'fail'
  let streamingSummary = 'Streaming is not running on the required port.'
  if (portMatches && streaming?.ownerState === 'app') {
    streamingState = 'verified'
    streamingSummary = `Streaming port ${streaming.port} is owned by this app.`
  } else if (portMatches && (streaming?.ownerState === 'unknown' || streaming?.ownerState === 'free')) {
    streamingState = 'unknown'
    streamingSummary = 'Streaming reports a listener, but OS port ownership could not be proven.'
  } else if (streaming?.ownerState === 'foreign') {
    streamingSummary = `Port ${desiredPort || streaming.port || '?'} is owned by another process.`
  }
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.streamingPort,
    category: 'streaming',
    label: 'Streaming port ownership',
    required: r.requireStreaming,
    meta: streaming?.meta,
    state: streamingState,
    summary: streamingSummary,
    expected: desiredPort > 0 ? `App-owned listener on TCP ${desiredPort}` : 'App-owned streaming listener on a selected TCP port',
    observed: streaming
      ? `running=${streaming.running}; port=${streaming.port ?? 'none'}; owner=${streaming.ownerState}${streaming.ownerPid ? ` pid=${streaming.ownerPid}` : ''}${streaming.ownerName ? ` (${streaming.ownerName})` : ''}${streaming.ownerDetail ? `; ${streaming.ownerDetail}` : ''}`
      : 'No streaming status',
    signatureMaterial: streaming
      ? `running=${streaming.running}; port=${streaming.port ?? 'none'}; access=${streaming.accessMode}; owner=${streaming.ownerState}; tunnel=${streaming.autoTunnelAvailable}`
      : 'no-streaming-status',
    delta: streamingState === 'verified' ? [] : [streamingSummary],
    remediation: [
      streaming?.ownerState === 'foreign'
        ? `Stop or reconfigure ${streaming.ownerName || 'the foreign process'}${streaming.ownerPid ? ` (PID ${streaming.ownerPid})` : ''}, or choose another port.`
        : 'Start browser streaming on the intended port and rerun preflight.'
    ]
  })

  add({
    id: RIG_PREFLIGHT_CHECK_IDS.ttsEngineResource,
    category: 'resources',
    label: 'TTS engine resource',
    required: r.requireTts,
    meta: tts?.meta,
    state: tts?.enginePresent ? 'verified' : 'fail',
    summary: tts?.enginePresent ? 'Sherpa TTS engine files are present.' : 'Sherpa TTS engine files are missing.',
    expected: 'Bundled sherpa-onnx engine',
    observed: `present=${tts?.enginePresent ?? false}`,
    delta: tts?.enginePresent ? [] : ['TTS engine binary/package missing'],
    remediation: ['Restore the packaged TTS resources or run the existing Windows TTS fetch/verification workflow.']
  })
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.ttsVoiceResource,
    category: 'resources',
    label: 'TTS voice resource',
    required: r.requireTts,
    meta: tts?.meta,
    state: installedVoiceIds.length > 0 ? 'verified' : 'fail',
    summary: installedVoiceIds.length > 0 ? 'At least one local TTS voice is installed.' : 'No local TTS voice is installed.',
    expected: 'At least one installed voice model',
    observed: `${installedVoiceIds.length} installed voice(s): ${listed(installedVoiceIds)}`,
    signatureMaterial: installedVoiceIds.join('|'),
    delta: installedVoiceIds.length > 0 ? [] : ['Voice model missing'],
    remediation: ['Download a voice from Voice / TTS before relying on spoken calls.']
  })
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.sttBinaryResource,
    category: 'resources',
    label: 'STT binary resource',
    required: r.requireStt,
    meta: stt?.meta,
    state: stt?.binaryPresent ? 'verified' : 'fail',
    summary: stt?.binaryPresent ? 'Whisper binary is present.' : 'Whisper binary is missing.',
    expected: 'Bundled whisper-cli/main binary',
    observed: `present=${stt?.binaryPresent ?? false}`,
    delta: stt?.binaryPresent ? [] : ['Whisper binary missing'],
    remediation: ['Restore the packaged whisper resources using the existing Windows fetch workflow.']
  })
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.sttModelResource,
    category: 'resources',
    label: 'STT model resource',
    required: r.requireStt,
    meta: stt?.meta,
    state: stt?.modelPresent ? 'verified' : 'fail',
    summary: stt?.modelPresent ? 'Selected STT model is present.' : 'Selected STT model is missing.',
    expected: 'Selected local ggml model',
    observed: `present=${stt?.modelPresent ?? false}`,
    delta: stt?.modelPresent ? [] : ['STT model missing'],
    remediation: ['Use Voice / TTS to download the selected STT model before enabling wake-word/STT.']
  })
  add({
    id: RIG_PREFLIGHT_CHECK_IDS.cloudflaredResource,
    category: 'resources',
    label: 'Streaming tunnel resource',
    required: r.requireStreamingTunnel,
    meta: streaming?.meta,
    state: streaming?.autoTunnelAvailable ? 'verified' : 'fail',
    summary: streaming?.autoTunnelAvailable ? 'Cloudflared tunnel binary is present.' : 'Cloudflared tunnel binary is missing.',
    expected: 'Bundled cloudflared binary',
    observed: `present=${streaming?.autoTunnelAvailable ?? false}`,
    delta: streaming?.autoTunnelAvailable ? [] : ['Cloudflared binary missing'],
    remediation: ['Restore the packaged cloudflared resource or disable the tunnel requirement and use local/LAN streaming.']
  })

  return checks
}

export function createKnownGoodCheck(
  profile: RigPreflightProfile,
  signature: string,
  knownGood: RigKnownGood | null,
  waivers: RigPreflightWaiver[],
  now = Date.now()
): RigPreflightCheck {
  const required = profile.requirements.requireKnownGood
  const state: RigPreflightUnderlyingState = !knownGood
    ? 'unknown'
    : knownGood.signature === signature
      ? 'verified'
      : 'fail'
  const summary = !knownGood
    ? 'No known-good signature has been accepted.'
    : state === 'verified'
      ? 'Current rig signature matches the accepted known-good baseline.'
      : 'Current rig signature drifted from the accepted known-good baseline.'
  return withWaiver(
    {
      id: RIG_PREFLIGHT_CHECK_IDS.knownGood,
      category: 'baseline',
      label: 'Known-good rig signature',
      required,
      owner: profile.owner,
      maxAgeMs: profile.evidenceMaxAgeMs,
      now,
      meta: {
        observedAt: now,
        owner: knownGood?.owner || profile.owner,
        provenance: [{ kind: 'config', source: 'rig-preflight baseline', detail: knownGood?.runId || 'not established' }]
      },
      state,
      summary,
      expected: knownGood?.signature || 'Explicitly accepted clean baseline',
      observed: signature,
      signatureMaterial: signature,
      delta: state === 'verified' ? [] : [summary],
      remediation: [
        knownGood
          ? 'Inspect the desired/reported deltas, restore the rig, or explicitly accept a new clean baseline.'
          : 'After every other required check is verified, explicitly save that run as known-good.'
      ]
    },
    waivers,
    now
  )
}

export function summarizeRigPreflightChecks(checks: RigPreflightCheck[]): {
  decision: RigPreflightCertificate['decision']
  coverage: number
  counts: Record<RigPreflightState, number>
  untestedCheckIds: string[]
  waivedCheckIds: string[]
} {
  const counts: Record<RigPreflightState, number> = {
    verified: 0,
    unknown: 0,
    fail: 0,
    'waived-with-reason': 0
  }
  for (const check of checks) counts[check.state] += 1
  const required = checks.filter((check) => check.applicability === 'required')
  const decided = required.filter((check) => check.state !== 'unknown')
  const coverage = required.length === 0 ? 1 : decided.length / required.length
  const hasFail = required.some((check) => check.state === 'fail')
  const hasUnknown = required.some((check) => check.state === 'unknown')
  const hasWaiver = required.some((check) => check.state === 'waived-with-reason')
  return {
    decision: hasFail || hasUnknown ? 'blocked' : hasWaiver ? 'ready-with-waivers' : 'ready',
    coverage,
    counts,
    untestedCheckIds: checks
      .filter((check) => check.applicability === 'not-required' || check.state === 'unknown')
      .map((check) => check.id),
    waivedCheckIds: checks.filter((check) => check.state === 'waived-with-reason').map((check) => check.id)
  }
}

function cloneObservation(observation: RigPreflightObservation): RigPreflightObservation {
  return JSON.parse(JSON.stringify(observation)) as RigPreflightObservation
}

function faultMeta(now: number, source: string): RigEvidenceMeta {
  return {
    observedAt: now,
    owner: 'Seeded fault harness',
    provenance: [{ kind: 'fault', source, detail: 'Synthetic evidence mutation; no hardware actuation' }]
  }
}

export function applyRigPreflightFault(
  observation: RigPreflightObservation,
  faultId: RigPreflightFaultId,
  now = Date.now(),
  maxAgeMs = 60_000
): RigPreflightObservation {
  const next = cloneObservation(observation)
  if (faultId === 'serial-disconnect') {
    next.serial = {
      ...(next.serial ?? {
        meta: faultMeta(now, faultId),
        availablePorts: [],
        simxConnected: false,
        configuredIdentities: ['serial:seeded-arduino'],
        connectedConfiguredIdentities: [],
        observedConfiguredIdentities: ['serial:seeded-arduino=>unobserved'],
        esp32RequiredIdentities: [],
        esp32ConnectedIdentities: []
      }),
      meta: faultMeta(now, faultId),
      simxConnected: false,
      configuredIdentities: next.serial?.configuredIdentities.length
        ? [...next.serial.configuredIdentities]
        : ['serial:seeded-arduino'],
      connectedConfiguredIdentities: []
    }
  } else if (faultId === 'stale-evidence') {
    const staleAt = now - maxAgeMs - 1
    for (const value of Object.values(next)) {
      if (value && typeof value === 'object' && 'meta' in value) {
        ;(value as { meta: RigEvidenceMeta }).meta = {
          ...(value as { meta: RigEvidenceMeta }).meta,
          observedAt: staleAt,
          provenance: [{ kind: 'fault', source: faultId, detail: 'Evidence timestamp moved beyond freshness window' }]
        }
      }
    }
    if (next.simulator) next.simulator.snapshotAt = staleAt
  } else if (faultId === 'foreign-port-owner') {
    next.streaming = {
      ...(next.streaming ?? {
        meta: faultMeta(now, faultId),
        running: false,
        port: 47655,
        accessMode: 'local',
        autoTunnelAvailable: false,
        ownerState: 'foreign'
      }),
      meta: faultMeta(now, faultId),
      running: false,
      port: next.streaming?.port ?? 47655,
      ownerState: 'foreign',
      ownerPid: 4242,
      ownerName: 'seeded-port-owner'
    }
  } else if (faultId === 'missing-stt-binary') {
    next.stt = {
      ...(next.stt ?? {
        meta: faultMeta(now, faultId),
        enabled: true,
        binaryPresent: false,
        modelPresent: true,
        vadModelPresent: true
      }),
      meta: faultMeta(now, faultId),
      enabled: true,
      binaryPresent: false,
      modelPresent: true
    }
  } else if (faultId === 'missing-tts-engine') {
    next.tts = {
      ...(next.tts ?? {
        meta: faultMeta(now, faultId),
        enginePresent: false,
        engineOk: false,
        installedVoiceIds: ['seeded-voice']
      }),
      meta: faultMeta(now, faultId),
      enginePresent: false,
      engineOk: false,
      engineReason: 'Seeded missing engine',
      installedVoiceIds: next.tts?.installedVoiceIds.length
        ? [...next.tts.installedVoiceIds]
        : ['seeded-voice']
    }
  } else if (faultId === 'display-disconnect') {
    next.displays = {
      meta: faultMeta(now, faultId),
      displayIds: [],
      openDashboardWindowIdentities: []
    }
  }
  return next
}

export function runRigPreflightFaultMatrix(
  profile: RigPreflightProfile,
  observation: RigPreflightObservation,
  now = Date.now()
): RigFaultResult[] {
  const cases: Array<{
    faultId: RigPreflightFaultId
    checkId: string
    expectedState: RigPreflightUnderlyingState
    patch: Partial<RigPreflightRequirements>
  }> = [
    {
      faultId: 'serial-disconnect',
      checkId: RIG_PREFLIGHT_CHECK_IDS.configuredSerial,
      expectedState: 'fail',
      patch: { requireConfiguredSerial: true }
    },
    {
      faultId: 'stale-evidence',
      checkId: RIG_PREFLIGHT_CHECK_IDS.simulator,
      expectedState: 'unknown',
      patch: { requireSimulator: true }
    },
    {
      faultId: 'foreign-port-owner',
      checkId: RIG_PREFLIGHT_CHECK_IDS.streamingPort,
      expectedState: 'fail',
      patch: { requireStreaming: true, streamingPort: observation.streaming?.port ?? 47655 }
    },
    {
      faultId: 'missing-stt-binary',
      checkId: RIG_PREFLIGHT_CHECK_IDS.sttBinaryResource,
      expectedState: 'fail',
      patch: { requireStt: true }
    },
    {
      faultId: 'missing-tts-engine',
      checkId: RIG_PREFLIGHT_CHECK_IDS.ttsEngineResource,
      expectedState: 'fail',
      patch: { requireTts: true }
    },
    {
      faultId: 'display-disconnect',
      checkId: RIG_PREFLIGHT_CHECK_IDS.displays,
      expectedState: 'fail',
      patch: { minDisplays: Math.max(1, profile.requirements.minDisplays) }
    }
  ]
  return cases.map(({ faultId, checkId, expectedState, patch }) => {
    const caseProfile: RigPreflightProfile = {
      ...profile,
      requirements: { ...profile.requirements, ...patch, requireKnownGood: false }
    }
    const faulted = applyRigPreflightFault(observation, faultId, now, profile.evidenceMaxAgeMs)
    const check = evaluateRigPreflightChecks(caseProfile, faulted, [], now).find((candidate) => candidate.id === checkId)
    const actualState = check?.state ?? 'unknown'
    return {
      faultId,
      checkId,
      expectedState,
      actualState,
      detected: actualState === expectedState,
      summary: check?.summary ?? 'Expected check was not produced.'
    }
  })
}

export function defaultRigPreflightState(now = Date.now()): RigPreflightPersistedState {
  return {
    version: 1,
    profile: createRigPreflightProfile('configured', now),
    waivers: [],
    history: [],
    faultHistory: [],
    knownGood: null,
    activeCertificate: null,
    updatedAt: now
  }
}
