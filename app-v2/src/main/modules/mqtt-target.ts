import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'
import {
  buildMosquittoAclFiles,
  buildMosquittoLoopbackConfig,
  DEFAULT_MQTT_LOCAL_CONFIG,
  MQTT_CHANNELS,
  normalizeMqttLocalConfig,
  stableMqttJson,
  type MqttCommandCapability,
  type MqttLocalConfig,
  type MqttTargetStatus
} from '../../shared/mqtt'
import type { ModuleContext } from '../module-context'
import {
  buildMosquittoPasswordFiles,
  buildMqttClientAccessDocument,
  createMqttBrokerAccessSet,
  parseMqttBrokerAccessSet,
  type MqttBrokerAccessSet,
  type MqttTransportAccess
} from '../mqtt/broker-auth'
import { createMqttJsTransport } from '../mqtt/mqttjs-transport'
import { MqttCertificationTarget, type MqttCommandHandler } from '../mqtt/target'
import { getOverlayManager } from './overlays-core'
import { logger } from './logger'

const CONFIG_FILE = 'mqtt-target.json'
const BROKER_SETUP_DIRECTORY = 'mqtt-broker-v1'
const BROKER_ACCESS_FILE = 'broker-access.bin'

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

export class MqttBrokerSetupStore {
  readonly setupDirectory: string
  private accessPromise: Promise<MqttBrokerAccessSet> | null = null

  constructor(userDataPath: string) {
    this.setupDirectory = join(userDataPath, BROKER_SETUP_DIRECTORY)
  }

  async prepare(config: MqttLocalConfig): Promise<MqttTransportAccess> {
    const access = await this.access()
    const files: Record<string, string | Buffer> = {
      'mosquitto-loopback.conf': `${buildMosquittoLoopbackConfig(config)}\n`,
      ...buildMosquittoAclFiles(config),
      ...buildMosquittoPasswordFiles(access),
      'mqtt-client-access.json': `${JSON.stringify(buildMqttClientAccessDocument(config, access), null, 2)}\n`,
      'README.txt': [
        'Ultimate Sim App local MQTT v1 broker bundle',
        '',
        'Start Mosquitto from this directory:',
        '  mosquitto -c mosquitto-loopback.conf -v',
        '',
        'mqtt-client-access.json contains only the read-only integration role',
        'and, when enabled, the allowlisted non-driving command role.',
        'The publisher role secret remains OS-encrypted and is never exported.',
        ''
      ].join('\n')
    }
    await mkdir(this.setupDirectory, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(this.setupDirectory, name), content, { mode: 0o600 })
    }
    return { ...access['target-publisher'] }
  }

  private access(): Promise<MqttBrokerAccessSet> {
    if (!this.accessPromise) {
      this.accessPromise = this.loadOrCreate().catch((error) => {
        this.accessPromise = null
        throw error
      })
    }
    return this.accessPromise
  }

  private encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private async loadOrCreate(): Promise<MqttBrokerAccessSet> {
    if (!this.encryptionAvailable()) {
      throw new Error('OS-protected storage is required for local MQTT broker access.')
    }
    const filePath = join(this.setupDirectory, BROKER_ACCESS_FILE)
    try {
      const cipher = await readFile(filePath)
      const parsed = parseMqttBrokerAccessSet(
        JSON.parse(safeStorage.decryptString(cipher)) as unknown
      )
      if (parsed) return parsed
    } catch {
      await unlink(filePath).catch(() => undefined)
    }

    const access = createMqttBrokerAccessSet()
    await mkdir(this.setupDirectory, { recursive: true })
    await writeFile(
      filePath,
      safeStorage.encryptString(JSON.stringify(access)),
      { mode: 0o600 }
    )
    return access
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
  const userDataPath = ctx.app.getPath('userData')
  const store = new MqttConfigStore(join(userDataPath, CONFIG_FILE))
  const brokerSetup = new MqttBrokerSetupStore(userDataPath)
  let lastStatusBroadcastAt = 0
  let lastBroadcastState = ''
  const target = new MqttCertificationTarget(createMqttJsTransport, {
    commandHandlers: commandHandlers(),
    setupDirectory: brokerSetup.setupDirectory,
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
    const config = normalizeMqttLocalConfig(input)
    const access = config.enabled ? await brokerSetup.prepare(config) : undefined
    await store.save(config)
    const status = await target.start(config, access)
    logger.info('mqtt', config.enabled ? 'local MQTT target enabled' : 'local MQTT target disabled', {
      instanceId: config.instanceId,
      host: config.host,
      port: config.port,
      commandsEnabled: config.commandsEnabled
    })
    return status
  })
  ctx.ipcMain.handle(MQTT_CHANNELS.reconnect, () => target.reconnect())

  void (async () => {
    const config = await store.load()
    try {
      const access = config.enabled ? await brokerSetup.prepare(config) : undefined
      await target.start(config, access)
    } catch (error) {
      logger.warn('mqtt', 'failed to load local MQTT target config', {
        message: error instanceof Error ? error.message : String(error)
      })
      await target.start(config)
    }
  })()

  ctx.registerGracefulTeardown(async () => {
    ctx.telemetryHub.off('snapshot', onTelemetry)
    await target.stop()
  }, 'quiesce')
}
