import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DEFAULT_MQTT_LOCAL_CONFIG,
  MQTT_CHANNELS,
  normalizeMqttLocalConfig,
  stableMqttJson,
  type MqttCommandCapability,
  type MqttLocalConfig,
  type MqttTargetStatus
} from '../../shared/mqtt'
import type { ModuleContext } from '../module-context'
import { createMqttJsTransport } from '../mqtt/mqttjs-transport'
import { MqttCertificationTarget, type MqttCommandHandler } from '../mqtt/target'
import { getOverlayManager } from './overlays-core'
import { logger } from './logger'

const CONFIG_FILE = 'mqtt-target.json'

export class MqttConfigStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<MqttLocalConfig> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      return normalizeMqttLocalConfig(parsed)
    } catch {
      return { ...DEFAULT_MQTT_LOCAL_CONFIG }
    }
  }

  async save(configInput: unknown): Promise<MqttLocalConfig> {
    const config = normalizeMqttLocalConfig(configInput)
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.next`
    await writeFile(temporary, `${stableMqttJson(config)}\n`, 'utf8')
    try {
      await rename(temporary, this.filePath)
    } catch {
      await unlink(this.filePath).catch(() => undefined)
      await rename(temporary, this.filePath)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
    return config
  }
}

function overlayCommand(enabled: boolean): MqttCommandHandler {
  return async (args) => {
    const id = typeof args.id === 'string' ? args.id : ''
    if (!id) throw new Error('Overlay command requires an id argument.')
    const manager = getOverlayManager()
    if (!manager) throw new Error('Overlay manager is unavailable.')
    await manager.toggle(id as never, enabled)
    return `Overlay ${id} ${enabled ? 'shown' : 'hidden'}.`
  }
}

function commandHandlers(): Partial<Record<MqttCommandCapability, MqttCommandHandler>> {
  return {
    'app.overlay.show': overlayCommand(true),
    'app.overlay.hide': overlayCommand(false)
  }
}

export function register(ctx: ModuleContext): void {
  const store = new MqttConfigStore(join(ctx.app.getPath('userData'), CONFIG_FILE))
  let lastStatusBroadcastAt = 0
  let lastBroadcastState = ''
  const target = new MqttCertificationTarget(createMqttJsTransport, {
    commandHandlers: commandHandlers(),
    onStatus: (status) => {
      const now = Date.now()
      if (status.state === lastBroadcastState && now - lastStatusBroadcastAt < 250) return
      lastStatusBroadcastAt = now
      lastBroadcastState = status.state
      ctx.broadcast(MQTT_CHANNELS.statusChanged, status)
    }
  })

  const onTelemetry = (snapshot: Parameters<MqttCertificationTarget['ingestTelemetry']>[0]): void => {
    target.ingestTelemetry(snapshot)
  }
  ctx.telemetryHub.on('snapshot', onTelemetry)

  ctx.ipcMain.handle(MQTT_CHANNELS.getConfig, () => target.getConfig())
  ctx.ipcMain.handle(MQTT_CHANNELS.status, () => target.getStatus())
  ctx.ipcMain.handle(MQTT_CHANNELS.contract, () => target.getContract())
  ctx.ipcMain.handle(MQTT_CHANNELS.setConfig, async (_event, input: unknown): Promise<MqttTargetStatus> => {
    const config = await store.save(input)
    const status = await target.start(config)
    logger.info('mqtt', config.enabled ? 'local MQTT target enabled' : 'local MQTT target disabled', {
      instanceId: config.instanceId,
      host: config.host,
      port: config.port,
      commandsEnabled: config.commandsEnabled
    })
    return status
  })
  ctx.ipcMain.handle(MQTT_CHANNELS.reconnect, () => target.reconnect())

  void store
    .load()
    .then((config) => target.start(config))
    .catch((error) => {
      logger.warn('mqtt', 'failed to load local MQTT target config', {
        message: error instanceof Error ? error.message : String(error)
      })
    })

  ctx.registerGracefulTeardown(async () => {
    ctx.telemetryHub.off('snapshot', onTelemetry)
    await target.stop()
  }, 'quiesce')
}
