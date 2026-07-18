import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { dialog, type IpcMainInvokeEvent } from 'electron'
import type { ModuleContext } from '../module-context'
import type { SetupCompareResult } from '../../shared/setup-manager'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  SETUP_EXPERIMENT_ARM_ORDER,
  SETUP_EXPERIMENT_CHANNELS,
  SETUP_EXPERIMENT_MIN_CLEAN_LAPS,
  SETUP_EXPERIMENT_SCHEMA_VERSION,
  analyzeSetupExperiment,
  assertSetupExperimentArmOrder,
  assertSetupExperimentDecision,
  compareSetupExperimentContexts,
  createSetupExperimentDefinition,
  emptySetupExperimentState,
  expectedSetupPathForTreatment,
  experimentProtocolPlan,
  nextSetupExperimentStep,
  normalizeSetupExperimentState,
  oneVariableFromSetupDiff,
  protocolSteps,
  recoverSetupExperimentStateAfterRestart,
  setupExperimentContextFromTelemetry,
  setupExperimentPortfolioMetrics,
  type AddSetupExperimentBlockInput,
  type CreateSetupExperimentInput,
  type RecordSetupExperimentDecisionInput,
  type SetupExperimentArm,
  type SetupExperimentComparability,
  type SetupExperimentDefinition,
  type SetupExperimentEnvironmentField,
  type SetupExperimentEnvironmentTolerances,
  type SetupExperimentExportBundle,
  type SetupExperimentLap,
  type SetupExperimentMutationInput,
  type SetupExperimentProtocolStep,
  type SetupExperimentRun,
  type SetupExperimentSequence,
  type SetupExperimentSnapshot,
  type SetupExperimentStorageIssue,
  type SetupExperimentStoredState,
  type StartSetupExperimentArmInput
} from '../../shared/setup-experiment'
import { compareSetups } from './setup-manager'

const STORE_FILE = 'setup-experiments.json'
const ENVIRONMENT_FIELDS = new Set<SetupExperimentEnvironmentField>([
  'trackWetnessPct',
  'trackTempC',
  'airTempC',
  'fuelMassKg',
  'tyreStatePct',
  'trafficDensity',
  'flagStateIndex',
  'damagePct',
  'gripPct'
])
const IDENTITY_FIELDS = new Set([
  'sim',
  'car',
  'track',
  'layout',
  'condition',
  'session',
  'sessionId'
])

export interface SetupExperimentPersistence {
  load(): Promise<SetupExperimentStoredState>
  save(state: SetupExperimentStoredState): Promise<void>
}

export interface SetupExperimentServiceDeps {
  persistence: SetupExperimentPersistence
  compare(leftPath: string, rightPath: string): Promise<SetupCompareResult>
  getTelemetry(): TelemetrySnapshot | null
  broadcast(snapshot: SetupExperimentSnapshot): void
  now?: () => number
  id?: () => string
}

interface PersistenceFs {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>
  readFile(path: string): Promise<Buffer>
  rename(oldPath: string, newPath: string): Promise<void>
  writeFile(path: string, data: string | Uint8Array, encoding?: BufferEncoding): Promise<void>
}

export interface JsonSetupExperimentPersistenceOptions {
  fs?: PersistenceFs
  now?: () => number
  id?: () => string
}

interface ActiveCapture {
  experimentId: string
  runId: string
  arm: SetupExperimentArm
  step: SetupExperimentProtocolStep
  previousLapNumber: number | null
  previousLapDistPct: number | null
  incidentBaseline: number | null
  lastFuelLiters: number | null
  lastFuelMassKg: number | null
  lastTyreStatePct: number | null
  hasSeenStartLine: boolean
  lapValiditySource: 'telemetry' | 'derived' | 'unknown'
  lapInvalidReasons: Set<string>
  closing: boolean
  pendingLaps: SetupExperimentLap[]
  flushingPending: boolean
  persistenceError?: string
}

interface CommitOptions {
  nextActive?: ActiveCapture | null
}

export class JsonSetupExperimentPersistence implements SetupExperimentPersistence {
  private readonly fs: PersistenceFs
  private readonly now: () => number
  private readonly id: () => string

  constructor(
    private readonly path: string,
    options: JsonSetupExperimentPersistenceOptions = {}
  ) {
    this.fs = options.fs ?? {
      mkdir,
      readFile: (target) => readFile(target),
      rename,
      writeFile
    }
    this.now = options.now ?? Date.now
    this.id = options.id ?? randomUUID
  }

  async load(): Promise<SetupExperimentStoredState> {
    let bytes: Buffer
    try {
      bytes = await this.fs.readFile(this.path)
    } catch (error) {
      const code = errorCode(error)
      if (code === 'ENOENT') return emptySetupExperimentState()
      return emptySetupExperimentState([{
        kind: 'unreadable-store',
        sourcePath: this.path,
        code,
        message: errorMessage(error)
      }])
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      return this.quarantine(bytes, 'INVALID_JSON', 'The setup experiment store contained invalid JSON.')
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== SETUP_EXPERIMENT_SCHEMA_VERSION) {
      return this.quarantine(bytes, 'SCHEMA_VERSION', 'The setup experiment store schema is unsupported.')
    }
    if (!validStoredState(parsed)) {
      return this.quarantine(bytes, 'INVALID_STRUCTURE', 'The setup experiment store structure is invalid.')
    }
    return normalizeSetupExperimentState(parsed as unknown as SetupExperimentStoredState)
  }

  async save(state: SetupExperimentStoredState): Promise<void> {
    await this.fs.mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    const serialized = `${JSON.stringify(state, null, 2)}\n`
    await this.fs.writeFile(temporaryPath, serialized, 'utf8')
    try {
      await this.fs.rename(temporaryPath, this.path)
    } catch (error) {
      const issue: SetupExperimentStorageIssue = {
        kind: 'recoverable',
        sourcePath: this.path,
        code: errorCode(error),
        message: errorMessage(error),
        quarantinePath: temporaryPath,
        checksum: createHash('sha256').update(serialized).digest('hex')
      }
      if (isRecord(error)) error.storageIssues = [issue]
      throw error
    }
  }

  private async quarantine(
    bytes: Buffer,
    code: string,
    message: string
  ): Promise<SetupExperimentStoredState> {
    const quarantinePath = `${this.path}.corrupt-${this.now()}-${this.id()}`
    try {
      await this.fs.rename(this.path, quarantinePath)
      return emptySetupExperimentState([{
        kind: 'corrupt-store',
        sourcePath: this.path,
        code,
        message,
        quarantineStatus: 'quarantined',
        quarantinePath,
        checksum: createHash('sha256').update(bytes).digest('hex')
      }])
    } catch (error) {
      return emptySetupExperimentState([{
        kind: 'corrupt-store',
        sourcePath: this.path,
        code: errorCode(error),
        message: `${message} Quarantine failed: ${errorMessage(error)}`,
        quarantineStatus: 'failed',
        quarantinePath,
        checksum: createHash('sha256').update(bytes).digest('hex')
      }])
    }
  }
}

export class SetupExperimentService {
  private state: SetupExperimentStoredState = emptySetupExperimentState()
  private active: ActiveCapture | null = null
  private initialized = false
  private readOnlyIssue: SetupExperimentStorageIssue | null = null
  private queueTail: Promise<void> = Promise.resolve()
  private readonly ready: Promise<void>

  constructor(private readonly deps: SetupExperimentServiceDeps) {
    this.ready = this.initialize()
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private id(): string {
    return this.deps.id?.() ?? randomUUID()
  }

  private async initialize(): Promise<void> {
    const loaded = normalizeSetupExperimentState(await this.deps.persistence.load())
    this.readOnlyIssue = blockingStorageIssue(loaded)
    const recovered = recoverSetupExperimentStateAfterRestart(loaded, this.now())
    this.state = normalizeSetupExperimentState(recovered.state)
    if (recovered.recovered && !this.readOnlyIssue) {
      const draft = clone(this.state)
      draft.revision = (loaded.revision ?? 0) + 1
      try {
        await this.deps.persistence.save(draft)
        this.state = draft
      } catch (error) {
        this.state.storageIssues = [
          ...(this.state.storageIssues ?? []),
          ...storageIssuesFromError(error, 'restart-recovery', 'Could not persist restart recovery.')
        ]
      }
    }
    this.initialized = true
  }

  async snapshot(): Promise<SetupExperimentSnapshot> {
    await this.ready
    await this.queueTail
    await this.drainPendingLaps()
    return this.buildSnapshot()
  }

  private buildSnapshot(): SetupExperimentSnapshot {
    return {
      state: clone(this.state),
      analyses: Object.fromEntries(
        this.state.experiments.map((experiment) => [experiment.id, analyzeSetupExperiment(experiment)])
      ),
      metrics: setupExperimentPortfolioMetrics(this.state.experiments),
      liveContext: setupExperimentContextFromTelemetry(this.deps.getTelemetry()),
      activeCapture: this.active
        ? {
            experimentId: this.active.experimentId,
            runId: this.active.runId,
            arm: this.active.arm,
            step: clone(this.active.step),
            pendingLapCount: this.active.pendingLaps.length,
            persistenceError: this.active.persistenceError
          }
        : null
    }
  }

  create(input: CreateSetupExperimentInput): Promise<SetupExperimentSnapshot> {
    return this.enqueue(async () => {
      if (!input || typeof input.baselinePath !== 'string' || typeof input.variantPath !== 'string') {
        throw new Error('Baseline and variant setup paths are required.')
      }
      if (samePath(input.baselinePath, input.variantPath)) {
        throw new Error('Baseline and variant setups must be different files.')
      }
      const comparison = await this.deps.compare(input.baselinePath, input.variantPath)
      const context = setupExperimentContextFromTelemetry(this.deps.getTelemetry())
      if (!context) throw new Error('Live telemetry is required to define a setup experiment.')
      const now = this.now()
      const experiment = createSetupExperimentDefinition({
        id: this.id(),
        name: input.name,
        now,
        baseline: comparison.left,
        variant: comparison.right,
        diff: comparison.diff,
        context,
        analysisPlan: input.analysisPlan,
        environmentTolerances: input.environmentTolerances,
        protocolPlan: input.protocolPlan
      })
      return this.commit((draft) => {
        draft.experiments.unshift(experiment)
      })
    })
  }

  delete(input: SetupExperimentMutationInput): Promise<SetupExperimentSnapshot> {
    return this.enqueue(async () => {
      const experiment = this.experiment(this.state, input?.experimentId)
      if (this.active?.experimentId === experiment.id) {
        throw new Error('Stop the active arm before deleting this experiment.')
      }
      return this.commit((draft) => {
        draft.experiments = draft.experiments.filter((candidate) => candidate.id !== experiment.id)
      })
    })
  }

  startArm(input: StartSetupExperimentArmInput): Promise<SetupExperimentSnapshot> {
    return this.enqueue(async () => {
      if (this.active) throw new Error('Another setup experiment arm is already recording.')
      if (
        !input ||
        typeof input.experimentId !== 'string' ||
        typeof input.confirmedSetupPath !== 'string' ||
        !SETUP_EXPERIMENT_ARM_ORDER.includes(input.arm)
      ) {
        throw new Error('Invalid setup experiment step request.')
      }

      const current = this.experiment(this.state, input.experimentId)
      let appendedBlock: { blockId: string; sequence: SetupExperimentSequence } | null = null
      let expected = nextSetupExperimentStep(current)
      if (!expected && validExplicitStep(input) && input.stepIndex !== 0) {
        throw new Error('Reopen order is invalid: a repeat block must start at step 0.')
      }
      if (!expected && validExplicitStep(input) && input.stepIndex === 0) {
        if (experimentProtocolPlan(current).some((block) => block.blockId === input.blockId)) {
          throw new Error('Reopen order is invalid: the declared block is already complete.')
        }
        appendedBlock = { blockId: input.blockId, sequence: input.sequence }
        expected = protocolSteps(appendedBlock)[0]
      }
      if (!expected) throw new Error('The declared protocol is complete. Add a repeat block first.')
      if (!appendedBlock) assertSetupExperimentArmOrder(current, expected)
      validateRequestedStep(input, expected)

      const expectedSetupPath = expectedSetupPathForTreatment(current, expected.treatment)
      if (!samePath(expectedSetupPath, input.confirmedSetupPath)) {
        throw new Error(
          `Protocol step ${expected.blockId}/${expected.stepIndex} requires the manually loaded ${expected.treatment === 'B' ? 'variant' : 'baseline'} setup.`
        )
      }
      const currentComparison = await this.deps.compare(
        current.baselineSetup.path,
        current.variantSetup.path
      )
      const currentVariable = oneVariableFromSetupDiff(currentComparison.diff)
      if (
        currentComparison.left.sizeBytes !== current.baselineSetup.sizeBytes ||
        currentComparison.left.modifiedAt !== current.baselineSetup.modifiedAt ||
        currentComparison.right.sizeBytes !== current.variantSetup.sizeBytes ||
        currentComparison.right.modifiedAt !== current.variantSetup.modifiedAt ||
        JSON.stringify(currentVariable) !== JSON.stringify(current.variable)
      ) {
        throw new Error('Setup files changed after this experiment was defined. Create a new frozen definition.')
      }

      const telemetry = this.deps.getTelemetry()
      const context = setupExperimentContextFromTelemetry(telemetry)
      const gate = compareSetupExperimentContexts(
        current.context,
        context,
        current.environmentTolerances
      )
      if (gate.status !== 'comparable') throw comparabilityError(gate)
      const now = this.now()
      const runId = this.id()
      const run: SetupExperimentRun = {
        id: runId,
        arm: expected.arm,
        setupPath: expectedSetupPath,
        status: 'recording',
        startedAt: now,
        startContext: context as NonNullable<typeof context>,
        laps: [],
        rejectionReasons: [],
        blockId: expected.blockId,
        sequence: expected.sequence,
        stepIndex: expected.stepIndex,
        treatment: expected.treatment
      }
      const lapDistPct = finite(telemetry?.lapDistPct)
      const nextActive: ActiveCapture = {
        experimentId: current.id,
        runId,
        arm: expected.arm,
        step: expected,
        previousLapNumber: finiteInteger(telemetry?.currentLap),
        previousLapDistPct: lapDistPct,
        incidentBaseline: incidentCount(telemetry),
        lastFuelLiters: finite(telemetry?.fuelLiters),
        lastFuelMassKg: finite(context?.fuelMassKg),
        lastTyreStatePct: finite(context?.tyreStatePct),
        hasSeenStartLine: lapDistPct !== null && lapDistPct <= 0.03,
        lapValiditySource: 'unknown',
        lapInvalidReasons: new Set(),
        closing: false,
        pendingLaps: [],
        flushingPending: false
      }
      observeLapSignals(nextActive, telemetry, current, gate)
      return this.commit((draft) => {
        const experiment = this.experiment(draft, current.id)
        if (appendedBlock) {
          experiment.protocolPlan = [...experimentProtocolPlan(experiment), appendedBlock]
          experiment.decision = null
        }
        experiment.runs.push(run)
        experiment.updatedAt = now
      }, { nextActive })
    })
  }

  finishArm(input: SetupExperimentMutationInput): Promise<SetupExperimentSnapshot> {
    return this.enqueue(async () => {
      const { experiment, run } = this.activeRun(this.state, input?.experimentId)
      if (this.active?.pendingLaps.length) {
        throw new Error('Arm cannot finish while lap evidence is pending persistence.')
      }
      const eligibleLaps = run.laps.filter((lap) => lap.eligible).length
      if (eligibleLaps < SETUP_EXPERIMENT_MIN_CLEAN_LAPS) {
        throw new Error(
          `Arm cannot finish: ${eligibleLaps}/${SETUP_EXPERIMENT_MIN_CLEAN_LAPS} eligible laps.`
        )
      }
      const now = this.now()
      return this.commit((draft) => {
        const current = this.experiment(draft, experiment.id)
        const currentRun = current.runs.find((candidate) => candidate.id === run.id)
        if (!currentRun || currentRun.status !== 'recording') {
          throw new Error('The active setup experiment run is unavailable.')
        }
        currentRun.status = 'completed'
        currentRun.completedAt = now
        current.updatedAt = now
      }, { nextActive: null })
    })
  }

  interruptArm(input: SetupExperimentMutationInput): Promise<SetupExperimentSnapshot> {
    return this.enqueue(async () => {
      const { experiment, run } = this.activeRun(this.state, input?.experimentId)
      if (this.active?.pendingLaps.length) {
        throw new Error('Arm cannot be interrupted while lap evidence is pending persistence.')
      }
      const now = this.now()
      return this.commit((draft) => {
        const current = this.experiment(draft, experiment.id)
        const currentRun = current.runs.find((candidate) => candidate.id === run.id)
        if (!currentRun) throw new Error('The active setup experiment run is unavailable.')
        currentRun.status = 'interrupted'
        currentRun.completedAt = now
        currentRun.rejectionReasons = Array.from(new Set([
          ...currentRun.rejectionReasons,
          'manual-interrupt'
        ]))
        current.updatedAt = now
      }, { nextActive: null })
    })
  }

  addBlock(input: AddSetupExperimentBlockInput): Promise<SetupExperimentSnapshot> {
    return this.enqueue(async () => {
      if (this.active) throw new Error('Stop the active arm before adding a repeat block.')
      if (!input || (input.sequence !== 'ABA' && input.sequence !== 'BAB')) {
        throw new Error('Unknown repeat-block sequence.')
      }
      const current = this.experiment(this.state, input.experimentId)
      if (nextSetupExperimentStep(current)) {
        throw new Error('Finish the declared block before adding a repeat.')
      }
      const blockId = `block-${String(experimentProtocolPlan(current).length + 1).padStart(3, '0')}`
      return this.commit((draft) => {
        const experiment = this.experiment(draft, current.id)
        experiment.protocolPlan = [
          ...experimentProtocolPlan(experiment),
          { blockId, sequence: input.sequence }
        ]
        experiment.decision = null
        experiment.updatedAt = this.now()
      })
    })
  }

  recordDecision(input: RecordSetupExperimentDecisionInput): Promise<SetupExperimentSnapshot> {
    return this.enqueue(async () => {
      if (
        !input ||
        typeof input.experimentId !== 'string' ||
        !['keep-variant', 'keep-baseline', 'abstain'].includes(input.disposition)
      ) {
        throw new Error('Unknown setup experiment disposition.')
      }
      const current = this.experiment(this.state, input.experimentId)
      if (nextSetupExperimentStep(current) !== null) {
        throw new Error('Complete the declared protocol before recording a decision.')
      }
      const analysis = analyzeSetupExperiment(current)
      assertSetupExperimentDecision(analysis, input.disposition)
      const now = this.now()
      return this.commit((draft) => {
        const experiment = this.experiment(draft, current.id)
        experiment.decision = {
          disposition: input.disposition,
          decidedAt: now,
          note: cleanNote(input.note)
        }
        experiment.updatedAt = now
      })
    })
  }

  async exportBundle(experimentId: string): Promise<SetupExperimentExportBundle> {
    await this.ready
    await this.queueTail
    const experiment = this.experiment(this.state, experimentId)
    return {
      schema: 'ultimate-sim-app.setup-experiment',
      schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
      exportedAt: this.now(),
      disclaimer: 'Local exploratory or confirmatory decision-support evidence only. No setup is applied automatically and no causal or optimal-setup claim is made.',
      experiment: clone(experiment),
      analysis: analyzeSetupExperiment(experiment),
      portfolioMetrics: setupExperimentPortfolioMetrics(this.state.experiments)
    }
  }

  onSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (!this.initialized || !this.active || this.active.closing) return
    const active = this.active
    if (active.pendingLaps.length > 0 && !active.flushingPending) {
      void this.flushPendingLaps(active).catch(() => {})
    }
    if (active.persistenceError) {
      return
    }
    const experiment = this.state.experiments.find((candidate) => candidate.id === active.experimentId)
    const run = experiment?.runs.find((candidate) => candidate.id === active.runId)
    if (!experiment || !run || run.status !== 'recording') {
      this.active = null
      return
    }

    const context = setupExperimentContextFromTelemetry(snapshot)
    const gate = compareSetupExperimentContexts(
      experiment.context,
      context,
      experiment.environmentTolerances
    )
    const identityIssues = gate.issues.filter((issue) => IDENTITY_FIELDS.has(issue.field))
    if (!context || identityIssues.length > 0) {
      active.closing = true
      const reason = !context
        ? 'telemetry-context-unknown'
        : `context-incomparable:${identityIssues.map((issue) => issue.field).join(',')}`
      void this.enqueue(async () => {
        const now = this.now()
        try {
          return await this.commit((draft) => {
            const current = this.experiment(draft, experiment.id)
            const currentRun = current.runs.find((candidate) => candidate.id === run.id)
            if (!currentRun || currentRun.status !== 'recording') return
            currentRun.status = context ? 'rejected' : 'interrupted'
            currentRun.completedAt = now
            currentRun.rejectionReasons = Array.from(new Set([
              ...currentRun.rejectionReasons,
              reason
            ]))
            current.updatedAt = now
          }, { nextActive: null })
        } catch (error) {
          if (this.active?.runId === active.runId) this.active.closing = false
          throw error
        }
      }).catch(() => {})
      return
    }

    observeLapSignals(active, snapshot, experiment, gate)
    const lapNumber = finiteInteger(snapshot?.currentLap)
    const lapDistPct = finite(snapshot?.lapDistPct)
    const crossedLine =
      (lapNumber !== null &&
        active.previousLapNumber !== null &&
        lapNumber > active.previousLapNumber) ||
      (lapDistPct !== null &&
        active.previousLapDistPct !== null &&
        lapDistPct < 0.08 &&
        active.previousLapDistPct > 0.92)

    if (crossedLine && snapshot && context) {
      const lap = this.captureLap(snapshot, context, lapComparability(gate))
      active.pendingLaps.push(lap)
      resetLapEvidence(active, snapshot)
      observeLapSignals(active, snapshot, experiment, gate)
      void this.flushPendingLaps(active).catch(() => {})
    }
    active.previousLapNumber = lapNumber ?? active.previousLapNumber
    active.previousLapDistPct = lapDistPct ?? active.previousLapDistPct
  }

  private captureLap(
    snapshot: TelemetrySnapshot,
    context: NonNullable<ReturnType<typeof setupExperimentContextFromTelemetry>>,
    gate: SetupExperimentComparability
  ): SetupExperimentLap {
    const active = this.active as ActiveCapture
    const completion = active.hasSeenStartLine ? 'complete' : 'partial'
    const lapTime = completion === 'complete' && finite(snapshot.lastLapTimeSec) !== null && snapshot.lastLapTimeSec! > 0
      ? snapshot.lastLapTimeSec!
      : null
    const currentIncidents = incidentCount(snapshot)
    const incidentDelta =
      currentIncidents !== null &&
      active.incidentBaseline !== null &&
      currentIncidents >= active.incidentBaseline
        ? currentIncidents - active.incidentBaseline
        : null
    const incidentState = incidentDelta === null ? 'unknown' : incidentDelta > 0 ? 'incident' : 'clean'
    const telemetryState = lapTime === null ? 'unknown' : 'known'
    const exclusionReasons = new Set(active.lapInvalidReasons)
    if (completion === 'partial') exclusionReasons.add('partial-lap')
    if (telemetryState === 'unknown') exclusionReasons.add('lap-time-unknown')
    if (incidentState === 'unknown') exclusionReasons.add('incidents-unknown')
    if (incidentState === 'incident') exclusionReasons.add('incident-lap')
    return {
      id: this.id(),
      arm: active.arm,
      capturedAt: this.now(),
      lapNumber: finiteInteger(snapshot.currentLap),
      lapTimeSec: lapTime,
      completion,
      incidentDelta,
      incidentState,
      telemetryState,
      validitySource: active.lapValiditySource,
      context,
      comparability: gate,
      eligible: exclusionReasons.size === 0,
      exclusionReasons: [...exclusionReasons],
      blockId: active.step.blockId,
      sequence: active.step.sequence,
      stepIndex: active.step.stepIndex,
      treatment: active.step.treatment
    }
  }

  private flushPendingLaps(active: ActiveCapture): Promise<void> {
      if (active.flushingPending || active.pendingLaps.length === 0) return Promise.resolve()
      active.flushingPending = true
      const batch = [...active.pendingLaps]
      const ids = new Set(batch.map((lap) => lap.id))
      const persist = () => this.commit((draft) => {
        const experiment = this.experiment(draft, active.experimentId)
        const run = experiment.runs.find((candidate) => candidate.id === active.runId)
        if (!run || run.status !== 'recording') {
          throw new Error('The active setup experiment run is unavailable.')
        }

        const existing = new Set(run.laps.map((lap) => lap.id))
        run.laps.push(...batch.filter((lap) => !existing.has(lap.id)))
        experiment.updatedAt = Math.max(
          experiment.updatedAt,
          ...batch.map((lap) => lap.capturedAt)
        )
      })
      return this.enqueue(async () => {
        try {
          await persist()
        } catch {
          try {
            await persist()
          } catch (error) {
            if (this.active?.runId === active.runId) {
              this.active.persistenceError = errorMessage(error)
              this.active.lapInvalidReasons.add('persistence-gap')
              this.deps.broadcast(this.buildSnapshot())
            }
            throw error
          }
        }
      }).then(() => {
        if (this.active?.runId !== active.runId) return
        this.active.pendingLaps = this.active.pendingLaps.filter((lap) => !ids.has(lap.id))
        this.active.persistenceError = undefined
        this.active.flushingPending = false
        if (this.active.pendingLaps.length > 0) {
          void this.flushPendingLaps(this.active).catch(() => {})
        }
      }).catch((error) => {
        if (this.active?.runId === active.runId) {
          this.active.flushingPending = false
        }
        throw error
      })
  }

  private async drainPendingLaps(): Promise<void> {
    while (
      this.active &&
      !this.active.persistenceError &&
      (this.active.flushingPending || this.active.pendingLaps.length > 0)
    ) {
      if (!this.active.flushingPending && this.active.pendingLaps.length > 0) {
        await this.flushPendingLaps(this.active).catch(() => {})
      } else {
        await this.queueTail
        await Promise.resolve()
      }
    }
  }

  private experiment(state: SetupExperimentStoredState, id: string | undefined): SetupExperimentDefinition {
    const experiment = state.experiments.find((candidate) => candidate.id === id)
    if (!experiment) throw new Error('Setup experiment not found.')
    return experiment
  }

  private activeRun(
    state: SetupExperimentStoredState,
    experimentId: string | undefined
  ): { experiment: SetupExperimentDefinition; run: SetupExperimentRun } {
    if (!this.active || this.active.experimentId !== experimentId) {
      throw new Error('This experiment has no active arm.')
    }
    const experiment = this.experiment(state, experimentId)
    const run = experiment.runs.find((candidate) => candidate.id === this.active?.runId)
    if (!run || run.status !== 'recording') {
      throw new Error('The active setup experiment run is unavailable.')
    }
    return { experiment, run }
  }

  private async commit(
    mutate: (draft: SetupExperimentStoredState) => void,
    options: CommitOptions = {}
  ): Promise<SetupExperimentSnapshot> {
    if (this.readOnlyIssue) {
      throw new Error(
        `Setup experiment store is read-only (${this.readOnlyIssue.code}): ${this.readOnlyIssue.sourcePath}`
      )
    }
    const draft = clone(this.state)
    mutate(draft)
    draft.revision = (this.state.revision ?? 0) + 1
    await this.deps.persistence.save(draft)
    this.state = draft
    if (Object.prototype.hasOwnProperty.call(options, 'nextActive')) {
      this.active = options.nextActive ?? null
    }
    const snapshot = this.buildSnapshot()
    this.deps.broadcast(snapshot)
    return snapshot
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queueTail.then(async () => {
      await this.ready
      return operation()
    })
    this.queueTail = run.then(() => undefined, () => undefined)
    return run
  }

  async dispose(): Promise<void> {
    await this.ready
    await this.queueTail
    if (this.active?.pendingLaps.length) {
      await this.flushPendingLaps(this.active)
    }
    await this.queueTail
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function finiteInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function incidentCount(snapshot: TelemetrySnapshot | null | undefined): number | null {
  return finite(snapshot?.incidentCountMy) ?? finite(snapshot?.incidentCount)
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase()
}

function cleanNote(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 1000)
    : ''
}

function comparabilityError(report: SetupExperimentComparability): Error {
  const fields = report.issues.map((issue) => issue.field).join(',') || 'unknown'
  return new Error(`Run rejected: context is ${report.status} (${fields}).`)
}

function lapComparability(
  report: SetupExperimentComparability
): SetupExperimentComparability {
  const issues = report.issues.filter((issue) =>
    !(
      issue.kind === 'mismatch' &&
      (issue.field === 'fuelMassKg' || issue.field === 'tyreStatePct')
    )
  )
  return {
    status: issues.some((issue) => issue.kind === 'mismatch')
      ? 'incomparable'
      : issues.length > 0
        ? 'unknown'
        : 'comparable',
    issues
  }
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 80)
  return cleaned || 'setup-experiment'
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'UNKNOWN'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function storageIssuesFromError(
  error: unknown,
  code: string,
  message: string
): SetupExperimentStorageIssue[] {
  if (isRecord(error) && Array.isArray(error.storageIssues)) {
    return error.storageIssues as SetupExperimentStorageIssue[]
  }
  return [{
    kind: 'recoverable',
    sourcePath: STORE_FILE,
    code: errorCode(error) === 'UNKNOWN' ? code : errorCode(error),
    message: `${message} ${errorMessage(error)}`
  }]
}

function blockingStorageIssue(
  state: SetupExperimentStoredState
): SetupExperimentStorageIssue | null {
  return state.storageIssues?.find((issue) =>
    issue.kind === 'unreadable-store' ||
    (issue.kind === 'corrupt-store' && issue.quarantineStatus === 'failed')
  ) ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validStoredState(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.experiments)) return false
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0)) {
    return false
  }
  return value.experiments.every(validExperiment)
}

function validExperiment(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    value.schemaVersion !== SETUP_EXPERIMENT_SCHEMA_VERSION ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !finiteNumber(value.createdAt) ||
    !finiteNumber(value.updatedAt) ||
    !validSetupRef(value.baselineSetup) ||
    !validSetupRef(value.variantSetup) ||
    !validVariable(value.variable) ||
    !validContext(value.context) ||
    value.minCleanLapsPerArm !== SETUP_EXPERIMENT_MIN_CLEAN_LAPS ||
    !Array.isArray(value.runs) ||
    !value.runs.every(validRun) ||
    !validDecision(value.decision)
  ) {
    return false
  }
  if (value.analysisPlan !== undefined && !validAnalysisPlan(value.analysisPlan)) return false
  if (value.environmentTolerances !== undefined && !validTolerances(value.environmentTolerances)) {
    return false
  }
  if (
    value.protocolPlan !== undefined &&
    (
      !Array.isArray(value.protocolPlan) ||
      !value.protocolPlan.every((block) =>
        isRecord(block) &&
        typeof block.blockId === 'string' &&
        (block.sequence === 'ABA' || block.sequence === 'BAB')
      )
    )
  ) {
    return false
  }
  return true
}

function validSetupRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.relativePath === 'string' &&
    finiteNumber(value.sizeBytes) &&
    finiteNumber(value.modifiedAt)
  )
}

function validVariable(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.section === 'string' &&
    typeof value.key === 'string' &&
    (value.kind === 'added' || value.kind === 'removed' || value.kind === 'changed') &&
    (value.before === null || typeof value.before === 'string') &&
    (value.after === null || typeof value.after === 'string')
  )
}

function validContext(value: unknown): boolean {
  if (!isRecord(value)) return false
  const nullableStrings = ['sim', 'car', 'carLabel', 'track', 'layout', 'session', 'sessionId']
  if (!nullableStrings.every((field) => value[field] === null || typeof value[field] === 'string')) {
    return false
  }
  if (
    !['telemetry', 'track-fallback', 'unknown'].includes(String(value.layoutSource)) ||
    !['dry', 'wet', 'unknown'].includes(String(value.condition))
  ) {
    return false
  }
  const nullableNumbers = [
    'trackWetnessPct',
    'trackTempC',
    'airTempC',
    'fuelMassKg',
    'tyreStatePct',
    'trafficDensity',
    'flagStateIndex',
    'damagePct',
    'gripPct'
  ]
  return nullableNumbers.every((field) =>
    value[field] === undefined || value[field] === null || finiteNumber(value[field])
  )
}

function validRun(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    !SETUP_EXPERIMENT_ARM_ORDER.includes(value.arm as SetupExperimentArm) ||
    typeof value.setupPath !== 'string' ||
    !['recording', 'completed', 'rejected', 'interrupted'].includes(String(value.status)) ||
    !finiteNumber(value.startedAt) ||
    (value.completedAt !== undefined && !finiteNumber(value.completedAt)) ||
    !validContext(value.startContext) ||
    !Array.isArray(value.laps) ||
    !value.laps.every(validLap) ||
    !Array.isArray(value.rejectionReasons) ||
    !value.rejectionReasons.every((reason) => typeof reason === 'string')
  ) {
    return false
  }
  return validOptionalProtocolMetadata(value)
}

function validLap(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    SETUP_EXPERIMENT_ARM_ORDER.includes(value.arm as SetupExperimentArm) &&
    finiteNumber(value.capturedAt) &&
    (value.lapNumber === null || Number.isSafeInteger(value.lapNumber)) &&
    (value.lapTimeSec === null || finiteNumber(value.lapTimeSec)) &&
    (value.completion === 'complete' || value.completion === 'partial') &&
    (value.incidentDelta === null || finiteNumber(value.incidentDelta)) &&
    ['clean', 'incident', 'unknown'].includes(String(value.incidentState)) &&
    ['known', 'unknown'].includes(String(value.telemetryState)) &&
    validContext(value.context) &&
    isRecord(value.comparability) &&
    ['comparable', 'incomparable', 'unknown'].includes(String(value.comparability.status)) &&
    Array.isArray(value.comparability.issues) &&
    typeof value.eligible === 'boolean' &&
    Array.isArray(value.exclusionReasons) &&
    value.exclusionReasons.every((reason) => typeof reason === 'string') &&
    validOptionalProtocolMetadata(value)
  )
}

function validOptionalProtocolMetadata(value: Record<string, unknown>): boolean {
  if (
    value.blockId === undefined &&
    value.sequence === undefined &&
    value.stepIndex === undefined &&
    value.treatment === undefined
  ) {
    return true
  }
  return (
    typeof value.blockId === 'string' &&
    (value.sequence === 'ABA' || value.sequence === 'BAB') &&
    Number.isSafeInteger(value.stepIndex) &&
    Number(value.stepIndex) >= 0 &&
    Number(value.stepIndex) <= 2 &&
    (value.treatment === 'A' || value.treatment === 'B')
  )
}

function validDecision(value: unknown): boolean {
  return value === null || (
    isRecord(value) &&
    ['keep-variant', 'keep-baseline', 'abstain'].includes(String(value.disposition)) &&
    finiteNumber(value.decidedAt) &&
    typeof value.note === 'string'
  )
}

function validAnalysisPlan(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.seed) &&
    Number.isSafeInteger(value.iterations) &&
    Number(value.iterations) >= 8 &&
    Number.isSafeInteger(value.lapBlockLength) &&
    Number(value.lapBlockLength) >= 1 &&
    Number.isSafeInteger(value.minimumIndependentBlocks) &&
    Number(value.minimumIndependentBlocks) >= 2 &&
    finiteNumber(value.maxRollbackDriftSec) &&
    Number(value.maxRollbackDriftSec) > 0
  )
}

function validTolerances(value: unknown): boolean {
  return isRecord(value) && [
    'trackWetnessPct',
    'trackTempC',
    'airTempC',
    'fuelMassKg',
    'tyreStatePct',
    'trafficDensity',
    'flagStateIndex',
    'damagePct',
    'gripPct'
  ].every((field) => finiteNumber(value[field]) && Number(value[field]) >= 0)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validExplicitStep(
  input: StartSetupExperimentArmInput
): input is StartSetupExperimentArmInput & {
  blockId: string
  sequence: SetupExperimentSequence
  stepIndex: number
  treatment: 'A' | 'B'
} {
  return (
    typeof input.blockId === 'string' &&
    (input.sequence === 'ABA' || input.sequence === 'BAB') &&
    Number.isSafeInteger(input.stepIndex) &&
    (input.treatment === 'A' || input.treatment === 'B')
  )
}

function validateRequestedStep(
  input: StartSetupExperimentArmInput,
  expected: SetupExperimentProtocolStep
): void {
  if (input.arm !== expected.arm) {
    throw new Error(`Protocol order violation: expected ${expected.arm}, received ${input.arm}.`)
  }
  const carriesMetadata =
    input.blockId !== undefined ||
    input.sequence !== undefined ||
    input.stepIndex !== undefined ||
    input.treatment !== undefined
  if (!carriesMetadata) return
  if (!validExplicitStep(input)) throw new Error('Incomplete protocol step metadata.')
  if (
    input.blockId !== expected.blockId ||
    input.sequence !== expected.sequence ||
    input.stepIndex !== expected.stepIndex ||
    input.treatment !== expected.treatment
  ) {
    throw new Error(
      `Protocol sequence violation: expected ${expected.blockId} ${expected.sequence} step ${expected.stepIndex}.`
    )
  }
}

function observeLapSignals(
  active: ActiveCapture,
  snapshot: TelemetrySnapshot | null,
  experiment: SetupExperimentDefinition,
  gate: SetupExperimentComparability
): void {
  for (const issue of gate.issues) {
    if (issue.field === 'condition' || ENVIRONMENT_FIELDS.has(issue.field as SetupExperimentEnvironmentField)) {
      if (
        issue.kind === 'mismatch' &&
        (issue.field === 'fuelMassKg' || issue.field === 'tyreStatePct')
      ) {
        continue
      }
      active.lapInvalidReasons.add(
        issue.kind === 'mismatch'
          ? `environment-tolerance:${issue.field}`
          : `environment-unknown:${issue.field}`
      )
    }
  }
  if (!snapshot) {
    active.lapInvalidReasons.add('telemetry-unknown')
    return
  }
  if (snapshot.onPitRoad === true) active.lapInvalidReasons.add('pit-road')
  else if (snapshot.onPitRoad !== false) active.lapInvalidReasons.add('pit-road-unknown')

  const inPitStall = snapshot.pit?.inPitStall
  if (snapshot.pitStopActive === true || inPitStall === true) {
    active.lapInvalidReasons.add('pit-stop')
  } else if (snapshot.pitStopActive === undefined && inPitStall === undefined) {
    active.lapInvalidReasons.add('pit-stop-unknown')
  }

  const fuelServiceFlag = snapshot.pitServiceFlags?.includes('fuel') === true
  const pitServiceActive = snapshot.pitStopActive === true || inPitStall === true
  if (
    snapshot.refuelServiceActive === true ||
    (pitServiceActive && (fuelServiceFlag || (finite(snapshot.pitFuelToAddL) ?? 0) > 0))
  ) {
    active.lapInvalidReasons.add('refuel')
  } else if (
    snapshot.refuelServiceActive !== false &&
    snapshot.pitStopActive === undefined &&
    inPitStall === undefined
  ) {
    active.lapInvalidReasons.add('refuel-unknown')
  }

  if (snapshot.onTrack === false) active.lapInvalidReasons.add('off-track')
  else if (snapshot.onTrack !== true) active.lapInvalidReasons.add('on-track-unknown')

  if (snapshot.towReset === true) {
    active.lapInvalidReasons.add('tow-reset')
  } else if (snapshot.towReset !== false) {
    const lap = finiteInteger(snapshot.currentLap)
    const distance = finite(snapshot.lapDistPct)
    const crossedLine = Boolean(
      distance !== null &&
      active.previousLapDistPct !== null &&
      distance < 0.08 &&
      active.previousLapDistPct > 0.92
    )
    if (
      lap === null ||
      distance === null ||
      active.previousLapNumber === null ||
      active.previousLapDistPct === null
    ) {
      active.lapInvalidReasons.add('tow-reset-unknown')
    } else if (
      lap < active.previousLapNumber ||
      (
        lap === active.previousLapNumber &&
        distance + 0.2 < active.previousLapDistPct &&
        !crossedLine
      )
    ) {
      active.lapInvalidReasons.add('tow-reset')
    }
  }

  if (snapshot.lapValidity === 'invalid') {
    active.lapInvalidReasons.add('lap-invalid')
    active.lapValiditySource = 'telemetry'
  } else if (snapshot.lapValidity === 'valid') {
    active.lapValiditySource = 'telemetry'
  } else if (snapshot.lapValidity === 'unknown' || snapshot.lapValidity === null) {
    active.lapInvalidReasons.add('lap-validity-unknown')
    active.lapValiditySource = 'unknown'
  } else {
    active.lapValiditySource = 'derived'
  }

  const fuel = finite(snapshot.fuelLiters)
  if (fuel === null) {
    active.lapInvalidReasons.add('fuel-unknown')
  } else {
    if (active.lastFuelLiters !== null && fuel > active.lastFuelLiters + 0.05) {
      active.lapInvalidReasons.add('fuel-discontinuity')
    }
    active.lastFuelLiters = fuel
  }

  const fuelMass = finite(snapshot.fuelMassKg)
  if (fuelMass === null) {
    active.lapInvalidReasons.add('environment-unknown:fuelMassKg')
  } else {
    if (active.lastFuelMassKg !== null && fuelMass > active.lastFuelMassKg + 0.01) {
      active.lapInvalidReasons.add('fuel-discontinuity')
    }
    active.lastFuelMassKg = fuelMass
  }

  const tyreState = finite(snapshot.tyreStatePct)
  if (tyreState === null) {
    active.lapInvalidReasons.add('environment-unknown:tyreStatePct')
  } else {
    if (active.lastTyreStatePct !== null && tyreState > active.lastTyreStatePct + 0.001) {
      active.lapInvalidReasons.add('tyre-discontinuity')
    }
    active.lastTyreStatePct = tyreState
  }
  void experiment
}

function resetLapEvidence(active: ActiveCapture, snapshot: TelemetrySnapshot): void {
  active.hasSeenStartLine = true
  active.incidentBaseline = incidentCount(snapshot)
  active.lastFuelLiters = finite(snapshot.fuelLiters)
  active.lastFuelMassKg = finite(snapshot.fuelMassKg)
  active.lastTyreStatePct = finite(snapshot.tyreStatePct)
  active.lapValiditySource = 'unknown'
  active.lapInvalidReasons = new Set()
}

export function authorizeSetupExperimentSender(ctx: ModuleContext, event: IpcMainInvokeEvent): void {
  const mainWindow = ctx.getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('Setup Experiment IPC sender is not authorized.')
  }
}

export function register(ctx: ModuleContext): void {
  const persistence = new JsonSetupExperimentPersistence(
    join(ctx.app.getPath('userData'), STORE_FILE)
  )
  const service = new SetupExperimentService({
    persistence,
    compare: (leftPath, rightPath) => compareSetups(ctx, { leftPath, rightPath }),
    getTelemetry: () => ctx.telemetryHub.getLatest(),
    broadcast: (snapshot) => ctx.broadcast(SETUP_EXPERIMENT_CHANNELS.updated, snapshot)
  })
  const onSnapshot = (snapshot: TelemetrySnapshot | null): void => service.onSnapshot(snapshot)
  ctx.telemetryHub.on('snapshot', onSnapshot)

  ctx.ipcMain.handle(SETUP_EXPERIMENT_CHANNELS.getSnapshot, async (event) => {
    authorizeSetupExperimentSender(ctx, event)
    return service.snapshot()
  })
  ctx.ipcMain.handle(SETUP_EXPERIMENT_CHANNELS.create, async (event, input: CreateSetupExperimentInput) => {
    authorizeSetupExperimentSender(ctx, event)
    return service.create(input)
  })
  ctx.ipcMain.handle(SETUP_EXPERIMENT_CHANNELS.delete, async (event, input: SetupExperimentMutationInput) => {
    authorizeSetupExperimentSender(ctx, event)
    return service.delete(input)
  })
  ctx.ipcMain.handle(SETUP_EXPERIMENT_CHANNELS.startArm, async (event, input: StartSetupExperimentArmInput) => {
    authorizeSetupExperimentSender(ctx, event)
    return service.startArm(input)
  })
  ctx.ipcMain.handle(SETUP_EXPERIMENT_CHANNELS.finishArm, async (event, input: SetupExperimentMutationInput) => {
    authorizeSetupExperimentSender(ctx, event)
    return service.finishArm(input)
  })
  ctx.ipcMain.handle(SETUP_EXPERIMENT_CHANNELS.interruptArm, async (event, input: SetupExperimentMutationInput) => {
    authorizeSetupExperimentSender(ctx, event)
    return service.interruptArm(input)
  })
  ctx.ipcMain.handle(SETUP_EXPERIMENT_CHANNELS.addBlock, async (event, input: AddSetupExperimentBlockInput) => {
    authorizeSetupExperimentSender(ctx, event)
    return service.addBlock(input)
  })
  ctx.ipcMain.handle(
    SETUP_EXPERIMENT_CHANNELS.recordDecision,
    async (event, input: RecordSetupExperimentDecisionInput) => {
      authorizeSetupExperimentSender(ctx, event)
      return service.recordDecision(input)
    }
  )
  ctx.ipcMain.handle(SETUP_EXPERIMENT_CHANNELS.export, async (event, input: SetupExperimentMutationInput) => {
    authorizeSetupExperimentSender(ctx, event)
    const bundle = await service.exportBundle(input?.experimentId)
    const serialized = `${JSON.stringify(bundle, null, 2)}\n`
    const packageHash = createHash('sha256').update(serialized).digest('hex')
    const owner = ctx.getMainWindow()
    const options = {
      title: 'Export Setup Experiment Twin',
      defaultPath: `${safeFileName(bundle.experiment.name)}.setup-experiment.json`,
      filters: [{ name: 'Setup Experiment JSON', extensions: ['json'] }]
    }
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    await writeFile(result.filePath, serialized, 'utf8')
    return {
      ok: true,
      canceled: false,
      fileName: basename(result.filePath),
      packageHash
    }
  })

  ctx.registerGracefulTeardown(async () => {
    ctx.telemetryHub.off('snapshot', onSnapshot)
    await service.dispose()
  }, 'persistence')
}
