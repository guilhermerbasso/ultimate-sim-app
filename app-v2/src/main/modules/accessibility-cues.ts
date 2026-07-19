import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import {
  CONFIG_SECTION_RELOAD_SIGNAL,
  CONFIG_SECTION_RESET_SIGNAL,
  type ConfigSectionReloadCallback,
  type ConfigSectionReloadResult
} from '../../shared/config-io'
import { AccessibilityCueCapabilityLeaseRegistry } from './accessibility-cue-capability-leases'
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
  type CueCapabilityLeaseAck,
  type SaveCueProfileRequest,
  type SetCueCapabilityLeaseRequest,
  type SelectCueProfileRequest
} from '../../shared/accessibility-cues'

export const ACCESSIBILITY_CUES_CONFIG_FILE = 'accessibility-cues.json'

let state: AccessibilityCueStore = cloneAccessibilityCueStore(
  DEFAULT_ACCESSIBILITY_CUE_STORE
)
let ready = false
let capabilityLeases = new AccessibilityCueCapabilityLeaseRegistry()
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

export function getAccessibilityCueProfileRevision(): number {
  return state.revision
}

export function getActiveAccessibilityCueProfile(): CueProfile | null {
  return ready ? getActiveCueProfile(state) : null
}

export function isAccessibilityCueAudioAvailable(): boolean {
  return capabilityLeases.available('audio')
}

export function isAccessibilityCueRendererHapticAvailable(): boolean {
  return capabilityLeases.available('haptic')
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
  capabilityLeases.dispose()
  capabilityLeases = new AccessibilityCueCapabilityLeaseRegistry()
  resetReadiness()
  ctx.broadcast(ACCESSIBILITY_CUE_CHANNELS.stateEvent, getAccessibilityCueStateEnvelope())

  let stateQueue: Promise<void> = loadState(configPath).then((loaded) => {
    state = {
      ...loaded,
      revision: Math.max(1, loaded.revision)
    }
    markReady()
    ctx.broadcast(ACCESSIBILITY_CUE_CHANNELS.stateEvent, getAccessibilityCueStateEnvelope())
  })

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = stateQueue.then(operation)
    stateQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const commit = (
    expectedRevision: number,
    update: () => AccessibilityCueStore
  ): Promise<AccessibilityCueStateEnvelope> => {
    return enqueue(async () => {
      if (expectedRevision !== state.revision) throw revisionConflict(expectedRevision)
      const next = update()
      await saveState(configPath, next)
      state = next
      const envelope = getAccessibilityCueStateEnvelope()
      ctx.broadcast(ACCESSIBILITY_CUE_CHANNELS.stateEvent, envelope)
      return envelope
    })
  }

  ctx.ipcMain.handle(ACCESSIBILITY_CUE_CHANNELS.getState, async () => {
    await stateQueue
    return getAccessibilityCueStateEnvelope()
  })

  ctx.ipcMain.handle(
    ACCESSIBILITY_CUE_CHANNELS.saveProfile,
    async (_event, request: SaveCueProfileRequest) => {
      await stateQueue
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
      await stateQueue
      const expectedRevision = assertExpectedRevision(request)
      return commit(expectedRevision, () =>
        activateCueProfile(state, request.profileId)
      )
    }
  )

  ctx.ipcMain.handle(
    ACCESSIBILITY_CUE_CHANNELS.resetProfile,
    async (_event, request: SelectCueProfileRequest) => {
      await stateQueue
      const expectedRevision = assertExpectedRevision(request)
      return commit(expectedRevision, () => resetCueProfile(state, request.profileId))
    }
  )

  ctx.ipcMain.handle(
    ACCESSIBILITY_CUE_CHANNELS.setCapabilityLease,
    async (event, request: SetCueCapabilityLeaseRequest): Promise<CueCapabilityLeaseAck> => {
      if (
        !request ||
        request.protocolVersion !== ACCESSIBILITY_CUE_PROTOCOL_VERSION ||
        typeof request.leaseId !== 'string' ||
        request.leaseId.length < 8 ||
        request.leaseId.length > 128 ||
        (request.modality !== 'audio' && request.modality !== 'haptic') ||
        !Number.isInteger(request.generation) ||
        request.generation <= 0 ||
        typeof request.available !== 'boolean' ||
        typeof request.ttlMs !== 'number' ||
        !Number.isFinite(request.ttlMs) ||
        request.ttlMs <= 0
      ) {
        throw Object.assign(
          new Error('Invalid accessibility cue capability lease envelope.'),
          { code: 'ACCESSIBILITY_CUE_INVALID_CAPABILITY_LEASE' }
        )
      }
      return capabilityLeases.update(event.sender, request)
    }
  )

  const onSectionReload = (
    _event: unknown,
    sectionId: string,
    done?: ConfigSectionReloadCallback
  ): void => {
    if (sectionId !== 'accessibility-cues') return
    const operation = enqueue(async (): Promise<ConfigSectionReloadResult> => {
      const previousRevision = state.revision
      const loaded = await loadState(configPath)
      state = {
        ...loaded,
        revision: Math.max(1, previousRevision + 1, loaded.revision)
      }
      markReady()
      const envelope = getAccessibilityCueStateEnvelope()
      ctx.broadcast(ACCESSIBILITY_CUE_CHANNELS.stateEvent, envelope)
      return {
        sectionId,
        itemCount: state.profiles.length,
        hotAppliedCount: state.profiles.length,
        unmatchedItemCount: 0
      }
    })
    void operation.then(
      (result) => done?.(null, result),
      (error) =>
        done?.(error instanceof Error ? error.message : String(error))
    )
  }

  const onSectionReset = (
    _event: unknown,
    sectionId: string,
    done?: ConfigSectionReloadCallback
  ): void => {
    if (sectionId !== 'accessibility-cues') return
    const operation = enqueue(async (): Promise<ConfigSectionReloadResult> => {
      await rm(configPath, { force: true }).catch(() => undefined)
      const nextRevision = Math.max(1, state.revision + 1)
      state = {
        ...cloneAccessibilityCueStore(DEFAULT_ACCESSIBILITY_CUE_STORE),
        revision: nextRevision,
        updatedAt: Date.now()
      }
      markReady()
      ctx.broadcast(
        ACCESSIBILITY_CUE_CHANNELS.stateEvent,
        getAccessibilityCueStateEnvelope()
      )
      return {
        sectionId,
        itemCount: state.profiles.length,
        hotAppliedCount: state.profiles.length,
        unmatchedItemCount: 0
      }
    })
    void operation.then(
      (result) => done?.(null, result),
      (error) =>
        done?.(error instanceof Error ? error.message : String(error))
    )
  }

  ctx.ipcMain.on(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)
  ctx.ipcMain.on(CONFIG_SECTION_RESET_SIGNAL, onSectionReset)
  ctx.app.once('before-quit', () => {
    capabilityLeases.dispose()
    ctx.ipcMain.off(CONFIG_SECTION_RELOAD_SIGNAL, onSectionReload)
    ctx.ipcMain.off(CONFIG_SECTION_RESET_SIGNAL, onSectionReset)
  })
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
