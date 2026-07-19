export const MISSION_REHEARSAL_SCHEMA_VERSION = 1 as const
export const MISSION_REHEARSAL_RUN_SCHEMA_VERSION = 1 as const
export const MISSION_REHEARSAL_SOURCE = 'synthetic-training' as const
export const MISSION_TRAINING_WATERMARK = 'TRAINING · SYNTHETIC · OFFLINE' as const
export const MISSION_MANIFEST_FILE_KIND = 'ultimate-sim-app.mission-rehearsal.manifest' as const
export const MISSION_RUN_FILE_KIND = 'ultimate-sim-app.mission-rehearsal.run' as const
export const MISSION_HISTORY_FILE_KIND = 'ultimate-sim-app.mission-rehearsal.history' as const
// Portable corruption check only. Semantic replay also rejects inconsistent run
// state, but neither mechanism is a cryptographic signature or identity proof.
export const MISSION_INTEGRITY_ALGORITHM = 'fnv1a32' as const
export const MISSION_MAX_IMPORT_CHARS = 1_048_576

export const MISSION_PERMISSIONS = ['run', 'decide', 'inject', 'author', 'debrief'] as const
export type MissionPermission = (typeof MISSION_PERMISSIONS)[number]

export const MISSION_EVENT_KINDS = [
  'race-control',
  'weather',
  'telemetry-cue',
  'radio',
  'hardware',
  'incident'
] as const
export type MissionSyntheticEventKind = (typeof MISSION_EVENT_KINDS)[number]

export const MISSION_OUTCOME_TONES = ['positive', 'tradeoff', 'risk'] as const
export type MissionOutcomeTone = (typeof MISSION_OUTCOME_TONES)[number]
export type MissionEventValue = string | number | boolean | null

export interface MissionTrainingBoundary {
  mode: 'offline-only'
  watermark: typeof MISSION_TRAINING_WATERMARK
  resetScope: 'mission-rehearsal-only'
  syntheticDataPolicy: 'never-write-live-telemetry-or-history'
}

export interface MissionRole {
  id: string
  name: string
  description: string
  permissions: MissionPermission[]
}

export interface MissionSyntheticEvent {
  id: string
  title: string
  description: string
  kind: MissionSyntheticEventKind
  source: typeof MISSION_REHEARSAL_SOURCE
  offsetMs: number
  probability: number
  visibleToRoleIds: string[]
  payload: Record<string, MissionEventValue>
}

export interface MissionOutcome {
  id: string
  title: string
  description: string
  tone: MissionOutcomeTone
}

export interface MissionDecision {
  id: string
  label: string
  description: string
  allowedRoleIds: string[]
  score: number
  nextCheckpointId: string | null
  outcomes: MissionOutcome[]
}

export interface MissionCheckpoint {
  id: string
  title: string
  briefing: string
  expectedDecisionId: string
  syntheticEvents: MissionSyntheticEvent[]
  decisions: MissionDecision[]
}

export interface MissionScenarioManifest {
  schemaVersion: typeof MISSION_REHEARSAL_SCHEMA_VERSION
  id: string
  revision: number
  title: string
  description: string
  objective: string
  seed: number
  tags: string[]
  boundary: MissionTrainingBoundary
  roles: MissionRole[]
  entryCheckpointId: string
  checkpoints: MissionCheckpoint[]
}

export interface MissionRunStep {
  checkpointId: string
  decisionId: string
  decidedByRoleId: string
  decidedAt: number
}

export interface MissionRun {
  schemaVersion: typeof MISSION_REHEARSAL_RUN_SCHEMA_VERSION
  id: string
  source: typeof MISSION_REHEARSAL_SOURCE
  manifestId: string
  manifestRevision: number
  manifestChecksum: string
  roleId: string
  startedAt: number
  updatedAt: number
  status: 'in-progress' | 'completed'
  currentCheckpointId: string | null
  steps: MissionRunStep[]
}

export interface MissionIntegrity {
  algorithm: typeof MISSION_INTEGRITY_ALGORITHM
  checksum: string
}

export interface MissionManifestFile {
  kind: typeof MISSION_MANIFEST_FILE_KIND
  schemaVersion: typeof MISSION_REHEARSAL_SCHEMA_VERSION
  exportedAt: string
  manifest: MissionScenarioManifest
  integrity: MissionIntegrity
}

export interface MissionRunFile {
  kind: typeof MISSION_RUN_FILE_KIND
  schemaVersion: typeof MISSION_REHEARSAL_RUN_SCHEMA_VERSION
  exportedAt: string
  run: MissionRun
  integrity: MissionIntegrity
}

export interface MissionRunHistoryFile {
  kind: typeof MISSION_HISTORY_FILE_KIND
  schemaVersion: typeof MISSION_REHEARSAL_RUN_SCHEMA_VERSION
  exportedAt: string
  manifestId: string
  manifestRevision: number
  manifestChecksum: string
  runs: MissionRun[]
  integrity: MissionIntegrity
}

export interface MissionValidationIssue {
  path: string
  message: string
}

export type MissionValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: MissionValidationIssue[] }

export class MissionSchemaError extends Error {
  readonly issues: MissionValidationIssue[]

  constructor(message: string, issues: MissionValidationIssue[]) {
    super(message)
    this.name = 'MissionSchemaError'
    this.issues = issues
  }
}

export interface MissionCheckpointScore {
  checkpointId: string
  checkpointTitle: string
  selectedDecisionId: string
  selectedDecisionLabel: string
  expectedDecisionId: string
  expectedDecisionLabel: string
  points: number
  maxPoints: number
  aligned: boolean
  selectedOutcomes: MissionOutcome[]
  expectedOutcomes: MissionOutcome[]
}

export interface MissionScore {
  points: number
  maxPoints: number
  percent: number
  completed: boolean
  checkpoints: MissionCheckpointScore[]
}

export interface MissionDebriefCheckpoint extends MissionCheckpointScore {
  review: string
}

export interface MissionDebrief {
  score: MissionScore
  blamelessStatement: string
  strengths: string[]
  reviewPrompts: string[]
  checkpoints: MissionDebriefCheckpoint[]
}

export interface MissionRunComparisonCheckpoint {
  checkpointId: string
  checkpointTitle: string
  baselineDecisionId: string | null
  currentDecisionId: string | null
  baselineDecisionLabel: string | null
  currentDecisionLabel: string | null
  decisionChanged: boolean
  pointDelta: number
}

export interface MissionRunComparison {
  baselineRunId: string
  currentRunId: string
  baselinePercent: number
  currentPercent: number
  percentDelta: number
  scoreDelta: number
  consistencyPercent: number
  changedCheckpointIds: string[]
  improvedCheckpointIds: string[]
  regressedCheckpointIds: string[]
  checkpoints: MissionRunComparisonCheckpoint[]
}

export const DEFAULT_MISSION_REHEARSAL_MANIFEST: MissionScenarioManifest = {
  schemaVersion: MISSION_REHEARSAL_SCHEMA_VERSION,
  id: 'endurance-weather-neutralization',
  revision: 1,
  title: 'Endurance weather neutralization',
  description: 'Rehearse a neutralization, a fast weather transition, and degraded team communications without touching live simulator data.',
  objective: 'Preserve safety, shared context, and a recoverable strategy while the team makes time-bounded decisions.',
  seed: 240718,
  tags: ['endurance', 'weather', 'race-control', 'communications'],
  boundary: {
    mode: 'offline-only',
    watermark: MISSION_TRAINING_WATERMARK,
    resetScope: 'mission-rehearsal-only',
    syntheticDataPolicy: 'never-write-live-telemetry-or-history'
  },
  roles: [
    {
      id: 'race-engineer',
      name: 'Race engineer',
      description: 'Owns decision framing, driver communication, and strategy calls.',
      permissions: ['run', 'decide', 'inject', 'author', 'debrief']
    },
    {
      id: 'crew-chief',
      name: 'Crew chief',
      description: 'Coordinates pit readiness, fallback communications, and operational safety.',
      permissions: ['run', 'decide', 'inject', 'debrief']
    },
    {
      id: 'driver',
      name: 'Driver',
      description: 'Reports grip and visibility while executing the agreed plan.',
      permissions: ['run', 'decide', 'debrief']
    },
    {
      id: 'observer',
      name: 'Observer',
      description: 'Follows the rehearsal and contributes to the blameless debrief.',
      permissions: ['debrief']
    }
  ],
  entryCheckpointId: 'neutralization-call',
  checkpoints: [
    {
      id: 'neutralization-call',
      title: 'Neutralization call',
      briefing: 'Race control reports a local yellow ahead while the class leader closes rapidly. Establish a shared operating state before optimizing position.',
      expectedDecisionId: 'confirm-neutralized-pace',
      syntheticEvents: [
        {
          id: 'race-control-yellow',
          title: 'Local yellow in sector two',
          description: 'Synthetic race-control message: incident ahead, no overtaking through sector two.',
          kind: 'race-control',
          source: MISSION_REHEARSAL_SOURCE,
          offsetMs: 0,
          probability: 1,
          visibleToRoleIds: ['race-engineer', 'crew-chief', 'driver', 'observer'],
          payload: { sector: 2, overtakingAllowed: false, messageCode: 'LOCAL_YELLOW' }
        },
        {
          id: 'closing-class-leader',
          title: 'Class leader closing',
          description: 'Synthetic timing cue: the class leader is 2.4 seconds behind and closing.',
          kind: 'telemetry-cue',
          source: MISSION_REHEARSAL_SOURCE,
          offsetMs: 1800,
          probability: 1,
          visibleToRoleIds: ['race-engineer', 'crew-chief', 'driver', 'observer'],
          payload: { gapSeconds: 2.4, closingSecondsPerLap: 1.1, synthetic: true }
        }
      ],
      decisions: [
        {
          id: 'confirm-neutralized-pace',
          label: 'Confirm no-overtake state and hold predictable pace',
          description: 'Use a closed-loop call, acknowledge the leader, and keep the car predictable through the yellow zone.',
          allowedRoleIds: ['race-engineer', 'crew-chief', 'driver'],
          score: 100,
          nextCheckpointId: 'weather-window',
          outcomes: [
            {
              id: 'shared-state-established',
              title: 'Shared state established',
              description: 'Driver and pit wall operate from the same race-control interpretation.',
              tone: 'positive'
            }
          ]
        },
        {
          id: 'protect-gap-before-yellow',
          label: 'Push to protect the gap before the incident',
          description: 'Prioritize track position while the yellow-zone boundary is still approaching.',
          allowedRoleIds: ['race-engineer', 'driver'],
          score: 35,
          nextCheckpointId: 'steward-review',
          outcomes: [
            {
              id: 'ambiguous-compliance',
              title: 'Compliance becomes ambiguous',
              description: 'The team must later reconstruct whether the acceleration crossed the control boundary.',
              tone: 'risk'
            }
          ]
        }
      ]
    },
    {
      id: 'weather-window',
      title: 'Fast weather transition',
      briefing: 'The field remains neutralized. Rain is intensifying at pit entry and tyre surface temperatures are falling.',
      expectedDecisionId: 'prepare-wet-stop',
      syntheticEvents: [
        {
          id: 'rain-ramp',
          title: 'Rain intensity rising',
          description: 'Synthetic weather feed projects standing water within four minutes.',
          kind: 'weather',
          source: MISSION_REHEARSAL_SOURCE,
          offsetMs: 900,
          probability: 1,
          visibleToRoleIds: ['race-engineer', 'crew-chief', 'driver', 'observer'],
          payload: { rainPercent: 72, standingWaterEtaMinutes: 4, forecastConfidence: 0.86 }
        },
        {
          id: 'surface-temperature-drop',
          title: 'Tyre surface cooling',
          description: 'Synthetic cue shows the slick surface-temperature window collapsing under neutralized pace.',
          kind: 'telemetry-cue',
          source: MISSION_REHEARSAL_SOURCE,
          offsetMs: 2400,
          probability: 0.82,
          visibleToRoleIds: ['race-engineer', 'crew-chief', 'driver', 'observer'],
          payload: { frontSurfaceC: 61, rearSurfaceC: 64, gripTrend: 'falling', synthetic: true }
        }
      ],
      decisions: [
        {
          id: 'prepare-wet-stop',
          label: 'Prepare wets and confirm the pit trigger',
          description: 'Stage the stop, state the trigger in plain language, and ask the driver for one final grip report.',
          allowedRoleIds: ['race-engineer', 'crew-chief', 'driver'],
          score: 100,
          nextCheckpointId: 'degraded-comms',
          outcomes: [
            {
              id: 'pit-window-ready',
              title: 'Pit window ready',
              description: 'The team can act quickly without turning a forecast into an automatic command.',
              tone: 'positive'
            }
          ]
        },
        {
          id: 'wait-for-field-proof',
          label: 'Wait until another car proves the wet tyre',
          description: 'Delay preparation until competitor pace confirms the crossover.',
          allowedRoleIds: ['race-engineer', 'crew-chief'],
          score: 60,
          nextCheckpointId: 'traction-recovery',
          outcomes: [
            {
              id: 'late-crossover-risk',
              title: 'Late crossover risk',
              description: 'Additional evidence is gained at the cost of a narrower response window.',
              tone: 'tradeoff'
            }
          ]
        }
      ]
    },
    {
      id: 'degraded-comms',
      title: 'Degraded team communications',
      briefing: 'Primary radio audio becomes intermittent as pit entry approaches. The plan must survive a partial communications loss.',
      expectedDecisionId: 'fallback-protocol',
      syntheticEvents: [
        {
          id: 'radio-dropout',
          title: 'Primary radio dropout',
          description: 'Synthetic radio monitor reports repeated one-second audio gaps.',
          kind: 'radio',
          source: MISSION_REHEARSAL_SOURCE,
          offsetMs: 0,
          probability: 1,
          visibleToRoleIds: ['race-engineer', 'crew-chief', 'driver', 'observer'],
          payload: { dropouts: 4, windowSeconds: 12, primaryChannelHealthy: false }
        },
        {
          id: 'pit-board-ready',
          title: 'Fallback board available',
          description: 'Synthetic hardware status confirms the agreed fallback message can be shown.',
          kind: 'hardware',
          source: MISSION_REHEARSAL_SOURCE,
          offsetMs: 1200,
          probability: 1,
          visibleToRoleIds: ['race-engineer', 'crew-chief', 'observer'],
          payload: { fallbackChannel: 'pit-board', ready: true }
        }
      ],
      decisions: [
        {
          id: 'fallback-protocol',
          label: 'Switch to the rehearsed fallback protocol',
          description: 'Send the concise backup message, require a driver acknowledgement, and keep the original trigger unchanged.',
          allowedRoleIds: ['race-engineer', 'crew-chief', 'driver'],
          score: 100,
          nextCheckpointId: null,
          outcomes: [
            {
              id: 'plan-survives-comms-loss',
              title: 'Plan survives the dropout',
              description: 'The operational intent remains recoverable even with reduced bandwidth.',
              tone: 'positive'
            }
          ]
        },
        {
          id: 'repeat-primary-radio',
          label: 'Keep repeating the full message on primary radio',
          description: 'Continue the detailed primary-channel call without activating the fallback.',
          allowedRoleIds: ['race-engineer', 'driver'],
          score: 45,
          nextCheckpointId: null,
          outcomes: [
            {
              id: 'message-fragmentation',
              title: 'Message fragmentation',
              description: 'The driver may receive several incomplete versions of the same decision.',
              tone: 'risk'
            }
          ]
        }
      ]
    },
    {
      id: 'steward-review',
      title: 'Potential control-boundary breach',
      briefing: 'A synthetic steward query asks the team to explain the acceleration immediately before the local-yellow line.',
      expectedDecisionId: 'preserve-and-self-report',
      syntheticEvents: [
        {
          id: 'steward-query',
          title: 'Steward information request',
          description: 'Synthetic race-control request asks for the team timeline and driver instruction.',
          kind: 'race-control',
          source: MISSION_REHEARSAL_SOURCE,
          offsetMs: 0,
          probability: 1,
          visibleToRoleIds: ['race-engineer', 'crew-chief', 'driver', 'observer'],
          payload: { request: 'TIMELINE_AND_CALL', responseWindowSeconds: 90 }
        }
      ],
      decisions: [
        {
          id: 'preserve-and-self-report',
          label: 'Preserve the timeline and provide a factual self-report',
          description: 'State what was known, when it was known, and which control cue was used without assigning personal blame.',
          allowedRoleIds: ['race-engineer', 'crew-chief', 'driver'],
          score: 100,
          nextCheckpointId: null,
          outcomes: [
            {
              id: 'auditable-response',
              title: 'Auditable response',
              description: 'The team can review the process and cooperate with the steward inquiry.',
              tone: 'positive'
            }
          ]
        },
        {
          id: 'defend-without-timeline',
          label: 'Defend the call without reconstructing the timeline',
          description: 'Respond immediately from memory and focus on intent rather than evidence.',
          allowedRoleIds: ['race-engineer', 'driver'],
          score: 30,
          nextCheckpointId: null,
          outcomes: [
            {
              id: 'evidence-gap',
              title: 'Evidence gap',
              description: 'The response may be internally consistent but difficult to verify.',
              tone: 'risk'
            }
          ]
        }
      ]
    },
    {
      id: 'traction-recovery',
      title: 'Grip loss before pit entry',
      briefing: 'The delayed crossover produces a synthetic snap of oversteer and a slow exit. Stabilize the situation before revisiting strategy.',
      expectedDecisionId: 'stabilize-and-reframe',
      syntheticEvents: [
        {
          id: 'rear-grip-loss',
          title: 'Rear grip loss',
          description: 'Synthetic incident cue reports a large yaw correction with no contact.',
          kind: 'incident',
          source: MISSION_REHEARSAL_SOURCE,
          offsetMs: 0,
          probability: 1,
          visibleToRoleIds: ['race-engineer', 'crew-chief', 'driver', 'observer'],
          payload: { contact: false, speedLossKmh: 31, correctionDegrees: 22, synthetic: true }
        }
      ],
      decisions: [
        {
          id: 'stabilize-and-reframe',
          label: 'Stabilize the car, reset the trigger, and prepare the stop',
          description: 'Treat the grip loss as new evidence, protect the car, and restate the revised plan.',
          allowedRoleIds: ['race-engineer', 'crew-chief', 'driver'],
          score: 100,
          nextCheckpointId: 'degraded-comms',
          outcomes: [
            {
              id: 'recoverable-strategy',
              title: 'Recoverable strategy',
              description: 'The team absorbs the late evidence without turning it into individual fault.',
              tone: 'positive'
            }
          ]
        },
        {
          id: 'recover-lost-time',
          label: 'Recover the lost time before changing tyres',
          description: 'Ask for immediate pace recovery while retaining the delayed crossover plan.',
          allowedRoleIds: ['race-engineer', 'driver'],
          score: 25,
          nextCheckpointId: null,
          outcomes: [
            {
              id: 'compounding-risk',
              title: 'Compounding risk',
              description: 'The team adds performance pressure before restoring a stable operating state.',
              tone: 'risk'
            }
          ]
        }
      ]
    }
  ]
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/
const CHECKSUM_PATTERN = /^fnv1a32:[0-9a-f]{8}$/

function addIssue(issues: MissionValidationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}

function exactObject(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  issues: MissionValidationIssue[]
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    addIssue(issues, path, 'must be an object')
    return null
  }
  const object = value as Record<string, unknown>
  for (const key of Object.keys(object)) {
    if (!allowedKeys.includes(key)) addIssue(issues, `${path}.${key}`, 'unknown field')
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) addIssue(issues, `${path}.${key}`, 'is required')
  }
  return object
}

function validateString(
  value: unknown,
  path: string,
  issues: MissionValidationIssue[],
  min = 1,
  max = 1_000
): value is string {
  if (typeof value !== 'string') {
    addIssue(issues, path, 'must be a string')
    return false
  }
  if (value.length < min || value.length > max) {
    addIssue(issues, path, `must contain between ${min} and ${max} characters`)
    return false
  }
  return true
}

function validateId(value: unknown, path: string, issues: MissionValidationIssue[]): value is string {
  if (!validateString(value, path, issues, 2, 128)) return false
  if (!ID_PATTERN.test(value)) {
    addIssue(issues, path, 'must use lowercase letters, digits, dot, underscore, or dash')
    return false
  }
  return true
}

function validateInteger(
  value: unknown,
  path: string,
  issues: MissionValidationIssue[],
  min: number,
  max: number
): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    addIssue(issues, path, `must be an integer between ${min} and ${max}`)
    return false
  }
  return true
}

function validateNumber(
  value: unknown,
  path: string,
  issues: MissionValidationIssue[],
  min: number,
  max: number
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    addIssue(issues, path, `must be a finite number between ${min} and ${max}`)
    return false
  }
  return true
}

function validateStringList(
  value: unknown,
  path: string,
  issues: MissionValidationIssue[],
  options: { min: number; max: number; ids?: boolean }
): value is string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'must be an array')
    return false
  }
  if (value.length < options.min || value.length > options.max) {
    addIssue(issues, path, `must contain between ${options.min} and ${options.max} entries`)
  }
  const seen = new Set<string>()
  value.forEach((entry, index) => {
    const valid = options.ids
      ? validateId(entry, `${path}[${index}]`, issues)
      : validateString(entry, `${path}[${index}]`, issues, 1, 120)
    if (valid) {
      if (seen.has(entry)) addIssue(issues, `${path}[${index}]`, 'must be unique')
      seen.add(entry)
    }
  })
  return true
}

function validateOutcome(value: unknown, path: string, issues: MissionValidationIssue[]): void {
  const outcome = exactObject(value, path, ['id', 'title', 'description', 'tone'], issues)
  if (!outcome) return
  validateId(outcome.id, `${path}.id`, issues)
  validateString(outcome.title, `${path}.title`, issues, 1, 160)
  validateString(outcome.description, `${path}.description`, issues, 1, 1_000)
  if (!MISSION_OUTCOME_TONES.includes(outcome.tone as MissionOutcomeTone)) {
    addIssue(issues, `${path}.tone`, `must be one of ${MISSION_OUTCOME_TONES.join(', ')}`)
  }
}

function validateDecision(value: unknown, path: string, issues: MissionValidationIssue[]): void {
  const decision = exactObject(
    value,
    path,
    ['id', 'label', 'description', 'allowedRoleIds', 'score', 'nextCheckpointId', 'outcomes'],
    issues
  )
  if (!decision) return
  validateId(decision.id, `${path}.id`, issues)
  validateString(decision.label, `${path}.label`, issues, 1, 220)
  validateString(decision.description, `${path}.description`, issues, 1, 1_200)
  validateStringList(decision.allowedRoleIds, `${path}.allowedRoleIds`, issues, { min: 1, max: 16, ids: true })
  validateInteger(decision.score, `${path}.score`, issues, 0, 100)
  if (decision.nextCheckpointId !== null) validateId(decision.nextCheckpointId, `${path}.nextCheckpointId`, issues)
  if (!Array.isArray(decision.outcomes)) {
    addIssue(issues, `${path}.outcomes`, 'must be an array')
  } else {
    if (decision.outcomes.length < 1 || decision.outcomes.length > 12) {
      addIssue(issues, `${path}.outcomes`, 'must contain between 1 and 12 outcomes')
    }
    decision.outcomes.forEach((outcome, index) => validateOutcome(outcome, `${path}.outcomes[${index}]`, issues))
  }
}

function validateSyntheticEvent(value: unknown, path: string, issues: MissionValidationIssue[]): void {
  const event = exactObject(
    value,
    path,
    ['id', 'title', 'description', 'kind', 'source', 'offsetMs', 'probability', 'visibleToRoleIds', 'payload'],
    issues
  )
  if (!event) return
  validateId(event.id, `${path}.id`, issues)
  validateString(event.title, `${path}.title`, issues, 1, 160)
  validateString(event.description, `${path}.description`, issues, 1, 1_000)
  if (!MISSION_EVENT_KINDS.includes(event.kind as MissionSyntheticEventKind)) {
    addIssue(issues, `${path}.kind`, `must be one of ${MISSION_EVENT_KINDS.join(', ')}`)
  }
  if (event.source !== MISSION_REHEARSAL_SOURCE) {
    addIssue(issues, `${path}.source`, `must be ${MISSION_REHEARSAL_SOURCE}`)
  }
  validateInteger(event.offsetMs, `${path}.offsetMs`, issues, 0, 86_400_000)
  validateNumber(event.probability, `${path}.probability`, issues, 0, 1)
  validateStringList(event.visibleToRoleIds, `${path}.visibleToRoleIds`, issues, { min: 1, max: 16, ids: true })
  if (typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload)) {
    addIssue(issues, `${path}.payload`, 'must be an object of scalar synthetic values')
  } else {
    const entries = Object.entries(event.payload as Record<string, unknown>)
    if (entries.length > 32) addIssue(issues, `${path}.payload`, 'must contain no more than 32 fields')
    for (const [key, entry] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key)) {
        addIssue(issues, `${path}.payload.${key}`, 'uses an invalid payload key')
      }
      if (
        entry !== null &&
        typeof entry !== 'string' &&
        typeof entry !== 'boolean' &&
        (typeof entry !== 'number' || !Number.isFinite(entry))
      ) {
        addIssue(issues, `${path}.payload.${key}`, 'must be a string, finite number, boolean, or null')
      }
    }
  }
}

function validateCheckpoint(value: unknown, path: string, issues: MissionValidationIssue[]): void {
  const checkpoint = exactObject(
    value,
    path,
    ['id', 'title', 'briefing', 'expectedDecisionId', 'syntheticEvents', 'decisions'],
    issues
  )
  if (!checkpoint) return
  validateId(checkpoint.id, `${path}.id`, issues)
  validateString(checkpoint.title, `${path}.title`, issues, 1, 180)
  validateString(checkpoint.briefing, `${path}.briefing`, issues, 1, 2_000)
  validateId(checkpoint.expectedDecisionId, `${path}.expectedDecisionId`, issues)
  if (!Array.isArray(checkpoint.syntheticEvents)) {
    addIssue(issues, `${path}.syntheticEvents`, 'must be an array')
  } else {
    if (checkpoint.syntheticEvents.length > 50) {
      addIssue(issues, `${path}.syntheticEvents`, 'must contain no more than 50 events')
    }
    checkpoint.syntheticEvents.forEach((event, index) =>
      validateSyntheticEvent(event, `${path}.syntheticEvents[${index}]`, issues)
    )
  }
  if (!Array.isArray(checkpoint.decisions)) {
    addIssue(issues, `${path}.decisions`, 'must be an array')
  } else {
    if (checkpoint.decisions.length < 1 || checkpoint.decisions.length > 12) {
      addIssue(issues, `${path}.decisions`, 'must contain between 1 and 12 decisions')
    }
    checkpoint.decisions.forEach((decision, index) =>
      validateDecision(decision, `${path}.decisions[${index}]`, issues)
    )
  }
}

function missionManifestFileLength(manifest: MissionScenarioManifest): number {
  const base = {
    kind: MISSION_MANIFEST_FILE_KIND,
    schemaVersion: MISSION_REHEARSAL_SCHEMA_VERSION,
    exportedAt: new Date(0).toISOString(),
    manifest
  }
  const file: MissionManifestFile = {
    ...base,
    integrity: {
      algorithm: MISSION_INTEGRITY_ALGORITHM,
      checksum: 'fnv1a32:00000000'
    }
  }
  return `${JSON.stringify(file, null, 2)}\n`.length
}

function roleHasOnlyCompletableBranches(
  checkpoints: Map<string, MissionCheckpoint>,
  roleId: string,
  entryCheckpointId: string
): boolean {
  const memo = new Map<string, boolean>()
  const visit = (checkpointId: string, visiting: Set<string>): boolean => {
    const cached = memo.get(checkpointId)
    if (cached !== undefined) return cached
    if (visiting.has(checkpointId)) return false
    const checkpoint = checkpoints.get(checkpointId)
    if (!checkpoint) return false
    const nextVisiting = new Set(visiting)
    nextVisiting.add(checkpointId)
    const allowedDecisions = checkpoint.decisions.filter((decision) => decision.allowedRoleIds.includes(roleId))
    const completable = allowedDecisions.length > 0 && allowedDecisions.every((decision) => (
      decision.nextCheckpointId === null || visit(decision.nextCheckpointId, nextVisiting)
    ))
    memo.set(checkpointId, completable)
    return completable
  }
  return visit(entryCheckpointId, new Set())
}

function validateManifestRelations(manifest: MissionScenarioManifest, issues: MissionValidationIssue[]): void {
  const roleIds = new Set<string>()
  const rolePermissions = new Map<string, Set<MissionPermission>>()
  manifest.roles.forEach((role, roleIndex) => {
    if (roleIds.has(role.id)) addIssue(issues, `$.roles[${roleIndex}].id`, 'must be unique')
    roleIds.add(role.id)
    rolePermissions.set(role.id, new Set(role.permissions))
    if (new Set(role.permissions).size !== role.permissions.length) {
      addIssue(issues, `$.roles[${roleIndex}].permissions`, 'must not contain duplicates')
    }
  })

  const checkpoints = new Map<string, MissionCheckpoint>()
  manifest.checkpoints.forEach((checkpoint, checkpointIndex) => {
    if (checkpoints.has(checkpoint.id)) addIssue(issues, `$.checkpoints[${checkpointIndex}].id`, 'must be unique')
    checkpoints.set(checkpoint.id, checkpoint)

    const eventIds = new Set<string>()
    checkpoint.syntheticEvents.forEach((event, eventIndex) => {
      if (eventIds.has(event.id)) {
        addIssue(issues, `$.checkpoints[${checkpointIndex}].syntheticEvents[${eventIndex}].id`, 'must be unique in the checkpoint')
      }
      eventIds.add(event.id)
      event.visibleToRoleIds.forEach((roleId, roleRefIndex) => {
        if (!roleIds.has(roleId)) {
          addIssue(
            issues,
            `$.checkpoints[${checkpointIndex}].syntheticEvents[${eventIndex}].visibleToRoleIds[${roleRefIndex}]`,
            'references an unknown role'
          )
        }
      })
    })

    const decisionIds = new Set<string>()
    const outcomeIds = new Set<string>()
    checkpoint.decisions.forEach((decision, decisionIndex) => {
      if (decisionIds.has(decision.id)) {
        addIssue(issues, `$.checkpoints[${checkpointIndex}].decisions[${decisionIndex}].id`, 'must be unique in the checkpoint')
      }
      decisionIds.add(decision.id)
      decision.allowedRoleIds.forEach((roleId, roleRefIndex) => {
        if (!roleIds.has(roleId)) {
          addIssue(
            issues,
            `$.checkpoints[${checkpointIndex}].decisions[${decisionIndex}].allowedRoleIds[${roleRefIndex}]`,
            'references an unknown role'
          )
        } else if (!rolePermissions.get(roleId)?.has('decide')) {
          addIssue(
            issues,
            `$.checkpoints[${checkpointIndex}].decisions[${decisionIndex}].allowedRoleIds[${roleRefIndex}]`,
            'references a role without decide permission'
          )
        }
      })
      decision.outcomes.forEach((outcome, outcomeIndex) => {
        if (outcomeIds.has(outcome.id)) {
          addIssue(
            issues,
            `$.checkpoints[${checkpointIndex}].decisions[${decisionIndex}].outcomes[${outcomeIndex}].id`,
            'must be unique in the checkpoint'
          )
        }
        outcomeIds.add(outcome.id)
      })
    })

    const expected = checkpoint.decisions.find((decision) => decision.id === checkpoint.expectedDecisionId)
    if (!expected) {
      addIssue(issues, `$.checkpoints[${checkpointIndex}].expectedDecisionId`, 'must reference a decision in the checkpoint')
    } else {
      const maxScore = Math.max(...checkpoint.decisions.map((decision) => decision.score))
      if (expected.score !== maxScore) {
        addIssue(issues, `$.checkpoints[${checkpointIndex}].expectedDecisionId`, 'must identify a highest-scoring decision')
      }
    }
  })

  if (!checkpoints.has(manifest.entryCheckpointId)) {
    addIssue(issues, '$.entryCheckpointId', 'must reference a checkpoint')
    return
  }

  if (!manifest.roles.some((role) => role.permissions.includes('run'))) {
    addIssue(issues, '$.roles', 'must contain at least one runnable role')
  }

  manifest.roles.forEach((role, roleIndex) => {
    if (!role.permissions.includes('run')) return
    if (!role.permissions.includes('decide')) {
      addIssue(
        issues,
        `$.roles[${roleIndex}].permissions`,
        'run permission requires decide permission and a complete branch'
      )
      return
    }
    if (!roleHasOnlyCompletableBranches(checkpoints, role.id, manifest.entryCheckpointId)) {
      addIssue(
        issues,
        `$.roles[${roleIndex}].permissions`,
        'run permission requires every permitted branch to reach a terminal decision'
      )
    }
  })

  let terminalCount = 0
  manifest.checkpoints.forEach((checkpoint, checkpointIndex) => {
    checkpoint.decisions.forEach((decision, decisionIndex) => {
      if (decision.nextCheckpointId === null) {
        terminalCount += 1
      } else if (!checkpoints.has(decision.nextCheckpointId)) {
        addIssue(
          issues,
          `$.checkpoints[${checkpointIndex}].decisions[${decisionIndex}].nextCheckpointId`,
          'references an unknown checkpoint'
        )
      }
    })
  })
  if (terminalCount === 0) addIssue(issues, '$.checkpoints', 'must contain at least one terminal decision')

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const reachable = new Set<string>()
  const visit = (checkpointId: string): void => {
    if (visiting.has(checkpointId)) {
      addIssue(issues, `$.checkpoints.${checkpointId}`, 'branch graph must be acyclic')
      return
    }
    if (visited.has(checkpointId)) return
    visiting.add(checkpointId)
    reachable.add(checkpointId)
    const checkpoint = checkpoints.get(checkpointId)
    checkpoint?.decisions.forEach((decision) => {
      if (decision.nextCheckpointId && checkpoints.has(decision.nextCheckpointId)) visit(decision.nextCheckpointId)
    })
    visiting.delete(checkpointId)
    visited.add(checkpointId)
  }
  visit(manifest.entryCheckpointId)
  manifest.checkpoints.forEach((checkpoint, index) => {
    if (!reachable.has(checkpoint.id)) addIssue(issues, `$.checkpoints[${index}].id`, 'is unreachable from entryCheckpointId')
  })
}

export function validateMissionManifest(value: unknown): MissionValidationResult<MissionScenarioManifest> {
  const issues: MissionValidationIssue[] = []
  const manifest = exactObject(
    value,
    '$',
    ['schemaVersion', 'id', 'revision', 'title', 'description', 'objective', 'seed', 'tags', 'boundary', 'roles', 'entryCheckpointId', 'checkpoints'],
    issues
  )
  if (!manifest) return { ok: false, issues }

  if (manifest.schemaVersion !== MISSION_REHEARSAL_SCHEMA_VERSION) {
    addIssue(issues, '$.schemaVersion', `must equal ${MISSION_REHEARSAL_SCHEMA_VERSION}`)
  }
  validateId(manifest.id, '$.id', issues)
  validateInteger(manifest.revision, '$.revision', issues, 1, 1_000_000)
  validateString(manifest.title, '$.title', issues, 1, 180)
  validateString(manifest.description, '$.description', issues, 1, 2_000)
  validateString(manifest.objective, '$.objective', issues, 1, 2_000)
  validateInteger(manifest.seed, '$.seed', issues, 0, 0xffffffff)
  validateStringList(manifest.tags, '$.tags', issues, { min: 0, max: 24 })

  const boundary = exactObject(
    manifest.boundary,
    '$.boundary',
    ['mode', 'watermark', 'resetScope', 'syntheticDataPolicy'],
    issues
  )
  if (boundary) {
    if (boundary.mode !== 'offline-only') addIssue(issues, '$.boundary.mode', 'must be offline-only')
    if (boundary.watermark !== MISSION_TRAINING_WATERMARK) {
      addIssue(issues, '$.boundary.watermark', `must equal ${MISSION_TRAINING_WATERMARK}`)
    }
    if (boundary.resetScope !== 'mission-rehearsal-only') {
      addIssue(issues, '$.boundary.resetScope', 'must be mission-rehearsal-only')
    }
    if (boundary.syntheticDataPolicy !== 'never-write-live-telemetry-or-history') {
      addIssue(issues, '$.boundary.syntheticDataPolicy', 'must prohibit writes to live telemetry and history')
    }
  }

  if (!Array.isArray(manifest.roles)) {
    addIssue(issues, '$.roles', 'must be an array')
  } else {
    if (manifest.roles.length < 1 || manifest.roles.length > 16) {
      addIssue(issues, '$.roles', 'must contain between 1 and 16 roles')
    }
    manifest.roles.forEach((value, index) => {
      const role = exactObject(value, `$.roles[${index}]`, ['id', 'name', 'description', 'permissions'], issues)
      if (!role) return
      validateId(role.id, `$.roles[${index}].id`, issues)
      validateString(role.name, `$.roles[${index}].name`, issues, 1, 120)
      validateString(role.description, `$.roles[${index}].description`, issues, 1, 1_000)
      if (!Array.isArray(role.permissions)) {
        addIssue(issues, `$.roles[${index}].permissions`, 'must be an array')
      } else {
        if (role.permissions.length < 1 || role.permissions.length > MISSION_PERMISSIONS.length) {
          addIssue(issues, `$.roles[${index}].permissions`, 'contains an invalid number of permissions')
        }
        role.permissions.forEach((permission, permissionIndex) => {
          if (!MISSION_PERMISSIONS.includes(permission as MissionPermission)) {
            addIssue(
              issues,
              `$.roles[${index}].permissions[${permissionIndex}]`,
              `must be one of ${MISSION_PERMISSIONS.join(', ')}`
            )
          }
        })
      }
    })
  }

  validateId(manifest.entryCheckpointId, '$.entryCheckpointId', issues)
  if (!Array.isArray(manifest.checkpoints)) {
    addIssue(issues, '$.checkpoints', 'must be an array')
  } else {
    if (manifest.checkpoints.length < 1 || manifest.checkpoints.length > 100) {
      addIssue(issues, '$.checkpoints', 'must contain between 1 and 100 checkpoints')
    }
    manifest.checkpoints.forEach((checkpoint, index) =>
      validateCheckpoint(checkpoint, `$.checkpoints[${index}]`, issues)
    )
  }

  if (issues.length === 0) validateManifestRelations(value as MissionScenarioManifest, issues)
  if (issues.length === 0) {
    const serializedLength = missionManifestFileLength(value as MissionScenarioManifest)
    if (serializedLength > MISSION_MAX_IMPORT_CHARS) {
      addIssue(
        issues,
        '$',
        `serialized manifest file must contain no more than ${MISSION_MAX_IMPORT_CHARS} characters`
      )
    }
  }
  return issues.length === 0
    ? { ok: true, value: value as MissionScenarioManifest }
    : { ok: false, issues }
}

export function assertMissionManifest(value: unknown): MissionScenarioManifest {
  const result = validateMissionManifest(value)
  if (!result.ok) throw new MissionSchemaError('Mission rehearsal manifest is invalid.', result.issues)
  return result.value
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, stableValue(object[key])]))
  }
  return value
}

export function stableMissionStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

export function missionChecksum(value: unknown): string {
  const text = stableMissionStringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function missionManifestChecksum(manifest: MissionScenarioManifest): string {
  return missionChecksum(assertMissionManifest(manifest))
}

function integrityFor(value: unknown): MissionIntegrity {
  return { algorithm: MISSION_INTEGRITY_ALGORITHM, checksum: missionChecksum(value) }
}

function verifyIntegrity(value: unknown, integrity: MissionIntegrity, path: string): void {
  if (integrity.algorithm !== MISSION_INTEGRITY_ALGORITHM || !CHECKSUM_PATTERN.test(integrity.checksum)) {
    throw new MissionSchemaError('Mission rehearsal integrity metadata is invalid.', [
      { path, message: 'contains unsupported integrity metadata' }
    ])
  }
  if (missionChecksum(value) !== integrity.checksum) {
    throw new MissionSchemaError('Mission rehearsal file failed its integrity check.', [
      { path, message: 'checksum mismatch; the file is corrupt or was modified outside the authoring boundary' }
    ])
  }
}

function isoAt(now: number): string {
  return new Date(now).toISOString()
}

function parseJson(text: string, label: string): unknown {
  if (text.length > MISSION_MAX_IMPORT_CHARS) {
    throw new MissionSchemaError(`${label} is too large.`, [
      { path: '$', message: `must contain no more than ${MISSION_MAX_IMPORT_CHARS} characters` }
    ])
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new MissionSchemaError(`${label} is not valid JSON.`, [{ path: '$', message: 'invalid JSON' }])
  }
}

function assertImportableSerializedText(text: string, label: string): string {
  if (text.length > MISSION_MAX_IMPORT_CHARS) {
    throw new MissionSchemaError(`${label} is too large.`, [
      { path: '$', message: `must contain no more than ${MISSION_MAX_IMPORT_CHARS} characters` }
    ])
  }
  return text
}

function validateIsoDate(value: unknown, path: string, issues: MissionValidationIssue[]): value is string {
  if (!validateString(value, path, issues, 20, 40)) return false
  if (!Number.isFinite(Date.parse(value))) {
    addIssue(issues, path, 'must be an ISO-8601 timestamp')
    return false
  }
  return true
}

function validateIntegrity(value: unknown, path: string, issues: MissionValidationIssue[]): value is MissionIntegrity {
  const integrity = exactObject(value, path, ['algorithm', 'checksum'], issues)
  if (!integrity) return false
  if (integrity.algorithm !== MISSION_INTEGRITY_ALGORITHM) {
    addIssue(issues, `${path}.algorithm`, `must equal ${MISSION_INTEGRITY_ALGORITHM}`)
  }
  if (typeof integrity.checksum !== 'string' || !CHECKSUM_PATTERN.test(integrity.checksum)) {
    addIssue(issues, `${path}.checksum`, 'must be a valid fnv1a32 checksum')
  }
  return true
}

export function serializeMissionManifest(manifest: MissionScenarioManifest, now = Date.now()): string {
  const validManifest = assertMissionManifest(manifest)
  const base = {
    kind: MISSION_MANIFEST_FILE_KIND,
    schemaVersion: MISSION_REHEARSAL_SCHEMA_VERSION,
    exportedAt: isoAt(now),
    manifest: validManifest
  }
  const file: MissionManifestFile = { ...base, integrity: integrityFor(base) }
  return assertImportableSerializedText(
    `${JSON.stringify(file, null, 2)}\n`,
    'Mission rehearsal manifest'
  )
}

export function parseMissionManifestJson(text: string): MissionScenarioManifest {
  const value = parseJson(text, 'Mission rehearsal manifest')
  const issues: MissionValidationIssue[] = []
  const file = exactObject(value, '$', ['kind', 'schemaVersion', 'exportedAt', 'manifest', 'integrity'], issues)
  if (!file) throw new MissionSchemaError('Mission rehearsal manifest file is invalid.', issues)
  if (file.kind !== MISSION_MANIFEST_FILE_KIND) addIssue(issues, '$.kind', `must equal ${MISSION_MANIFEST_FILE_KIND}`)
  if (file.schemaVersion !== MISSION_REHEARSAL_SCHEMA_VERSION) {
    addIssue(issues, '$.schemaVersion', `must equal ${MISSION_REHEARSAL_SCHEMA_VERSION}`)
  }
  validateIsoDate(file.exportedAt, '$.exportedAt', issues)
  const manifestResult = validateMissionManifest(file.manifest)
  if (!manifestResult.ok) issues.push(...manifestResult.issues.map((issue) => ({ ...issue, path: `$.manifest${issue.path.slice(1)}` })))
  validateIntegrity(file.integrity, '$.integrity', issues)
  if (issues.length > 0) throw new MissionSchemaError('Mission rehearsal manifest file is invalid.', issues)
  const base = {
    kind: file.kind,
    schemaVersion: file.schemaVersion,
    exportedAt: file.exportedAt,
    manifest: file.manifest
  }
  verifyIntegrity(base, file.integrity as MissionIntegrity, '$.integrity')
  return file.manifest as MissionScenarioManifest
}

export function getMissionRole(manifest: MissionScenarioManifest, roleId: string): MissionRole {
  const role = manifest.roles.find((entry) => entry.id === roleId)
  if (!role) throw new Error(`Unknown mission rehearsal role: ${roleId}`)
  return role
}

export function getMissionCheckpoint(manifest: MissionScenarioManifest, checkpointId: string): MissionCheckpoint {
  const checkpoint = manifest.checkpoints.find((entry) => entry.id === checkpointId)
  if (!checkpoint) throw new Error(`Unknown mission rehearsal checkpoint: ${checkpointId}`)
  return checkpoint
}

export function canRoleSelectMissionDecision(
  manifest: MissionScenarioManifest,
  roleId: string,
  checkpointId: string,
  decisionId: string
): boolean {
  const role = manifest.roles.find((entry) => entry.id === roleId)
  const checkpoint = manifest.checkpoints.find((entry) => entry.id === checkpointId)
  const decision = checkpoint?.decisions.find((entry) => entry.id === decisionId)
  return Boolean(role?.permissions.includes('decide') && decision?.allowedRoleIds.includes(roleId))
}

export interface CreateMissionRunOptions {
  id?: string
  now?: number
}

export function createMissionRun(
  manifest: MissionScenarioManifest,
  roleId: string,
  options: CreateMissionRunOptions = {}
): MissionRun {
  const validManifest = assertMissionManifest(manifest)
  const role = getMissionRole(validManifest, roleId)
  if (!role.permissions.includes('run')) throw new Error(`Role ${roleId} cannot run mission rehearsals.`)
  const now = options.now ?? Date.now()
  const id = options.id ?? `run-${now.toString(36)}-${(validManifest.seed >>> 0).toString(36)}`
  if (!ID_PATTERN.test(id)) throw new Error('Mission run id is invalid.')
  return {
    schemaVersion: MISSION_REHEARSAL_RUN_SCHEMA_VERSION,
    id,
    source: MISSION_REHEARSAL_SOURCE,
    manifestId: validManifest.id,
    manifestRevision: validManifest.revision,
    manifestChecksum: missionManifestChecksum(validManifest),
    roleId,
    startedAt: now,
    updatedAt: now,
    status: 'in-progress',
    currentCheckpointId: validManifest.entryCheckpointId,
    steps: []
  }
}

function validateRunStructure(value: unknown, issues: MissionValidationIssue[]): value is MissionRun {
  const run = exactObject(
    value,
    '$.run',
    ['schemaVersion', 'id', 'source', 'manifestId', 'manifestRevision', 'manifestChecksum', 'roleId', 'startedAt', 'updatedAt', 'status', 'currentCheckpointId', 'steps'],
    issues
  )
  if (!run) return false
  if (run.schemaVersion !== MISSION_REHEARSAL_RUN_SCHEMA_VERSION) {
    addIssue(issues, '$.run.schemaVersion', `must equal ${MISSION_REHEARSAL_RUN_SCHEMA_VERSION}`)
  }
  validateId(run.id, '$.run.id', issues)
  if (run.source !== MISSION_REHEARSAL_SOURCE) addIssue(issues, '$.run.source', `must equal ${MISSION_REHEARSAL_SOURCE}`)
  validateId(run.manifestId, '$.run.manifestId', issues)
  validateInteger(run.manifestRevision, '$.run.manifestRevision', issues, 1, 1_000_000)
  if (typeof run.manifestChecksum !== 'string' || !CHECKSUM_PATTERN.test(run.manifestChecksum)) {
    addIssue(issues, '$.run.manifestChecksum', 'must be a valid manifest checksum')
  }
  validateId(run.roleId, '$.run.roleId', issues)
  validateInteger(run.startedAt, '$.run.startedAt', issues, 0, Number.MAX_SAFE_INTEGER)
  validateInteger(run.updatedAt, '$.run.updatedAt', issues, 0, Number.MAX_SAFE_INTEGER)
  if (run.status !== 'in-progress' && run.status !== 'completed') {
    addIssue(issues, '$.run.status', 'must be in-progress or completed')
  }
  if (run.currentCheckpointId !== null) validateId(run.currentCheckpointId, '$.run.currentCheckpointId', issues)
  if (!Array.isArray(run.steps)) {
    addIssue(issues, '$.run.steps', 'must be an array')
  } else {
    if (run.steps.length > 100) addIssue(issues, '$.run.steps', 'must contain no more than 100 steps')
    run.steps.forEach((stepValue, index) => {
      const step = exactObject(
        stepValue,
        `$.run.steps[${index}]`,
        ['checkpointId', 'decisionId', 'decidedByRoleId', 'decidedAt'],
        issues
      )
      if (!step) return
      validateId(step.checkpointId, `$.run.steps[${index}].checkpointId`, issues)
      validateId(step.decisionId, `$.run.steps[${index}].decisionId`, issues)
      validateId(step.decidedByRoleId, `$.run.steps[${index}].decidedByRoleId`, issues)
      validateInteger(step.decidedAt, `$.run.steps[${index}].decidedAt`, issues, 0, Number.MAX_SAFE_INTEGER)
    })
  }
  return true
}

function validateRunRelations(run: MissionRun, manifest: MissionScenarioManifest, issues: MissionValidationIssue[]): void {
  const checksum = missionManifestChecksum(manifest)
  if (run.manifestId !== manifest.id) addIssue(issues, '$.run.manifestId', 'does not match the active manifest')
  if (run.manifestRevision !== manifest.revision) addIssue(issues, '$.run.manifestRevision', 'does not match the active manifest')
  if (run.manifestChecksum !== checksum) addIssue(issues, '$.run.manifestChecksum', 'does not match the active manifest')
  const role = manifest.roles.find((entry) => entry.id === run.roleId)
  if (!role) {
    addIssue(issues, '$.run.roleId', 'references an unknown role')
    return
  }
  if (!role.permissions.includes('run')) addIssue(issues, '$.run.roleId', 'references a role without run permission')
  if (run.updatedAt < run.startedAt) addIssue(issues, '$.run.updatedAt', 'must not precede startedAt')

  let expectedCheckpointId: string | null = manifest.entryCheckpointId
  let previousTime = run.startedAt
  const visited = new Set<string>()
  run.steps.forEach((step, index) => {
    if (step.decidedAt < previousTime || step.decidedAt > run.updatedAt) {
      addIssue(issues, `$.run.steps[${index}].decidedAt`, 'must be monotonic and no later than updatedAt')
    }
    previousTime = step.decidedAt
    if (expectedCheckpointId === null) {
      addIssue(issues, `$.run.steps[${index}]`, 'appears after a terminal decision')
      return
    }
    if (step.checkpointId !== expectedCheckpointId) {
      addIssue(issues, `$.run.steps[${index}].checkpointId`, 'does not follow the deterministic branch')
      return
    }
    if (visited.has(step.checkpointId)) {
      addIssue(issues, `$.run.steps[${index}].checkpointId`, 'repeats a checkpoint')
      return
    }
    visited.add(step.checkpointId)
    if (step.decidedByRoleId !== run.roleId) {
      addIssue(issues, `$.run.steps[${index}].decidedByRoleId`, 'must match the selected run role')
    }
    const checkpoint = manifest.checkpoints.find((entry) => entry.id === step.checkpointId)
    const decision = checkpoint?.decisions.find((entry) => entry.id === step.decisionId)
    if (!decision) {
      addIssue(issues, `$.run.steps[${index}].decisionId`, 'does not exist at this checkpoint')
      return
    }
    if (!canRoleSelectMissionDecision(manifest, run.roleId, step.checkpointId, decision.id)) {
      addIssue(issues, `$.run.steps[${index}].decisionId`, 'is not permitted for the selected role')
    }
    expectedCheckpointId = decision.nextCheckpointId
  })

  const expectedStatus = expectedCheckpointId === null ? 'completed' : 'in-progress'
  if (run.status !== expectedStatus) addIssue(issues, '$.run.status', 'does not match the deterministic branch state')
  if (run.currentCheckpointId !== expectedCheckpointId) {
    addIssue(issues, '$.run.currentCheckpointId', 'does not match the deterministic branch state')
  }
}

export function validateMissionRun(value: unknown, manifest: MissionScenarioManifest): MissionValidationResult<MissionRun> {
  const issues: MissionValidationIssue[] = []
  const validManifest = assertMissionManifest(manifest)
  if (validateRunStructure(value, issues) && issues.length === 0) {
    validateRunRelations(value as MissionRun, validManifest, issues)
  }
  return issues.length === 0 ? { ok: true, value: value as MissionRun } : { ok: false, issues }
}

export function assertMissionRun(value: unknown, manifest: MissionScenarioManifest): MissionRun {
  const result = validateMissionRun(value, manifest)
  if (!result.ok) throw new MissionSchemaError('Mission rehearsal run is invalid.', result.issues)
  return result.value
}

export function advanceMissionRun(
  manifest: MissionScenarioManifest,
  run: MissionRun,
  decisionId: string,
  now = Date.now()
): MissionRun {
  const validRun = assertMissionRun(run, manifest)
  if (validRun.status === 'completed' || validRun.currentCheckpointId === null) {
    throw new Error('Mission rehearsal run is already complete.')
  }
  const checkpoint = getMissionCheckpoint(manifest, validRun.currentCheckpointId)
  const decision = checkpoint.decisions.find((entry) => entry.id === decisionId)
  if (!decision) throw new Error(`Unknown decision ${decisionId} at checkpoint ${checkpoint.id}.`)
  if (!canRoleSelectMissionDecision(manifest, validRun.roleId, checkpoint.id, decision.id)) {
    throw new Error(`Role ${validRun.roleId} is not permitted to select decision ${decision.id}.`)
  }
  const decidedAt = Math.max(now, validRun.updatedAt)
  const next: MissionRun = {
    ...validRun,
    updatedAt: decidedAt,
    status: decision.nextCheckpointId === null ? 'completed' : 'in-progress',
    currentCheckpointId: decision.nextCheckpointId,
    steps: [
      ...validRun.steps,
      {
        checkpointId: checkpoint.id,
        decisionId: decision.id,
        decidedByRoleId: validRun.roleId,
        decidedAt
      }
    ]
  }
  return assertMissionRun(next, manifest)
}

function missionRoll(seed: number, checkpointId: string, eventId: string): number {
  const checksum = missionChecksum(`${seed}:${checkpointId}:${eventId}`)
  return Number.parseInt(checksum.slice(-8), 16) / 0x100000000
}

function compareMissionIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function materializeMissionEvents(
  manifest: MissionScenarioManifest,
  checkpointId: string,
  roleId: string
): MissionSyntheticEvent[] {
  const validManifest = assertMissionManifest(manifest)
  getMissionRole(validManifest, roleId)
  const checkpoint = getMissionCheckpoint(validManifest, checkpointId)
  return checkpoint.syntheticEvents
    .filter((event) => event.visibleToRoleIds.includes(roleId))
    .filter((event) => event.probability >= 1 || missionRoll(validManifest.seed, checkpoint.id, event.id) < event.probability)
    .slice()
    .sort((left, right) => left.offsetMs - right.offsetMs || compareMissionIds(left.id, right.id))
}

export function scoreMissionRun(manifest: MissionScenarioManifest, run: MissionRun): MissionScore {
  const validRun = assertMissionRun(run, manifest)
  const checkpoints = validRun.steps.map((step): MissionCheckpointScore => {
    const checkpoint = getMissionCheckpoint(manifest, step.checkpointId)
    const selected = checkpoint.decisions.find((decision) => decision.id === step.decisionId)!
    const expected = checkpoint.decisions.find((decision) => decision.id === checkpoint.expectedDecisionId)!
    const maxPoints = Math.max(...checkpoint.decisions.map((decision) => decision.score))
    return {
      checkpointId: checkpoint.id,
      checkpointTitle: checkpoint.title,
      selectedDecisionId: selected.id,
      selectedDecisionLabel: selected.label,
      expectedDecisionId: expected.id,
      expectedDecisionLabel: expected.label,
      points: selected.score,
      maxPoints,
      aligned: selected.id === expected.id,
      selectedOutcomes: selected.outcomes,
      expectedOutcomes: expected.outcomes
    }
  })
  const points = checkpoints.reduce((total, checkpoint) => total + checkpoint.points, 0)
  const maxPoints = checkpoints.reduce((total, checkpoint) => total + checkpoint.maxPoints, 0)
  return {
    points,
    maxPoints,
    percent: maxPoints === 0 ? 100 : Math.round((points / maxPoints) * 100),
    completed: validRun.status === 'completed',
    checkpoints
  }
}

export const BLAMELESS_DEBRIEF_STATEMENT =
  'Scores describe this rehearsal path, not a person. Review cues, timing, shared context, and system design before individual performance.'

export function buildMissionDebrief(manifest: MissionScenarioManifest, run: MissionRun): MissionDebrief {
  const validRun = assertMissionRun(run, manifest)
  if (validRun.status !== 'completed') throw new Error('Complete the mission rehearsal before opening the debrief.')
  const score = scoreMissionRun(manifest, validRun)
  const checkpoints = score.checkpoints.map((checkpoint): MissionDebriefCheckpoint => ({
    ...checkpoint,
    review: checkpoint.aligned
      ? `The run aligned with the expected decision at “${checkpoint.checkpointTitle}”. Preserve the cues and closed-loop communication that made this choice available.`
      : `Rehearsal variance at “${checkpoint.checkpointTitle}”: the run selected “${checkpoint.selectedDecisionLabel}”; the expected decision was “${checkpoint.expectedDecisionLabel}”. Review cue timing, shared context, and process design—not individual fault.`
  }))
  return {
    score,
    blamelessStatement: BLAMELESS_DEBRIEF_STATEMENT,
    strengths: checkpoints.filter((checkpoint) => checkpoint.aligned).map((checkpoint) => checkpoint.checkpointTitle),
    reviewPrompts: checkpoints.filter((checkpoint) => !checkpoint.aligned).map((checkpoint) => checkpoint.review),
    checkpoints
  }
}

function scoreByCheckpoint(score: MissionScore): Map<string, MissionCheckpointScore> {
  return new Map(score.checkpoints.map((checkpoint) => [checkpoint.checkpointId, checkpoint]))
}

export function compareMissionRuns(
  manifest: MissionScenarioManifest,
  baselineRun: MissionRun,
  currentRun: MissionRun
): MissionRunComparison {
  const baseline = assertMissionRun(baselineRun, manifest)
  const current = assertMissionRun(currentRun, manifest)
  if (baseline.status !== 'completed' || current.status !== 'completed') {
    throw new Error('Repeat-run comparison requires two completed rehearsals.')
  }
  const baselineScore = scoreMissionRun(manifest, baseline)
  const currentScore = scoreMissionRun(manifest, current)
  const baselineByCheckpoint = scoreByCheckpoint(baselineScore)
  const currentByCheckpoint = scoreByCheckpoint(currentScore)
  const checkpointIds = Array.from(new Set([
    ...baselineScore.checkpoints.map((checkpoint) => checkpoint.checkpointId),
    ...currentScore.checkpoints.map((checkpoint) => checkpoint.checkpointId)
  ]))
  const checkpoints = checkpointIds.map((checkpointId): MissionRunComparisonCheckpoint => {
    const checkpoint = getMissionCheckpoint(manifest, checkpointId)
    const baselineCheckpoint = baselineByCheckpoint.get(checkpointId)
    const currentCheckpoint = currentByCheckpoint.get(checkpointId)
    return {
      checkpointId,
      checkpointTitle: checkpoint.title,
      baselineDecisionId: baselineCheckpoint?.selectedDecisionId ?? null,
      currentDecisionId: currentCheckpoint?.selectedDecisionId ?? null,
      baselineDecisionLabel: baselineCheckpoint?.selectedDecisionLabel ?? null,
      currentDecisionLabel: currentCheckpoint?.selectedDecisionLabel ?? null,
      decisionChanged: baselineCheckpoint?.selectedDecisionId !== currentCheckpoint?.selectedDecisionId,
      pointDelta: (currentCheckpoint?.points ?? 0) - (baselineCheckpoint?.points ?? 0)
    }
  })
  const matched = checkpoints.filter((checkpoint) => !checkpoint.decisionChanged).length
  return {
    baselineRunId: baseline.id,
    currentRunId: current.id,
    baselinePercent: baselineScore.percent,
    currentPercent: currentScore.percent,
    percentDelta: currentScore.percent - baselineScore.percent,
    scoreDelta: currentScore.points - baselineScore.points,
    consistencyPercent: checkpoints.length === 0 ? 100 : Math.round((matched / checkpoints.length) * 100),
    changedCheckpointIds: checkpoints.filter((checkpoint) => checkpoint.decisionChanged).map((checkpoint) => checkpoint.checkpointId),
    improvedCheckpointIds: checkpoints.filter((checkpoint) => checkpoint.pointDelta > 0).map((checkpoint) => checkpoint.checkpointId),
    regressedCheckpointIds: checkpoints.filter((checkpoint) => checkpoint.pointDelta < 0).map((checkpoint) => checkpoint.checkpointId),
    checkpoints
  }
}

export function serializeMissionRun(manifest: MissionScenarioManifest, run: MissionRun, now = Date.now()): string {
  const validRun = assertMissionRun(run, manifest)
  const base = {
    kind: MISSION_RUN_FILE_KIND,
    schemaVersion: MISSION_REHEARSAL_RUN_SCHEMA_VERSION,
    exportedAt: isoAt(now),
    run: validRun
  }
  const file: MissionRunFile = { ...base, integrity: integrityFor(base) }
  return assertImportableSerializedText(
    `${JSON.stringify(file, null, 2)}\n`,
    'Mission rehearsal run'
  )
}

export function parseMissionRunJson(text: string, manifest: MissionScenarioManifest): MissionRun {
  const value = parseJson(text, 'Mission rehearsal run')
  const issues: MissionValidationIssue[] = []
  const file = exactObject(value, '$', ['kind', 'schemaVersion', 'exportedAt', 'run', 'integrity'], issues)
  if (!file) throw new MissionSchemaError('Mission rehearsal run file is invalid.', issues)
  if (file.kind !== MISSION_RUN_FILE_KIND) addIssue(issues, '$.kind', `must equal ${MISSION_RUN_FILE_KIND}`)
  if (file.schemaVersion !== MISSION_REHEARSAL_RUN_SCHEMA_VERSION) {
    addIssue(issues, '$.schemaVersion', `must equal ${MISSION_REHEARSAL_RUN_SCHEMA_VERSION}`)
  }
  validateIsoDate(file.exportedAt, '$.exportedAt', issues)
  const runResult = validateMissionRun(file.run, manifest)
  if (!runResult.ok) issues.push(...runResult.issues)
  validateIntegrity(file.integrity, '$.integrity', issues)
  if (issues.length > 0) throw new MissionSchemaError('Mission rehearsal run file is invalid.', issues)
  const base = {
    kind: file.kind,
    schemaVersion: file.schemaVersion,
    exportedAt: file.exportedAt,
    run: file.run
  }
  verifyIntegrity(base, file.integrity as MissionIntegrity, '$.integrity')
  return file.run as MissionRun
}

export function serializeMissionRunHistory(
  manifest: MissionScenarioManifest,
  runs: MissionRun[],
  now = Date.now()
): string {
  const manifestChecksum = missionManifestChecksum(manifest)
  const validRuns = runs.map((run) => {
    const valid = assertMissionRun(run, manifest)
    if (valid.status !== 'completed') throw new Error('Only completed mission rehearsals may enter run history.')
    return valid
  })
  if (new Set(validRuns.map((run) => run.id)).size !== validRuns.length) {
    throw new Error('Mission rehearsal history contains duplicate run ids.')
  }
  let retainedRuns = validRuns.slice(-50)
  while (true) {
    const base = {
      kind: MISSION_HISTORY_FILE_KIND,
      schemaVersion: MISSION_REHEARSAL_RUN_SCHEMA_VERSION,
      exportedAt: isoAt(now),
      manifestId: manifest.id,
      manifestRevision: manifest.revision,
      manifestChecksum,
      runs: retainedRuns
    }
    const file: MissionRunHistoryFile = { ...base, integrity: integrityFor(base) }
    const text = `${JSON.stringify(file, null, 2)}\n`
    if (text.length <= MISSION_MAX_IMPORT_CHARS) return text
    if (retainedRuns.length <= 1) {
      return assertImportableSerializedText(text, 'Mission rehearsal run history')
    }
    retainedRuns = retainedRuns.slice(1)
  }
}

export function parseMissionRunHistoryJson(text: string, manifest: MissionScenarioManifest): MissionRun[] {
  const value = parseJson(text, 'Mission rehearsal run history')
  const issues: MissionValidationIssue[] = []
  const file = exactObject(
    value,
    '$',
    ['kind', 'schemaVersion', 'exportedAt', 'manifestId', 'manifestRevision', 'manifestChecksum', 'runs', 'integrity'],
    issues
  )
  if (!file) throw new MissionSchemaError('Mission rehearsal history file is invalid.', issues)
  if (file.kind !== MISSION_HISTORY_FILE_KIND) addIssue(issues, '$.kind', `must equal ${MISSION_HISTORY_FILE_KIND}`)
  if (file.schemaVersion !== MISSION_REHEARSAL_RUN_SCHEMA_VERSION) {
    addIssue(issues, '$.schemaVersion', `must equal ${MISSION_REHEARSAL_RUN_SCHEMA_VERSION}`)
  }
  validateIsoDate(file.exportedAt, '$.exportedAt', issues)
  if (file.manifestId !== manifest.id) addIssue(issues, '$.manifestId', 'does not match the active manifest')
  if (file.manifestRevision !== manifest.revision) addIssue(issues, '$.manifestRevision', 'does not match the active manifest')
  if (file.manifestChecksum !== missionManifestChecksum(manifest)) {
    addIssue(issues, '$.manifestChecksum', 'does not match the active manifest')
  }
  if (!Array.isArray(file.runs)) {
    addIssue(issues, '$.runs', 'must be an array')
  } else {
    if (file.runs.length > 50) addIssue(issues, '$.runs', 'must contain no more than 50 runs')
    const ids = new Set<string>()
    file.runs.forEach((run, index) => {
      const result = validateMissionRun(run, manifest)
      if (!result.ok) {
        issues.push(...result.issues.map((issue) => ({ ...issue, path: `$.runs[${index}]${issue.path.slice(5)}` })))
      } else {
        if (result.value.status !== 'completed') addIssue(issues, `$.runs[${index}].status`, 'must be completed')
        if (ids.has(result.value.id)) addIssue(issues, `$.runs[${index}].id`, 'must be unique')
        ids.add(result.value.id)
      }
    })
  }
  validateIntegrity(file.integrity, '$.integrity', issues)
  if (issues.length > 0) throw new MissionSchemaError('Mission rehearsal history file is invalid.', issues)
  const base = {
    kind: file.kind,
    schemaVersion: file.schemaVersion,
    exportedAt: file.exportedAt,
    manifestId: file.manifestId,
    manifestRevision: file.manifestRevision,
    manifestChecksum: file.manifestChecksum,
    runs: file.runs
  }
  verifyIntegrity(base, file.integrity as MissionIntegrity, '$.integrity')
  return file.runs as MissionRun[]
}
