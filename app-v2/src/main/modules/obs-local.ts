import {
  OBS_LOCAL_CHANNELS,
  OBS_LOCAL_PROTOCOL_VERSION,
  type ObsLocalCommand,
  type ObsLocalConnectArgs,
  type ObsLocalFeedStartArgs,
  type ObsLocalStatus
} from '../../shared/obs-local'
import type { ModuleContext } from '../module-context'
import { ObsLocalController } from '../obs-local/controller'
import { ObsWebSocketV5Adapter } from '../obs-local/ws-adapter'
import { start as startStreaming, status as streamingStatus, stop as stopStreaming } from './streaming'

export function register(ctx: ModuleContext): void {
  const controller = new ObsLocalController({
    adapterFactory: () => new ObsWebSocketV5Adapter(),
    getTelemetry: () => ctx.telemetryHub.getLatest()
  })

  const status = async (): Promise<ObsLocalStatus> => {
    const stream = await streamingStatus(false)
    const feedRunning = stream.running && stream.profile === 'obs-local'
    return {
      protocolVersion: OBS_LOCAL_PROTOCOL_VERSION,
      feed: {
        running: feedRunning,
        url: feedRunning ? stream.url : null,
        bindAddress: feedRunning && stream.bindAddress === '127.0.0.1' ? '127.0.0.1' : null,
        port: feedRunning ? stream.port : null,
        portMode: feedRunning ? stream.portMode : null,
        allowedLayoutIds: feedRunning ? [...stream.allowedLayoutIds] : [],
        readOnly: true,
        clients: feedRunning ? stream.clients : 0,
        health: feedRunning ? 'fresh' : 'offline'
      },
      control: controller.status()
    }
  }

  ctx.ipcMain.handle(OBS_LOCAL_CHANNELS.startFeed, async (_event, args: ObsLocalFeedStartArgs) => {
    if (!args || typeof args.layoutId !== 'string' || !args.layoutId.trim()) {
      throw new Error('Select a dashboard for the OBS Browser Source feed.')
    }
    await startStreaming(ctx, {
      profile: 'obs-local',
      accessMode: 'local',
      layoutKind: 'dashboard',
      layoutId: args.layoutId.trim(),
      port: args.port,
      streamSafe: true
    })
    return status()
  })
  ctx.ipcMain.handle(OBS_LOCAL_CHANNELS.stopFeed, async () => {
    const stream = await streamingStatus(false)
    if (stream.running && stream.profile === 'obs-local') await stopStreaming()
    return status()
  })
  ctx.ipcMain.handle(OBS_LOCAL_CHANNELS.connect, async (_event, args: ObsLocalConnectArgs) => {
    await controller.connect(args)
    return status()
  })
  ctx.ipcMain.handle(OBS_LOCAL_CHANNELS.disconnect, async () => {
    await controller.disconnect()
    return status()
  })
  ctx.ipcMain.handle(OBS_LOCAL_CHANNELS.command, async (_event, command: ObsLocalCommand) => {
    return controller.execute(command)
  })
  ctx.ipcMain.handle(OBS_LOCAL_CHANNELS.refreshHealth, async () => {
    await controller.refreshHealth()
    return status()
  })
  ctx.ipcMain.handle(OBS_LOCAL_CHANNELS.setManualOverride, async (_event, enabled: boolean) => {
    controller.setManualOverride(enabled === true)
    return status()
  })
  ctx.ipcMain.handle(OBS_LOCAL_CHANNELS.status, () => status())

  ctx.registerGracefulTeardown(async () => {
    await controller.shutdown()
    const stream = await streamingStatus(false)
    if (stream.running && stream.profile === 'obs-local') await stopStreaming()
  }, 'quiesce')
}
