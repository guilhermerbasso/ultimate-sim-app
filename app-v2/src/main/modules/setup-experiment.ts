import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { dialog, type IpcMainInvokeEvent } from 'electron'
import type { ModuleContext } from '../module-context'
import type { SetupCompareResult } from '../../shared/setup-manager'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import {
  SETUP_EXPERIMENT_ARM_ORDER,
  SETUP_EXPERIMENT_CHANNELS,
  SETUP_EXPERIMENT_SCHEMA_VERSION,
  analyzeSetupExperiment,
  assertSetupExperimentArmOrder,
  assertSetupExperimentDecision,
  compareSetupExperimentContexts,
  createSetupExperimentDefinition,
  emptySetupExperimentState,
  expectedSetupPathForArm,
  nextSetupExperimentArm,
  oneVariableFromSetupDiff,
  recoverSetupExperimentStateAfterRestart,
  setupExperimentContextFromTelemetry,
  setupExperimentPortfolioMetrics,
  type CreateSetupExperimentInput,
  type RecordSetupExperimentDecisionInput,
  type SetupExperimentArm,
  type SetupExperimentDefinition,
  type SetupExperimentExportBundle,
  type SetupExperimentLap,
  type SetupExperimentMutationInput,
  type SetupExperimentRun,
  type SetupExperimentSnapshot,
  type SetupExperimentStoredState,
  type StartSetupExperimentArmInput
} from '../../shared/setup-experiment'
import { compareSetups } from './setup-manager'

const STORE_FILE = 'setup-experiments.json'

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

interface ActiveCapture {
  experimentId: string
  runId: string
  arm: SetupExperimentArm
  previousLapNumber: number | null
  previousLapDistPct: number | null
  incidentBaseline: number | null
  hasSeenStartLine: boolean
}

export class JsonSetupExperimentPersistence implements SetupExperimentPersistence {
  constructor(private readonly path: string) {}

  async load(): Promise<SetupExperimentStoredState> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<SetupExperimentStoredState>
      if (parsed.schemaVersion !== SETUP_EXPERIMENT_SCHEMA_VERSION || !Array.isArray(parsed.experiments)) {
        return emptySetupExperimentState()
      }
      return {
        schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
        experiments: parsed.experiments as SetupExperimentDefinition[]
      }
    } catch {
      return emptySetupExperimentState()
    }
  }

  async save(state: SetupExperimentStoredState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.path).catch(async () => {
      await writeFile(this.path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    })
  }
}

export class SetupExperimentService {
  private state: SetupExperimentStoredState = emptySetupExperimentState()
  private active: ActiveCapture | null = null
  private initialized = false
  private saveQueue: Promise<void> = Promise.resolve()
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
    const loaded = await this.deps.persistence.load()
    const recovered = recoverSetupExperimentStateAfterRestart(loaded, this.now())
    this.state = recovered.state
    this.initialized = true
    if (recovered.recovered) await this.persist()
  }

  async snapshot(): Promise<SetupExperimentSnapshot> {
    await this.ready
    await this.saveQueue
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
            arm: this.active.arm
          }
        : null
    }
  }

  async create(input: CreateSetupExperimentInput): Promise<SetupExperimentSnapshot> {
    await this.ready
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
      context
    })
    this.state.experiments.unshift(experiment)
    await this.changed()
    return this.buildSnapshot()
  }

  async delete(input: SetupExperimentMutationInput): Promise<SetupExperimentSnapshot> {
    await this.ready
    const experiment = this.experiment(input?.experimentId)
    if (this.active?.experimentId === experiment.id) throw new Error('Stop the active arm before deleting this experiment.')
    this.state.experiments = this.state.experiments.filter((candidate) => candidate.id !== experiment.id)
    await this.changed()
    return this.buildSnapshot()
  }

  async startArm(input: StartSetupExperimentArmInput): Promise<SetupExperimentSnapshot> {
    await this.ready
    if (this.active) throw new Error('Another setup experiment arm is already recording.')
    if (
      !input ||
      typeof input.experimentId !== 'string' ||
      typeof input.confirmedSetupPath !== 'string' ||
      !SETUP_EXPERIMENT_ARM_ORDER.includes(input.arm)
    ) {
      throw new Error('Invalid A-B-A arm request.')
    }
    const experiment = this.experiment(input.experimentId)
    assertSetupExperimentArmOrder(experiment, input.arm)
    const expectedSetupPath = expectedSetupPathForArm(experiment, input.arm)
    if (!samePath(expectedSetupPath, input.confirmedSetupPath)) {
      throw new Error(`Arm ${input.arm} requires the manually loaded ${input.arm === 'B' ? 'variant' : 'baseline'} setup.`)
    }
    const currentComparison = await this.deps.compare(
      experiment.baselineSetup.path,
      experiment.variantSetup.path
    )
    const currentVariable = oneVariableFromSetupDiff(currentComparison.diff)
    if (
      currentComparison.left.sizeBytes !== experiment.baselineSetup.sizeBytes ||
      currentComparison.left.modifiedAt !== experiment.baselineSetup.modifiedAt ||
      currentComparison.right.sizeBytes !== experiment.variantSetup.sizeBytes ||
      currentComparison.right.modifiedAt !== experiment.variantSetup.modifiedAt ||
      JSON.stringify(currentVariable) !== JSON.stringify(experiment.variable)
    ) {
      throw new Error('Setup files changed after this experiment was defined. Create a new frozen definition.')
    }
    const telemetry = this.deps.getTelemetry()
    const context = setupExperimentContextFromTelemetry(telemetry)
    const gate = compareSetupExperimentContexts(experiment.context, context)
    if (gate.status !== 'comparable') throw comparabilityError(gate)

    const now = this.now()
    const run: SetupExperimentRun = {
      id: this.id(),
      arm: input.arm,
      setupPath: expectedSetupPath,
      status: 'recording',
      startedAt: now,
      startContext: context as NonNullable<typeof context>,
      laps: [],
      rejectionReasons: []
    }
    experiment.runs.push(run)
    experiment.updatedAt = now
    const lapDistPct = finite(telemetry?.lapDistPct)
    this.active = {
      experimentId: experiment.id,
      runId: run.id,
      arm: run.arm,
      previousLapNumber: finiteInteger(telemetry?.currentLap),
      previousLapDistPct: lapDistPct,
      incidentBaseline: incidentCount(telemetry),
      hasSeenStartLine: lapDistPct !== null && lapDistPct <= 0.03
    }
    await this.changed()
    return this.buildSnapshot()
  }

  async finishArm(input: SetupExperimentMutationInput): Promise<SetupExperimentSnapshot> {
    await this.ready
    const { experiment, run } = this.activeRun(input?.experimentId)
    const context = setupExperimentContextFromTelemetry(this.deps.getTelemetry())
    const gate = compareSetupExperimentContexts(experiment.context, context)
    if (gate.status !== 'comparable') {
      this.rejectActiveRun(gate.status === 'incomparable' ? 'context-incomparable' : 'context-unknown')
      await this.changed()
      throw comparabilityError(gate)
    }
    const now = this.now()
    run.status = 'completed'
    run.completedAt = now
    experiment.updatedAt = now
    this.active = null
    await this.changed()
    return this.buildSnapshot()
  }

  async interruptArm(input: SetupExperimentMutationInput): Promise<SetupExperimentSnapshot> {
    await this.ready
    this.activeRun(input?.experimentId)
    this.rejectActiveRun('manual-interrupt', 'interrupted')
    await this.changed()
    return this.buildSnapshot()
  }

  async recordDecision(input: RecordSetupExperimentDecisionInput): Promise<SetupExperimentSnapshot> {
    await this.ready
    if (
      !input ||
      typeof input.experimentId !== 'string' ||
      !['keep-variant', 'keep-baseline', 'abstain'].includes(input.disposition)
    ) {
      throw new Error('Unknown setup experiment disposition.')
    }
    const experiment = this.experiment(input.experimentId)
    if (nextSetupExperimentArm(experiment) !== null) throw new Error('Complete the A-B-A protocol before recording a decision.')
    const analysis = analyzeSetupExperiment(experiment)
    assertSetupExperimentDecision(analysis, input.disposition)
    experiment.decision = {
      disposition: input.disposition,
      decidedAt: this.now(),
      note: cleanNote(input.note)
    }
    experiment.updatedAt = experiment.decision.decidedAt
    await this.changed()
    return this.buildSnapshot()
  }

  async exportBundle(experimentId: string): Promise<SetupExperimentExportBundle> {
    await this.ready
    await this.saveQueue
    const experiment = this.experiment(experimentId)
    return {
      schema: 'ultimate-sim-app.setup-experiment',
      schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
      exportedAt: this.now(),
      disclaimer: 'Local decision-support evidence only. No setup is applied automatically and no causal or optimal-setup claim is made.',
      experiment: clone(experiment),
      analysis: analyzeSetupExperiment(experiment),
      portfolioMetrics: setupExperimentPortfolioMetrics(this.state.experiments)
    }
  }

  onSnapshot(snapshot: TelemetrySnapshot | null): void {
    if (!this.initialized || !this.active) return
    const experiment = this.state.experiments.find((candidate) => candidate.id === this.active?.experimentId)
    const run = experiment?.runs.find((candidate) => candidate.id === this.active?.runId)
    if (!experiment || !run || run.status !== 'recording') {
      this.active = null
      return
    }
    const context = setupExperimentContextFromTelemetry(snapshot)
    const gate = compareSetupExperimentContexts(experiment.context, context)
    if (gate.status !== 'comparable') {
      this.rejectActiveRun(
        gate.status === 'incomparable' ? `context-incomparable:${issueFields(gate)}` : `context-unknown:${issueFields(gate)}`,
        context ? 'rejected' : 'interrupted'
      )
      void this.changed().catch(() => {})
      return
    }

    const lapNumber = finiteInteger(snapshot?.currentLap)
    const lapDistPct = finite(snapshot?.lapDistPct)
    const crossedLine =
      (lapNumber !== null &&
        this.active.previousLapNumber !== null &&
        lapNumber > this.active.previousLapNumber) ||
      (lapDistPct !== null &&
        this.active.previousLapDistPct !== null &&
        lapDistPct < 0.08 &&
        this.active.previousLapDistPct > 0.92)

    if (crossedLine) {
      const lap = this.captureLap(snapshot as TelemetrySnapshot, context as NonNullable<typeof context>, gate)
      run.laps.push(lap)
      experiment.updatedAt = lap.capturedAt
      void this.changed().catch(() => {})
    }
    this.active.previousLapNumber = lapNumber ?? this.active.previousLapNumber
    this.active.previousLapDistPct = lapDistPct ?? this.active.previousLapDistPct
  }

  private captureLap(
    snapshot: TelemetrySnapshot,
    context: NonNullable<ReturnType<typeof setupExperimentContextFromTelemetry>>,
    gate: ReturnType<typeof compareSetupExperimentContexts>
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
    const exclusionReasons: string[] = []
    if (completion === 'partial') exclusionReasons.push('partial-lap')
    if (telemetryState === 'unknown') exclusionReasons.push('lap-time-unknown')
    if (incidentState === 'unknown') exclusionReasons.push('incidents-unknown')
    if (incidentState === 'incident') exclusionReasons.push('incident-lap')
    if (gate.status !== 'comparable') exclusionReasons.push(`context-${gate.status}`)
    active.hasSeenStartLine = true
    active.incidentBaseline = currentIncidents
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
      context,
      comparability: gate,
      eligible:
        completion === 'complete' &&
        telemetryState === 'known' &&
        incidentState === 'clean' &&
        gate.status === 'comparable',
      exclusionReasons
    }
  }

  private experiment(id: string | undefined): SetupExperimentDefinition {
    const experiment = this.state.experiments.find((candidate) => candidate.id === id)
    if (!experiment) throw new Error('Setup experiment not found.')
    return experiment
  }

  private activeRun(experimentId: string | undefined): {
    experiment: SetupExperimentDefinition
    run: SetupExperimentRun
  } {
    if (!this.active || this.active.experimentId !== experimentId) throw new Error('This experiment has no active arm.')
    const experiment = this.experiment(experimentId)
    const run = experiment.runs.find((candidate) => candidate.id === this.active?.runId)
    if (!run || run.status !== 'recording') throw new Error('The active setup experiment run is unavailable.')
    return { experiment, run }
  }

  private rejectActiveRun(
    reason: string,
    status: Extract<SetupExperimentRun['status'], 'rejected' | 'interrupted'> = 'rejected'
  ): void {
    if (!this.active) return
    const experiment = this.state.experiments.find((candidate) => candidate.id === this.active?.experimentId)
    const run = experiment?.runs.find((candidate) => candidate.id === this.active?.runId)
    if (run) {
      run.status = status
      run.completedAt = this.now()
      run.rejectionReasons = Array.from(new Set([...run.rejectionReasons, reason]))
      if (experiment) experiment.updatedAt = run.completedAt
    }
    this.active = null
  }

  private async changed(): Promise<void> {
    await this.persist()
    this.deps.broadcast(this.buildSnapshot())
  }

  private async persist(): Promise<void> {
    const snapshot = clone(this.state)
    this.saveQueue = this.saveQueue.then(() => this.deps.persistence.save(snapshot))
    await this.saveQueue
  }

  async dispose(): Promise<void> {
    await this.ready
    await this.saveQueue
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

function issueFields(report: ReturnType<typeof compareSetupExperimentContexts>): string {
  return report.issues.map((issue) => issue.field).join(',') || 'unknown'
}

function comparabilityError(report: ReturnType<typeof compareSetupExperimentContexts>): Error {
  return new Error(`Run rejected: context is ${report.status} (${issueFields(report)}).`)
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 80)
  return cleaned || 'setup-experiment'
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
