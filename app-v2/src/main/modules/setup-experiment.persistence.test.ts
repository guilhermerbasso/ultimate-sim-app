import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SETUP_EXPERIMENT_SCHEMA_VERSION,
  type SetupExperimentContext,
  type SetupExperimentDefinition,
  type SetupExperimentLap,
  type SetupExperimentRun,
  type SetupExperimentStoredState
} from '../../shared/setup-experiment'
import { JsonSetupExperimentPersistence } from './setup-experiment'

type FsPromises = typeof import('node:fs/promises')
type RuntimeRecord = Record<string, unknown>
type RuntimeFs = Pick<FsPromises, 'mkdir' | 'readFile' | 'rename' | 'writeFile'>

type RuntimePersistenceOptions = {
  fs: RuntimeFs
  now: () => number
  id: () => string
}

type RuntimeStorageIssue = {
  kind: string
  sourcePath: string
  code: string
  message: string
  quarantineStatus?: 'quarantined' | 'failed'
  quarantinePath?: string
  checksum?: string
}

type RuntimeState = SetupExperimentStoredState & {
  revision: number
  storageIssues: RuntimeStorageIssue[]
}

type RuntimeAnalysisPlan = {
  seed: number
  iterations: number
  lapBlockLength: number
  minimumIndependentBlocks: number
  maxRollbackDriftSec: number
}

type RuntimeEnvironmentTolerances = {
  trackWetnessPct: number
  trackTempC: number
  airTempC: number
  fuelMassKg: number
  tyreStatePct: number
  trafficDensity: number
  flagStateIndex: number
  damagePct: number
  gripPct: number
}

type ControlledFailure = {
  path: string
  destination?: string
  error: NodeJS.ErrnoException
}

const FIXED_NOW = 1_700_000_000_000
const FIXED_ID = 'quarantine-1'

const fsControl = vi.hoisted(() => ({
  actual: undefined as FsPromises | undefined,
  readFailure: undefined as ControlledFailure | undefined,
  renameFailure: undefined as ControlledFailure | undefined,
  calls: {
    mkdir: [] as string[],
    readFile: [] as string[],
    rename: [] as Array<[string, string]>,
    writeFile: [] as string[]
  }
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<FsPromises>()
  fsControl.actual = actual
  return {
    ...actual,
    mkdir: (...args: unknown[]) => controlledMkdir(...args),
    readFile: (...args: unknown[]) => controlledReadFile(...args),
    rename: (...args: unknown[]) => controlledRename(...args),
    writeFile: (...args: unknown[]) => controlledWriteFile(...args)
  }
})

const RuntimePersistence = JsonSetupExperimentPersistence as unknown as new (
  path: string,
  options: RuntimePersistenceOptions
) => JsonSetupExperimentPersistence

function actualFs(): FsPromises {
  if (!fsControl.actual) throw new Error('The node:fs/promises delegate was not initialized.')
  return fsControl.actual
}

async function invokeActual(name: keyof RuntimeFs, args: unknown[]): Promise<unknown> {
  const operation = actualFs()[name] as unknown as (...values: unknown[]) => Promise<unknown>
  return operation(...args)
}

async function controlledMkdir(...args: unknown[]): Promise<unknown> {
  fsControl.calls.mkdir.push(String(args[0]))
  return invokeActual('mkdir', args)
}

async function controlledReadFile(...args: unknown[]): Promise<unknown> {
  const path = String(args[0])
  fsControl.calls.readFile.push(path)
  if (fsControl.readFailure?.path === path) throw fsControl.readFailure.error
  return invokeActual('readFile', args)
}

async function controlledRename(...args: unknown[]): Promise<unknown> {
  const source = String(args[0])
  const destination = String(args[1])
  fsControl.calls.rename.push([source, destination])
  if (
    fsControl.renameFailure?.path === source &&
    fsControl.renameFailure.destination === destination
  ) {
    throw fsControl.renameFailure.error
  }
  return invokeActual('rename', args)
}

async function controlledWriteFile(...args: unknown[]): Promise<unknown> {
  fsControl.calls.writeFile.push(String(args[0]))
  return invokeActual('writeFile', args)
}

function runtimeFs(): RuntimeFs {
  return {
    mkdir: controlledMkdir,
    readFile: controlledReadFile,
    rename: controlledRename,
    writeFile: controlledWriteFile
  } as unknown as RuntimeFs
}

function persistence(path: string): JsonSetupExperimentPersistence {
  // The runtime options probe describes the intended seam. The partial module
  // mock above supplies deterministic failures until production consumes it.
  return new RuntimePersistence(path, {
    fs: runtimeFs(),
    now: () => FIXED_NOW,
    id: () => FIXED_ID
  })
}

function errno(code: string, message: string, path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code, path })
}

function runtimeRecord(value: unknown): RuntimeRecord {
  expect.soft(value).toBeTypeOf('object')
  expect.soft(value).not.toBeNull()
  return value !== null && typeof value === 'object' ? value as RuntimeRecord : {}
}

function records(value: unknown): RuntimeRecord[] {
  expect.soft(value).toEqual(expect.any(Array))
  return Array.isArray(value) ? value.map(runtimeRecord) : []
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await actualFs().readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function context(): SetupExperimentContext & RuntimeRecord {
  return {
    sim: 'iracing',
    car: 'ferrari488gt3',
    carLabel: 'Ferrari 488 GT3',
    track: 'spa',
    layout: 'grand-prix',
    layoutSource: 'telemetry',
    condition: 'dry',
    session: 'practice',
    sessionId: 'session-42',
    trackWetnessPct: 0.2,
    trackTempC: 30,
    airTempC: 20,
    fuelMassKg: 45,
    tyreStatePct: 0.8,
    trafficDensity: 0.3,
    flagStateIndex: 0,
    damagePct: 0,
    gripPct: 0.8
  }
}

function lap(
  id: string,
  arm: 'A1' | 'B',
  lapNumber: number,
  lapTimeSec: number,
  metadata: RuntimeRecord = {}
): SetupExperimentLap & RuntimeRecord {
  return Object.assign({
    id,
    arm,
    capturedAt: FIXED_NOW + lapNumber,
    lapNumber,
    lapTimeSec,
    completion: 'complete' as const,
    incidentDelta: 0,
    incidentState: 'clean' as const,
    telemetryState: 'known' as const,
    context: context(),
    comparability: { status: 'comparable' as const, issues: [] },
    eligible: true,
    exclusionReasons: []
  }, metadata)
}

function extendedState(): RuntimeState {
  const analysisPlan: RuntimeAnalysisPlan = {
    seed: 0x5eed1234,
    iterations: 512,
    lapBlockLength: 2,
    minimumIndependentBlocks: 2,
    maxRollbackDriftSec: 0.5
  }
  const environmentTolerances: RuntimeEnvironmentTolerances = {
    trackWetnessPct: 0.05,
    trackTempC: 2,
    airTempC: 1.5,
    fuelMassKg: 1,
    tyreStatePct: 0.02,
    trafficDensity: 0.05,
    flagStateIndex: 0,
    damagePct: 0.005,
    gripPct: 0.02
  }
  const abaMetadata = { blockId: 'block-001', sequence: 'ABA' as const, stepIndex: 0, treatment: 'A' as const }
  const babMetadata = { blockId: 'block-002', sequence: 'BAB' as const, stepIndex: 0, treatment: 'B' as const }
  const runs = [
    Object.assign({
      id: 'block-001-step-0',
      arm: 'A1' as const,
      setupPath: 'C:\\setups\\baseline.sto',
      status: 'completed' as const,
      startedAt: FIXED_NOW + 10,
      completedAt: FIXED_NOW + 20,
      startContext: context(),
      laps: [
        lap('A-1', 'A1', 1, 100.1, abaMetadata),
        lap('A-2', 'A1', 2, 99.9, abaMetadata)
      ],
      rejectionReasons: []
    }, abaMetadata),
    Object.assign({
      id: 'block-002-step-0',
      arm: 'B' as const,
      setupPath: 'C:\\setups\\variant.sto',
      status: 'completed' as const,
      startedAt: FIXED_NOW + 30,
      completedAt: FIXED_NOW + 40,
      startContext: context(),
      laps: [
        lap('B-9', 'B', 9, 98.3, babMetadata),
        lap('B-10', 'B', 10, 130, { ...babMetadata, flaggedOutlier: true })
      ],
      rejectionReasons: []
    }, babMetadata)
  ] satisfies SetupExperimentRun[]
  const experiment = {
    schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
    id: 'experiment-fixed',
    name: 'Fixed rear-wing experiment',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW + 40,
    baselineSetup: {
      id: 'baseline-fixed',
      path: 'C:\\setups\\baseline.sto',
      fileName: 'baseline.sto',
      relativePath: 'ferrari488gt3\\baseline.sto',
      sizeBytes: 101,
      modifiedAt: 1_699_999_999_000
    },
    variantSetup: {
      id: 'variant-fixed',
      path: 'C:\\setups\\variant.sto',
      fileName: 'variant.sto',
      relativePath: 'ferrari488gt3\\variant.sto',
      sizeBytes: 102,
      modifiedAt: 1_699_999_999_500
    },
    variable: {
      section: 'Aero',
      key: 'Rear Wing',
      kind: 'changed' as const,
      before: '8',
      after: '7'
    },
    context: context(),
    minCleanLapsPerArm: 5,
    runs,
    decision: null,
    localOnly: true as const,
    setupApplication: 'manual' as const,
    analysisPlan,
    environmentTolerances,
    protocolPlan: [
      { blockId: 'block-001', sequence: 'ABA' },
      { blockId: 'block-002', sequence: 'BAB' }
    ]
  } as unknown as SetupExperimentDefinition
  return {
    schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
    revision: 17,
    experiments: [experiment],
    storageIssues: []
  }
}

async function settleSave(
  store: JsonSetupExperimentPersistence,
  state: SetupExperimentStoredState
): Promise<PromiseSettledResult<unknown>> {
  const runtimeSave = store.save.bind(store) as unknown as (
    value: SetupExperimentStoredState
  ) => Promise<unknown>
  const [result] = await Promise.allSettled([runtimeSave(state)])
  return result
}

describe('JsonSetupExperimentPersistence corrupt-store and atomic persistence', () => {
  let root: string
  let storePath: string

  beforeEach(async () => {
    fsControl.readFailure = undefined
    fsControl.renameFailure = undefined
    fsControl.calls.mkdir.length = 0
    fsControl.calls.readFile.length = 0
    fsControl.calls.rename.length = 0
    fsControl.calls.writeFile.length = 0
    root = join(process.cwd(), '.test-scratch', `setup-experiment-persistence-${process.pid}`)
    await actualFs().rm(root, { recursive: true, force: true })
    await actualFs().mkdir(root, { recursive: true })
    storePath = join(root, 'setup-experiments.json')
  })

  afterEach(async () => {
    await actualFs().rm(root, { recursive: true, force: true })
  })

  it('treats ENOENT as a normal first run with no storage issue', async () => {
    const loaded = await persistence(storePath).load()
    const record = runtimeRecord(loaded)

    expect.soft(record).toMatchObject({
      schemaVersion: SETUP_EXPERIMENT_SCHEMA_VERSION,
      experiments: []
    })
    expect.soft(record.storageIssues).toEqual([])
    expect.soft(fsControl.calls.readFile).toEqual([storePath])
    expect.soft(fsControl.calls.rename).toEqual([])
  })

  it.each([
    {
      label: 'malformed JSON',
      bytes: Buffer.from('{broken'),
      code: 'INVALID_JSON'
    },
    {
      label: 'wrong schema',
      bytes: Buffer.from('{"schemaVersion":999,"experiments":[]}'),
      code: 'SCHEMA_VERSION'
    },
    {
      label: 'invalid nested experiment',
      bytes: Buffer.from('{"schemaVersion":1,"experiments":[{"id":42}]}'),
      code: 'INVALID_STRUCTURE'
    }
  ])('preserves and quarantines exact $label bytes while surfacing $code', async ({ bytes, code }) => {
    await actualFs().writeFile(storePath, bytes)
    const quarantinePath = `${storePath}.corrupt-${FIXED_NOW}-${FIXED_ID}`

    const loaded = await persistence(storePath).load()
    const record = runtimeRecord(loaded)
    const quarantinedBytes = await readOptional(quarantinePath)
    const originalBytes = await readOptional(storePath)

    expect.soft(record.experiments).toEqual([])
    expect.soft(record.storageIssues).toEqual([
      expect.objectContaining({
        kind: 'corrupt-store',
        sourcePath: storePath,
        code,
        message: expect.any(String),
        quarantineStatus: 'quarantined',
        quarantinePath
      })
    ])
    expect.soft(quarantinedBytes).toEqual(bytes)
    expect.soft(sha256(quarantinedBytes ?? Buffer.alloc(0))).toBe(sha256(bytes))
    expect.soft(originalBytes).toBeNull()
    expect.soft(fsControl.calls.rename).toContainEqual([storePath, quarantinePath])
  })

  it('distinguishes unreadable EACCES from ENOENT and fails closed', async () => {
    fsControl.readFailure = {
      path: storePath,
      error: errno('EACCES', 'fixed unreadable store', storePath)
    }

    const loaded = await persistence(storePath).load()
    const record = runtimeRecord(loaded)

    expect.soft(record.experiments).toEqual([])
    expect.soft(record.storageIssues).toEqual([
      expect.objectContaining({
        kind: 'unreadable-store',
        sourcePath: storePath,
        code: 'EACCES',
        message: 'fixed unreadable store'
      })
    ])
    expect.soft(fsControl.calls.readFile).toEqual([storePath])
    expect.soft(fsControl.calls.rename).toEqual([])
  })

  it('keeps exact corrupt bytes at the original path when quarantine rename fails', async () => {
    const corruptBytes = Buffer.from('{broken')
    const originalHash = sha256(corruptBytes)
    const quarantinePath = `${storePath}.corrupt-${FIXED_NOW}-${FIXED_ID}`
    await actualFs().writeFile(storePath, corruptBytes)
    fsControl.renameFailure = {
      path: storePath,
      destination: quarantinePath,
      error: errno('EACCES', 'fixed quarantine rename failure', storePath)
    }

    const loaded = await persistence(storePath).load()
    const record = runtimeRecord(loaded)
    const bytesAfterLoad = await actualFs().readFile(storePath)
    const quarantineBytes = await readOptional(quarantinePath)

    expect.soft(bytesAfterLoad).toEqual(corruptBytes)
    expect.soft(sha256(bytesAfterLoad)).toBe(originalHash)
    expect.soft(quarantineBytes).toBeNull()
    expect.soft(fsControl.calls.rename).toContainEqual([storePath, quarantinePath])
    expect.soft(record.storageIssues).toEqual([
      expect.objectContaining({
        kind: 'corrupt-store',
        sourcePath: storePath,
        code: 'EACCES',
        message: expect.stringContaining('fixed quarantine rename failure'),
        quarantineStatus: 'failed',
        quarantinePath
      })
    ])
  })

  it('round-trips revision analysis plan block sequences tolerances and flagged laps without loss', async () => {
    const state = extendedState()
    const store = persistence(storePath)
    await store.save(state)

    const loaded = runtimeRecord(await store.load())
    const [experiment] = records(loaded.experiments)
    const loadedRuns = records(experiment?.runs)
    const loadedLaps = loadedRuns.flatMap((run) => records(run.laps))
    const flaggedLap = loadedLaps.find((candidate) => candidate.id === 'B-10')

    expect.soft(loaded.revision).toBe(17)
    expect.soft(loaded.storageIssues).toEqual([])
    expect.soft(experiment?.analysisPlan).toEqual({
      seed: 0x5eed1234,
      iterations: 512,
      lapBlockLength: 2,
      minimumIndependentBlocks: 2,
      maxRollbackDriftSec: 0.5
    })
    expect.soft(experiment?.protocolPlan).toEqual([
      { blockId: 'block-001', sequence: 'ABA' },
      { blockId: 'block-002', sequence: 'BAB' }
    ])
    expect.soft(loadedRuns.map(({ blockId, sequence, stepIndex, treatment }) => ({
      blockId,
      sequence,
      stepIndex,
      treatment
    }))).toEqual([
      { blockId: 'block-001', sequence: 'ABA', stepIndex: 0, treatment: 'A' },
      { blockId: 'block-002', sequence: 'BAB', stepIndex: 0, treatment: 'B' }
    ])
    expect.soft(experiment?.environmentTolerances).toEqual({
      trackWetnessPct: 0.05,
      trackTempC: 2,
      airTempC: 1.5,
      fuelMassKg: 1,
      tyreStatePct: 0.02,
      trafficDensity: 0.05,
      flagStateIndex: 0,
      damagePct: 0.005,
      gripPct: 0.02
    })
    expect.soft(loadedLaps.map((candidate) => candidate.id)).toEqual(['A-1', 'A-2', 'B-9', 'B-10'])
    expect.soft(flaggedLap).toMatchObject({
      id: 'B-10',
      lapTimeSec: 130,
      incidentState: 'clean',
      eligible: true,
      exclusionReasons: [],
      flaggedOutlier: true
    })
  })

  it('rejects atomic replacement failure without changing any prior store byte', async () => {
    const priorBytes = Buffer.from('{"schemaVersion":1,"experiments":[]}\n')
    const priorHash = sha256(priorBytes)
    const temporaryPath = `${storePath}.tmp`
    await actualFs().writeFile(storePath, priorBytes)
    fsControl.renameFailure = {
      path: temporaryPath,
      destination: storePath,
      error: errno('EIO', 'fixed replacement rename failure', storePath)
    }

    const result = await settleSave(persistence(storePath), extendedState())
    const bytesAfterFailure = await actualFs().readFile(storePath)
    const finalTargetWrites = fsControl.calls.writeFile.filter((path) => path === storePath)

    expect.soft(result.status).toBe('rejected')
    if (result.status === 'rejected') {
      expect.soft(runtimeRecord(result.reason)).toMatchObject({ code: 'EIO' })
    }
    expect.soft(bytesAfterFailure).toEqual(priorBytes)
    expect.soft(sha256(bytesAfterFailure)).toBe(priorHash)
    expect.soft(fsControl.calls.rename).toEqual([[temporaryPath, storePath]])
    expect.soft(finalTargetWrites).toEqual([])
  })

  it('cleans or explicitly surfaces the recoverable temporary artifact after replacement failure', async () => {
    const temporaryPath = `${storePath}.tmp`
    const nextState = extendedState()
    const expectedTemporaryBytes = Buffer.from(`${JSON.stringify(nextState, null, 2)}\n`)
    const expectedChecksum = sha256(expectedTemporaryBytes)
    await actualFs().writeFile(storePath, Buffer.from('{"schemaVersion":1,"experiments":[]}\n'))
    fsControl.renameFailure = {
      path: temporaryPath,
      destination: storePath,
      error: errno('EIO', 'fixed replacement rename failure', storePath)
    }

    const result = await settleSave(persistence(storePath), nextState)
    const temporaryBytes = await readOptional(temporaryPath)
    const surfaced = result.status === 'fulfilled' ? result.value : result.reason
    const issues = records(runtimeRecord(surfaced).storageIssues)
    const recoverable = issues.find((issue) => issue.kind === 'recoverable')

    if (temporaryBytes !== null) {
      expect.soft(temporaryBytes).toEqual(expectedTemporaryBytes)
      expect.soft(sha256(temporaryBytes)).toBe(expectedChecksum)
      expect.soft(recoverable).toMatchObject({
        kind: 'recoverable',
        sourcePath: storePath,
        code: 'EIO',
        quarantinePath: temporaryPath,
        checksum: expectedChecksum
      })
    }
    expect.soft(temporaryBytes === null || recoverable !== undefined).toBe(true)
  })
})
