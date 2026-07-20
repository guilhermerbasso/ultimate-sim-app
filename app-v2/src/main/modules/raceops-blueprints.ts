import {
  RACEOPS_BLUEPRINT_CHANNELS,
  type RaceOpsBlueprintRollbackRequest,
  type RaceOpsBlueprintSelectionRequest
} from '../../shared/raceops-blueprints'
import {
  RaceOpsBlueprintRegistry,
  createFileRaceOpsRegistryStorage
} from '../blueprints/registry'
import {
  RACEOPS_BUNDLED_FEEDS,
  RACEOPS_CURATED_FEED_PINS,
  RACEOPS_TRUSTED_PUBLIC_KEYS
} from '../blueprints/curated'
import type { ModuleContext } from '../module-context'
import { logger } from './logger'

export function register(ctx: ModuleContext): RaceOpsBlueprintRegistry {
  const registry = new RaceOpsBlueprintRegistry({
    storage: createFileRaceOpsRegistryStorage(ctx.app.getPath('userData')),
    appVersion: ctx.app.getVersion(),
    pins: RACEOPS_CURATED_FEED_PINS,
    trustedKeys: RACEOPS_TRUSTED_PUBLIC_KEYS,
    bundledFeeds: RACEOPS_BUNDLED_FEEDS
  })

  const broadcastChanged = async <T>(work: Promise<T>): Promise<T> => {
    const result = await work
    try {
      ctx.broadcast(RACEOPS_BLUEPRINT_CHANNELS.changed, await registry.getSnapshot())
    } catch (error) {
      logger.warn('raceops-blueprints', 'registry change broadcast failed', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
    return result
  }

  ctx.ipcMain.handle(RACEOPS_BLUEPRINT_CHANNELS.getSnapshot, () => registry.getSnapshot())
  ctx.ipcMain.handle(RACEOPS_BLUEPRINT_CHANNELS.refreshFeed, (_event, feedId: unknown) => {
    if (typeof feedId !== 'string') throw new Error('Invalid feed id.')
    return broadcastChanged(registry.refreshFeed(feedId))
  })
  ctx.ipcMain.handle(
    RACEOPS_BLUEPRINT_CHANNELS.dryRun,
    (_event, request: RaceOpsBlueprintSelectionRequest) =>
      broadcastChanged(registry.dryRun(request))
  )
  ctx.ipcMain.handle(
    RACEOPS_BLUEPRINT_CHANNELS.stage,
    (_event, request: RaceOpsBlueprintSelectionRequest) =>
      broadcastChanged(registry.stage(request))
  )
  ctx.ipcMain.handle(RACEOPS_BLUEPRINT_CHANNELS.rollback, (_event, request: RaceOpsBlueprintRollbackRequest) => {
    return broadcastChanged(registry.rollback(request))
  })

  void registry.getSnapshot().catch((error) => {
    logger.warn('raceops-blueprints', 'registry bootstrap failed closed', {
      message: error instanceof Error ? error.message : String(error)
    })
  })

  return registry
}
