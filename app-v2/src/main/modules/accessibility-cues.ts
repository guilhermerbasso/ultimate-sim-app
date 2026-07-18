import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import {
  ACCESSIBILITY_CUE_CHANNELS,
  ACCESSIBILITY_CUE_PROTOCOL_VERSION,
  DEFAULT_ACCESSIBILITY_CUE_STORE,
  activateCueProfile,
  cloneAccessibilityCueStore,
  createAccessibilityCueStateEnvelope,
  getActiveCueProfile,
  parseAccessibilityCueStore,
  resetCueProfile,
  serializeAccessibilityCueStore,
  upsertCueProfile,
  type AccessibilityCueStateEnvelope,
  type AccessibilityCueStore,
  type CueProfile,
  type SaveCueProfileRequest,
  type SelectCueProfileRequest
} from '../../shared/accessibility-cues'

export const ACCESSIBILITY_CUES_CONFIG_FILE = 'accessibility-cues.json'

let state: AccessibilityCueStore = cloneAccessibilityCueStore(
  DEFAULT_ACCESSIBILITY_CUE_STORE
)
let ready = false
let resolveReady: (() => void) | null = null
let readyPromise: Promise<void> = new Promise<void>((resolve) => {
  resolveReady = resolve
})

function resetReadiness(): void {
  ready = false
  readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
}

function markReady(): void {
  if (ready) return
  ready = true
  resolveReady?.()
  resolveReady = null
}

export function isAccessibilityCueProfileReady(): boolean {
  return ready
}

export function whenAccessibilityCueProfileReady(): Promise<void> {
  return readyPromise
}

export function getAccessibilityCueStateSnapshot(): AccessibilityCueStore {
  return cloneAccessibilityCueStore(state)
}

export function getAccessibilityCueStateEnvelope(): AccessibilityCueStateEnvelope {
  return createAccessibilityCueStateEnvelope(state, ready)
}

export function getActiveAccessibilityCueProfile(): CueProfile | null {
  return ready ? getActiveCueProfile(state) : null
}

function revisionConflict(expected: number): Error {
  return Object.assign(
    new Error(
      `Accessibility cue profile revision conflict: expected ${expected}, current ${state.revision}.`
    ),
    {
      code: 'ACCESSIBILITY_CUE_REVISION_CONFLICT',
      expectedRevision: expected,
      currentRevision: state.revision
    }
  )
}

function assertExpectedRevision(value: unknown): number {
  if (
    !value ||
    typeof value !== 'object' ||
    !('protocolVersion' in value) ||
    value.protocolVersion !== ACCESSIBILITY_CUE_PROTOCOL_VERSION ||
    !('expectedRevision' in value) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isInteger(value.expectedRevision)
  ) {
    throw Object.assign(new Error('Invalid accessibility cue mutation envelope.'), {
      code: 'ACCESSIBILITY_CUE_INVALID_MUTATION'
    })
  }
  if (value.expectedRevision !== state.revision) {
    throw revisionConflict(value.expectedRevision)
  }
  return value.expectedRevision
}

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), ACCESSIBILITY_CUES_CONFIG_FILE)
  state = cloneAccessibilityCueStore(DEFAULT_ACCESSIBILITY_CUE_STORE)
  resetReadiness()
  ctx.broadcast(ACCESSIBILITY_CUE_CHANNELS.stateEvent, getAccessibilityCueStateEnvelope())

  const loadPromise = loadState(configPath).then((loaded) => {
    state = {
      ...loaded,
      revision: Math.max(1, loaded.revision)
    }
    markReady()
    ctx.broadcast(ACCESSIBILITY_CUE_CHANNELS.stateEvent, getAccessibilityCueStateEnvelope())
  })
  let commitQueue: Promise<void> = loadPromise.then(() => undefined)

  const commit = (
    expectedRevision: number,
    update: () => AccessibilityCueStore
  ): Promise<AccessibilityCueStateEnvelope> => {
    const operation = commitQueue.then(async () => {
      if (expectedRevision !== state.revision) throw revisionConflict(expectedRevision)
      const next = update()
      await saveState(configPath, next)
      state = next
      const envelope = getAccessibilityCueStateEnvelope()
      ctx.broadcast(ACCESSIBILITY_CUE_CHANNELS.stateEvent, envelope)
      return envelope
    })
    commitQueue = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  ctx.ipcMain.handle(ACCESSIBILITY_CUE_CHANNELS.getState, async () => {
    await loadPromise
    return getAccessibilityCueStateEnvelope()
  })

  ctx.ipcMain.handle(
    ACCESSIBILITY_CUE_CHANNELS.saveProfile,
    async (_event, request: SaveCueProfileRequest) => {
      await loadPromise
      const expectedRevision = assertExpectedRevision(request)
      if (!request.profile || typeof request.profile !== 'object') {
        throw Object.assign(new Error('Accessibility cue profile is required.'), {
          code: 'ACCESSIBILITY_CUE_INVALID_PROFILE'
        })
      }
      return commit(expectedRevision, () => upsertCueProfile(state, request.profile))
    }
  )

  ctx.ipcMain.handle(
    ACCESSIBILITY_CUE_CHANNELS.setActiveProfile,
    async (_event, request: SelectCueProfileRequest) => {
      await loadPromise
      const expectedRevision = assertExpectedRevision(request)
      return commit(expectedRevision, () =>
        activateCueProfile(state, request.profileId)
      )
    }
  )

  ctx.ipcMain.handle(
    ACCESSIBILITY_CUE_CHANNELS.resetProfile,
    async (_event, request: SelectCueProfileRequest) => {
      await loadPromise
      const expectedRevision = assertExpectedRevision(request)
      return commit(expectedRevision, () => resetCueProfile(state, request.profileId))
    }
  )
}

async function loadState(configPath: string): Promise<AccessibilityCueStore> {
  try {
    return parseAccessibilityCueStore(await readFile(configPath, 'utf8'))
  } catch {
    return cloneAccessibilityCueStore(DEFAULT_ACCESSIBILITY_CUE_STORE)
  }
}

async function saveState(
  configPath: string,
  nextState: AccessibilityCueStore
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    serializeAccessibilityCueStore(nextState),
    'utf8'
  )
}
