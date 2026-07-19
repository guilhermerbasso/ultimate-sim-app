import { join } from 'node:path'
import {
  STREAM_PRESENTATION_CHANNELS,
  STREAM_PRESENTATION_TARGET_CHANGED,
  STREAM_PRESENTATION_TARGET_MISSING,
  cloneStreamPresentationProfile,
  normalizeStreamPresentationProfile,
  refreshStreamPresentationTarget,
  streamDashboardTargetDescriptor,
  streamPresentationTargetState,
  streamTouchTargetDescriptor,
  type StreamPresentationDeleteRequest,
  type StreamPresentationProfile,
  type StreamPresentationProfileListItem,
  type StreamPresentationRefreshTargetRequest,
  type StreamPresentationSaveRequest,
  type StreamPresentationTargetDescriptor,
  type StreamPresentationTargetRef
} from '../../shared/stream-presentation'
import type { ModuleContext } from '../module-context'
import {
  StreamPresentationProfileStore
} from '../streaming/presentation-profile-store'
import { getTouchPanelManager } from '../touchpanel/manager'
import { getDashboardManager } from './dashboards'
import { logger } from './logger'

const STORE_FILE = 'stream-presentation-profiles.json'

let liveStore: StreamPresentationProfileStore | null = null

export class StreamPresentationTargetError extends Error {
  constructor(
    readonly code: typeof STREAM_PRESENTATION_TARGET_CHANGED | typeof STREAM_PRESENTATION_TARGET_MISSING,
    readonly target: StreamPresentationTargetRef,
    message: string
  ) {
    super(`${code}: ${message}`)
    this.name = 'StreamPresentationTargetError'
  }
}

export function listStreamPresentationTargets(): StreamPresentationTargetDescriptor[] {
  const dashboards = getDashboardManager()?.list().map(streamDashboardTargetDescriptor) ?? []
  const touchPanels = getTouchPanelManager()?.list().map(streamTouchTargetDescriptor) ?? []
  return [...dashboards, ...touchPanels].sort((a, b) =>
    Number(a.hidden) - Number(b.hidden) ||
    a.kind.localeCompare(b.kind) ||
    a.name.localeCompare(b.name)
  )
}

export function findStreamPresentationTarget(
  target: Pick<StreamPresentationTargetRef, 'kind' | 'id'>
): StreamPresentationTargetDescriptor | null {
  return listStreamPresentationTargets().find((candidate) =>
    candidate.kind === target.kind && candidate.id === target.id
  ) ?? null
}

export function resolveStreamPresentationProfileItem(
  profile: StreamPresentationProfile
): StreamPresentationProfileListItem {
  const target = findStreamPresentationTarget(profile.target)
  return {
    profile: cloneStreamPresentationProfile(profile),
    target,
    targetState: streamPresentationTargetState(profile, target)
  }
}

export async function getStreamPresentationProfileForRuntime(
  id: string
): Promise<StreamPresentationProfileListItem | null> {
  if (!liveStore) return null
  await liveStore.load()
  const profile = liveStore.get(id)
  return profile ? resolveStreamPresentationProfileItem(profile) : null
}

export function getStreamPresentationProfileStore(): StreamPresentationProfileStore | null {
  return liveStore
}

function assertCurrentTarget(profile: StreamPresentationProfile): StreamPresentationTargetDescriptor {
  const target = findStreamPresentationTarget(profile.target)
  if (!target) {
    throw new StreamPresentationTargetError(
      STREAM_PRESENTATION_TARGET_MISSING,
      profile.target,
      `${profile.target.kind} target ${profile.target.id} no longer exists.`
    )
  }
  if (target.revision !== profile.target.revision) {
    throw new StreamPresentationTargetError(
      STREAM_PRESENTATION_TARGET_CHANGED,
      profile.target,
      `${profile.target.kind} target ${profile.target.id} changed from ${profile.target.revision} to ${target.revision}. Refresh the target revision before saving.`
    )
  }
  return target
}

async function listItems(store: StreamPresentationProfileStore): Promise<StreamPresentationProfileListItem[]> {
  const profiles = await store.load()
  return profiles.map(resolveStreamPresentationProfileItem)
}

async function broadcastItems(ctx: ModuleContext, store: StreamPresentationProfileStore): Promise<void> {
  ctx.broadcast(STREAM_PRESENTATION_CHANNELS.list, await listItems(store))
}

export function register(ctx: ModuleContext): void {
  const store = new StreamPresentationProfileStore(join(ctx.app.getPath('userData'), STORE_FILE))
  liveStore = store

  ctx.ipcMain.handle(STREAM_PRESENTATION_CHANNELS.targets, () => listStreamPresentationTargets())
  ctx.ipcMain.handle(STREAM_PRESENTATION_CHANNELS.list, () => listItems(store))
  ctx.ipcMain.handle(STREAM_PRESENTATION_CHANNELS.get, async (_event, id: string) => {
    await store.load()
    const profile = store.get(id)
    return profile ? resolveStreamPresentationProfileItem(profile) : null
  })
  ctx.ipcMain.handle(STREAM_PRESENTATION_CHANNELS.save, async (_event, request: StreamPresentationSaveRequest) => {
    const profile = normalizeStreamPresentationProfile(request?.profile)
    if (!profile) throw new Error('Invalid stream presentation profile.')
    assertCurrentTarget(profile)
    const saved = await store.save(profile, request.expectedRevision)
    await broadcastItems(ctx, store)
    return resolveStreamPresentationProfileItem(saved)
  })
  ctx.ipcMain.handle(STREAM_PRESENTATION_CHANNELS.delete, async (_event, request: StreamPresentationDeleteRequest) => {
    await store.delete(request.id, request.expectedRevision)
    const items = await listItems(store)
    ctx.broadcast(STREAM_PRESENTATION_CHANNELS.list, items)
    return items
  })
  ctx.ipcMain.handle(
    STREAM_PRESENTATION_CHANNELS.refreshTarget,
    async (_event, request: StreamPresentationRefreshTargetRequest) => {
      await store.load()
      const profile = store.get(request.id)
      if (!profile) {
        throw new StreamPresentationTargetError(
          STREAM_PRESENTATION_TARGET_MISSING,
          { kind: 'dashboard', id: request.id, revision: 'missing' },
          `Profile ${request.id} no longer exists.`
        )
      }
      const target = findStreamPresentationTarget(profile.target)
      if (!target) {
        throw new StreamPresentationTargetError(
          STREAM_PRESENTATION_TARGET_MISSING,
          profile.target,
          `${profile.target.kind} target ${profile.target.id} no longer exists.`
        )
      }
      const refreshed = refreshStreamPresentationTarget(profile, target)
      const saved = await store.save(refreshed, request.expectedRevision)
      await broadcastItems(ctx, store)
      return resolveStreamPresentationProfileItem(saved)
    }
  )

  void store.load().catch((error) => {
    logger.warn('streaming', 'failed to load stream presentation profiles', {
      message: error instanceof Error ? error.message : String(error)
    })
  })

  ctx.app.once('before-quit', () => {
    if (liveStore === store) liveStore = null
  })
}
