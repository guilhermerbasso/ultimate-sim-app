import type { DashboardSummary } from '../../shared/dashboards'
import type { AppSettings } from '../../shared/settings'
import {
  STREAM_SOURCE_CHANNELS,
  buildStreamSourceDescriptors,
  parseStreamSourceMutationRequest,
  parseStreamSourceRemovalRequest,
  streamSourceIsAdded,
  streamSourceRefsFromSettings,
  type StreamSourceDescriptor,
  type StreamSourceRef
} from '../../shared/stream-sources'
import {
  addStreamTargetProfile,
  deleteStreamTargetProfile,
  normalizeStreamTargetSettings,
  streamTargetSourceKey,
  type StreamTargetProfileIdFactory,
  type StreamTargetSettings
} from '../../shared/stream-targets'
import type { StreamingStatus } from '../../shared/streaming'
import type { ButtonBoxSummary } from '../../shared/touch-panel'
import type { ModuleContext } from '../module-context'
import { settingsEvents } from '../settings/events'
import type { SettingsStore } from '../settings/store'
import { streamSourceRegistryEvents } from '../streaming/source-events'
import { getTouchPanelManager } from '../touchpanel/manager'
import { getDashboardManager } from './dashboards'
import { logger } from './logger'

export interface StreamSourceRuntime {
  status(): Promise<Pick<StreamingStatus, 'running' | 'layoutKind' | 'layoutId'>>
  stop(): Promise<Pick<StreamingStatus, 'running' | 'layoutKind' | 'layoutId'>>
}

export interface StreamSourceServiceOptions {
  settingsStore: Pick<SettingsStore, 'getSettings' | 'setSettings'>
  listDashboards(): Promise<readonly DashboardSummary[]>
  listTouchPanels(): Promise<readonly ButtonBoxSummary[]>
  runtime: StreamSourceRuntime
  broadcast(channel: string, payload: unknown): void
  announceSettings?(settings: AppSettings): void
  createProfileId?: StreamTargetProfileIdFactory
}

function sourceError(descriptor: StreamSourceDescriptor | null, ref: StreamSourceRef): Error {
  const label = descriptor?.label ?? `${ref.kind}:${ref.id}`
  switch (descriptor?.reason) {
    case 'hidden':
      return new Error(`${label} is hidden. Make it visible before adding or streaming it.`)
    case 'built-in':
      return new Error(`${label} is a built-in dashboard. Duplicate or save it as a user dashboard first.`)
    case 'invalid-id':
      return new Error(`${label} has an invalid streaming source ID.`)
    case 'missing':
      return new Error(`${label} is missing. Remove or repair the saved reference in Manage streaming sources.`)
    default:
      return new Error(`Streaming source not found: ${ref.kind}:${ref.id}`)
  }
}

function removeSourceProfiles(
  settings: StreamTargetSettings,
  ref: StreamSourceRef
): StreamTargetSettings {
  let next = settings
  for (const profile of settings.profiles) {
    if (profile.kind === ref.kind && profile.sourceId === ref.id) {
      next = deleteStreamTargetProfile(next, profile.id)
    }
  }
  return next
}

function refSet(settings: StreamTargetSettings): Set<string> {
  return new Set(streamSourceRefsFromSettings(settings).map(streamTargetSourceKey))
}

export class StreamSourceService {
  private operationTail: Promise<void> = Promise.resolve()

  constructor(private readonly options: StreamSourceServiceOptions) {}

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation, operation)
    this.operationTail = run.then(() => undefined, () => undefined)
    return run
  }

  list(): Promise<StreamSourceDescriptor[]> {
    return this.runExclusive(() => this.listCurrent())
  }

  listCurrent(): Promise<StreamSourceDescriptor[]> {
    return this.describeCurrent()
  }

  assertAllowed(ref: StreamSourceRef): Promise<StreamSourceDescriptor> {
    return this.runExclusive(() => this.assertAllowedCurrent(ref))
  }

  async assertAllowedCurrent(ref: StreamSourceRef): Promise<StreamSourceDescriptor> {
    const descriptor = (await this.describeCurrent()).find((candidate) =>
      candidate.kind === ref.kind && candidate.id === ref.id
    ) ?? null
    if (!descriptor) throw sourceError(null, ref)
    if (!descriptor.added) {
      throw new Error(`Add ${descriptor.label} in Manage streaming sources before starting it.`)
    }
    if (!descriptor.eligible) throw sourceError(descriptor, ref)
    return descriptor
  }

  add(ref: StreamSourceRef): Promise<StreamSourceDescriptor[]> {
    return this.runExclusive(async () => {
      const settings = this.options.settingsStore.getSettings()
      const catalog = await this.describe(settings.streamTargets, true)
      const descriptor = catalog.find((candidate) =>
        candidate.kind === ref.kind && candidate.id === ref.id
      ) ?? null
      if (!descriptor || !descriptor.eligible) throw sourceError(descriptor, ref)
      if (descriptor.added) return catalog

      const added = addStreamTargetProfile(
        settings.streamTargets,
        { kind: descriptor.kind, id: descriptor.id, label: descriptor.label },
        descriptor.label,
        this.options.createProfileId
      )
      const streamTargets = {
        ...added,
        selectedProfileId: settings.streamTargets.selectedProfileId ?? added.selectedProfileId
      }
      const saved = this.options.settingsStore.setSettings({ streamTargets })
      this.options.announceSettings?.(saved)
      return this.publishCurrent()
    })
  }

  remove(ref: StreamSourceRef): Promise<StreamSourceDescriptor[]> {
    return this.runExclusive(async () => {
      const settings = this.options.settingsStore.getSettings()
      if (!streamSourceIsAdded(settings.streamTargets, ref)) return this.describe(settings.streamTargets)
      const streamTargets = removeSourceProfiles(settings.streamTargets, ref)
      await this.stopIfSourceRemoved(settings.streamTargets, streamTargets)
      const saved = this.options.settingsStore.setSettings({ streamTargets })
      this.options.announceSettings?.(saved)
      return this.publishCurrent()
    })
  }

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.runExclusive(async () => {
      const current = this.options.settingsStore.getSettings()
      const streamTargets = normalizeStreamTargetSettings(patch.streamTargets)
      this.assertSourceMembershipUnchanged(current.streamTargets, streamTargets)
      const saved = this.options.settingsStore.setSettings({ ...patch, streamTargets })
      await this.publishCurrent()
      return saved
    })
  }

  refreshAfterRegistryChange(): Promise<StreamSourceDescriptor[]> {
    return this.runExclusive(async () => {
      const descriptors = await this.describeCurrent()
      const active = descriptors.find((descriptor) => descriptor.active) ?? null
      if (active && (!active.added || !active.eligible)) {
        try {
          await this.options.runtime.stop()
        } catch (error) {
          await this.publishCurrent()
          throw error
        }
      }
      return this.publishCurrent()
    })
  }

  private assertSourceMembershipUnchanged(
    previous: StreamTargetSettings,
    next: StreamTargetSettings
  ): void {
    const previousRefs = refSet(previous)
    const nextRefs = refSet(next)
    if (
      previousRefs.size !== nextRefs.size ||
      [...previousRefs].some((key) => !nextRefs.has(key))
    ) {
      throw new Error(
        'Streaming source membership changed. Use Manage streaming sources to add or remove sources, then retry the profile edit.'
      )
    }
  }

  private async stopIfSourceRemoved(
    previous: StreamTargetSettings,
    next: StreamTargetSettings
  ): Promise<void> {
    const status = await this.options.runtime.status()
    if (!status.running) return
    const active = { kind: status.layoutKind, id: status.layoutId }
    if (!streamSourceIsAdded(previous, active) || streamSourceIsAdded(next, active)) return
    const stopped = await this.options.runtime.stop()
    if (stopped.running) {
      throw new Error(`Stop streaming before removing the active source ${active.kind}:${active.id}.`)
    }
  }

  private async describeCurrent(): Promise<StreamSourceDescriptor[]> {
    return this.describe(this.options.settingsStore.getSettings().streamTargets)
  }

  private async describe(
    settings: StreamTargetSettings,
    includeUnaddedIneligible = false
  ): Promise<StreamSourceDescriptor[]> {
    const [dashboards, touchPanels, status] = await Promise.all([
      this.options.listDashboards(),
      this.options.listTouchPanels(),
      this.options.runtime.status()
    ])
    return buildStreamSourceDescriptors(
      dashboards,
      touchPanels,
      settings,
      status,
      { includeUnaddedIneligible }
    )
  }

  async publishCurrent(): Promise<StreamSourceDescriptor[]> {
    const descriptors = await this.describeCurrent()
    this.options.broadcast(STREAM_SOURCE_CHANNELS.updated, descriptors)
    return descriptors
  }
}

let liveService: StreamSourceService | null = null

function requireService(): StreamSourceService {
  if (!liveService) throw new Error('Streaming source management is unavailable.')
  return liveService
}

export function runWithStreamSourceLock<T>(operation: () => Promise<T>): Promise<T> {
  return requireService().runExclusive(operation)
}

export function assertStreamSourceAllowedCurrent(ref: StreamSourceRef): Promise<StreamSourceDescriptor> {
  return requireService().assertAllowedCurrent(ref)
}

export function assertStreamSourceAllowed(ref: StreamSourceRef): Promise<StreamSourceDescriptor> {
  return requireService().assertAllowed(ref)
}

export function listStreamSourceDescriptors(): Promise<StreamSourceDescriptor[]> {
  return requireService().list()
}

export function listStreamSourceDescriptorsCurrent(): Promise<StreamSourceDescriptor[]> {
  return requireService().listCurrent()
}

export function updateAppSettingsWithStreamTargets(patch: Partial<AppSettings>): Promise<AppSettings> {
  return requireService().updateSettings(patch)
}

export async function broadcastStreamSourceRuntimeChangedCurrent(): Promise<void> {
  if (!liveService) return
  await liveService.publishCurrent()
}

export function register(
  ctx: ModuleContext,
  settingsStore: SettingsStore,
  runtime: StreamSourceRuntime
): StreamSourceService {
  const service = new StreamSourceService({
    settingsStore,
    listDashboards: async () => {
      const manager = getDashboardManager()
      if (!manager) return []
      await manager.load()
      return manager.list()
    },
    listTouchPanels: async () => {
      const manager = getTouchPanelManager()
      if (!manager) return []
      await manager.load()
      return manager.list()
    },
    runtime,
    broadcast: (channel, payload) => ctx.broadcast(channel, payload),
    announceSettings: (settings) => {
      settingsEvents.emitChanged(settings)
      ctx.broadcast('app:settingsChanged', settings)
    }
  })
  liveService = service

  ctx.ipcMain.handle(STREAM_SOURCE_CHANNELS.list, () => service.list())
  ctx.ipcMain.handle(STREAM_SOURCE_CHANNELS.add, (_event, raw: unknown) => {
    const request = parseStreamSourceMutationRequest(raw)
    if (!request) throw new Error('Invalid streaming source add request.')
    return service.add(request)
  })
  ctx.ipcMain.handle(STREAM_SOURCE_CHANNELS.remove, (_event, raw: unknown) => {
    const request = parseStreamSourceRemovalRequest(raw)
    if (!request) throw new Error('Invalid streaming source remove request.')
    return service.remove(request)
  })

  const unsubscribeRegistry = streamSourceRegistryEvents.onChanged(() => {
    void service.refreshAfterRegistryChange().catch((error) => {
      logger.warn('streaming', 'failed to refresh streaming source catalog', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  })
  ctx.app.once('before-quit', () => {
    unsubscribeRegistry()
    if (liveService === service) liveService = null
  })
  return service
}
