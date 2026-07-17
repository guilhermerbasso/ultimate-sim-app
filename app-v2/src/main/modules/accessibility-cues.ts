import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleContext } from '../module-context'
import {
  ACCESSIBILITY_CUE_CHANNELS,
  DEFAULT_ACCESSIBILITY_CUE_STORE,
  activateCueProfile,
  cloneAccessibilityCueStore,
  getActiveCueProfile,
  parseAccessibilityCueStore,
  resetCueProfile,
  serializeAccessibilityCueStore,
  upsertCueProfile,
  type AccessibilityCueStore,
  type CueProfile
} from '../../shared/accessibility-cues'

export const ACCESSIBILITY_CUES_CONFIG_FILE = 'accessibility-cues.json'

let state: AccessibilityCueStore = cloneAccessibilityCueStore(
  DEFAULT_ACCESSIBILITY_CUE_STORE
)

export function getAccessibilityCueStateSnapshot(): AccessibilityCueStore {
  return cloneAccessibilityCueStore(state)
}

export function getActiveAccessibilityCueProfile(): CueProfile {
  return getActiveCueProfile(state)
}

export function register(ctx: ModuleContext): void {
  const configPath = join(ctx.app.getPath('userData'), ACCESSIBILITY_CUES_CONFIG_FILE)
  state = cloneAccessibilityCueStore(DEFAULT_ACCESSIBILITY_CUE_STORE)

  const loadPromise = loadState(configPath).then((loaded) => {
    state = loaded
    ctx.broadcast(
      ACCESSIBILITY_CUE_CHANNELS.stateEvent,
      getAccessibilityCueStateSnapshot()
    )
  })
  let commitQueue: Promise<void> = loadPromise.then(() => undefined)

  const commit = (
    update: () => AccessibilityCueStore
  ): Promise<AccessibilityCueStore> => {
    const operation = commitQueue.then(async () => {
      const next = update()
      await saveState(configPath, next)
      state = next
      const snapshot = getAccessibilityCueStateSnapshot()
      ctx.broadcast(ACCESSIBILITY_CUE_CHANNELS.stateEvent, snapshot)
      return snapshot
    })
    commitQueue = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  ctx.ipcMain.handle(ACCESSIBILITY_CUE_CHANNELS.getState, async () => {
    await loadPromise
    return getAccessibilityCueStateSnapshot()
  })

  ctx.ipcMain.handle(
    ACCESSIBILITY_CUE_CHANNELS.saveProfile,
    async (_event, profile: unknown) => {
      await loadPromise
      return commit(() => upsertCueProfile(state, profile))
    }
  )

  ctx.ipcMain.handle(
    ACCESSIBILITY_CUE_CHANNELS.setActiveProfile,
    async (_event, profileId: unknown) => {
      await loadPromise
      return commit(() => activateCueProfile(state, profileId))
    }
  )

  ctx.ipcMain.handle(
    ACCESSIBILITY_CUE_CHANNELS.resetProfile,
    async (_event, profileId: unknown) => {
      await loadPromise
      return commit(() => resetCueProfile(state, profileId))
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
