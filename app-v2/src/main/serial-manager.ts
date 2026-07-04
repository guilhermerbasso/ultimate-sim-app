import { EventEmitter } from 'node:events'
import { EVENT_ORDER } from '../shared/ipc'
import type {
  Config,
  ConfigPatch,
  DeviceInfo,
  Mapping,
  MappingPatch,
  MappingValues,
  PortInfo,
  ProfilePayload
} from '../shared/ipc'
import type { SerialDeviceSummary, SerialTxOrigin } from '../shared/arduino'
import type { SerialDevice } from './serial/device'
import { REV_LEVEL_MAX } from './protocol'
import { PRIMARY_DEVICE_ID, SerialHub } from './serial/hub'

const UNSUPPORTED_FIRMWARE_MESSAGE =
  'Operação não suportada pelo firmware SIM-X — remapeamento HID/perfis ficam só no app, e os botões físicos são reatribuídos diretamente no iRacing.'

// Self-test pacing. A full up+down rev sweep over REV_LEVEL_MAX LEDs at this
// step takes ~1s — long enough for the user to see every LED light in sequence,
// short enough to feel instant. Kept well under the 20Hz serial floor.
const SELF_TEST_STEP_MS = 70
const SELF_TEST_BLINK_MS = 180

// 'resync': synthetic SerialManager event (NOT a device passthrough). Emitted
// after a (re)connect and after a manual self-test, when the box output state
// was driven directly and the rev-lights/OLED engines must re-assert their
// current enabled state (the Pro Micro resets to its boot state on port open,
// and the self-test overwrites the strip/OLED).
export type SerialManagerEvent = 'encoder' | 'disconnect' | 'error' | 'rx' | 'tx' | 'connect' | 'resync' | 'user-disconnect'

const PASSTHROUGH_EVENTS: SerialManagerEvent[] = ['rx', 'tx', 'connect', 'disconnect', 'error', 'encoder']

// SerialManager keeps the legacy single-device API (events: rx/tx/connect/
// disconnect/error/encoder; commands: sendRevLevel/sendShiftBlink/sendOled/
// sendBigNum/sendStartLed/sendRaw; lifecycle: connect/disconnect/listPorts;
// streaming aliases; legacy inert shims) and delegates everything to the
// PRIMARY device on a SerialHub. Existing modules (revlights engine, OLED
// engine, arduino module, buttonbox:* IPC) continue to talk to the SIM-X
// box through ctx.serialManager exactly as before.
//
// Multi-device callers should target ctx.serialHub directly:
//   ctx.serialHub.connectDevice({ path, kind: 'generic' })
//   ctx.serialHub.getDevice(id)?.sendRaw('...')
//   ctx.serialHub.on('device-added' | 'device-removed' | 'device-updated', ...)
export class SerialManager extends EventEmitter {
  private boundDevice: SerialDevice | null = null
  private boundUnbinders: Array<() => void> = []

  constructor(public readonly hub: SerialHub = new SerialHub()) {
    super()
    // Spontaneous disconnects (cable yanked, port error, hub.disconnectAll)
    // reach us via the hub. Drop our cached primary subscriptions so the next
    // connect() rebinds cleanly.
    this.hub.on('device-removed', (summary: SerialDeviceSummary) => {
      if (this.boundDevice && summary.id === this.boundDevice.id) {
        this.unbindPrimary()
      }
    })
  }

  async listPorts(): Promise<PortInfo[]> {
    return this.hub.listPorts()
  }

  async connect(path: string): Promise<DeviceInfo> {
    // connectDevice with `primary: true` evicts any existing primary first,
    // matching the old SerialManager behaviour of "one session at a time".
    const device = await this.hub.connectDevice({
      path,
      id: PRIMARY_DEVICE_ID,
      kind: 'sim-x',
      label: 'SIM-X Button Box',
      primary: true
    })
    this.bindPrimary(device)
    const info = device.getDeviceInfo()
    if (!info) throw new Error('Falha ao conectar: DeviceInfo não disponível.')
    // The device already emitted its own 'connect' INSIDE hub.connectDevice()
    // above — before bindPrimary() wired the passthrough — so facade listeners
    // registered at startup (e.g. the Arduino module re-applying the saved
    // encoder detent threshold after the Pro Micro resets on USB open) would
    // otherwise never receive it. Replay it once now.
    this.emit('connect', info)
    // Prove the serial output link immediately: a brief rev-lights sweep + an
    // OLED "connected" message the user sees on the hardware. Fire-and-forget so
    // connect() resolves instantly for the UI; the self-test ends by emitting
    // 'resync' so the rev-lights/OLED engines re-assert their enabled state.
    void this.runSelfTest().catch((error) => {
      console.warn('[serial-manager] connect self-test skipped:', error instanceof Error ? error.message : error)
    })
    return info
  }

  async disconnect(): Promise<void> {
    // Signal user intent BEFORE the port closes so the SIM-X auto-start coordinator can
    // tell a deliberate disconnect (don't auto-reconnect — e.g. to flash firmware) from
    // a spontaneous cable drop.
    this.emit('user-disconnect')
    const primary = this.hub.getPrimary()
    if (primary) await this.hub.disconnectDevice(primary.id)
  }

  isConnected(): boolean {
    return Boolean(this.hub.getPrimary()?.isOpen())
  }

  getDevice(): DeviceInfo | null {
    return this.hub.getPrimary()?.getDeviceInfo() ?? null
  }

  // ─── Device commands (SimHub protocol on the PRIMARY device) ────────────────
  async sendRevLevel(level: number): Promise<void> {
    await this.requirePrimary().sendRevLevel(level)
  }

  async sendShiftBlink(active: boolean): Promise<void> {
    await this.requirePrimary().sendShiftBlink(active)
  }

  async sendOled(line1: string, line2: string, line3: string): Promise<void> {
    await this.requirePrimary().sendOled(line1, line2, line3)
  }

  async sendBigNum(value: string): Promise<void> {
    await this.requirePrimary().sendBigNum(value)
  }

  async sendStartLed(on: boolean): Promise<void> {
    await this.requirePrimary().sendStartLed(on)
  }

  async sendRaw(command: string, origin: SerialTxOrigin = 'engine'): Promise<void> {
    await this.requirePrimary().sendRaw(command, origin)
  }

  // Visible output self-test: sweeps the rev LEDs up and down, flashes the shift
  // indicator + START LED, and writes a "connected" message to the OLED. Lets
  // the user confirm the serial OUTPUT path (rev lights + OLED) works WITHOUT
  // iRacing running — input (HID buttons) is independent of this link. Throws a
  // clear error when no SIM-X is connected so the UI can surface it. Always ends
  // by emitting 'resync' so the rev-lights/OLED engines restore their state.
  async runSelfTest(): Promise<void> {
    const device = this.requirePrimary()
    try {
      await device.sendStartLed(true)
      await device.sendOled('SIM-X CONECTADO', 'Saida serial OK', `Porta ${device.path}`)
      for (let level = 0; level <= REV_LEVEL_MAX; level += 1) {
        await device.sendRevLevel(level)
        await delay(SELF_TEST_STEP_MS)
      }
      await device.sendShiftBlink(true)
      await delay(SELF_TEST_BLINK_MS)
      await device.sendShiftBlink(false)
      for (let level = REV_LEVEL_MAX; level >= 0; level -= 1) {
        await device.sendRevLevel(level)
        await delay(SELF_TEST_STEP_MS)
      }
      await device.sendRevLevel(0)
      await device.sendShiftBlink(false)
      await device.sendStartLed(false)
    } finally {
      // The strip/OLED were driven directly here; tell the engines to drop their
      // dedupe and re-push the current enabled state (live telemetry, if any).
      this.emit('resync')
    }
  }

  // ─── Streaming aliases (kept so the OLED dashboard engine code path stays put) ──
  // The new protocol session is always open between connect() and disconnect();
  // there is no separate "start/stop streaming" handshake any more, so these
  // are no-ops that succeed when a session exists.
  async startOledStreaming(): Promise<void> {
    if (!this.hub.getPrimary()?.isOpen()) {
      throw new Error('ButtonBox não conectado. Use Dispositivos > Conectar antes de iniciar o OLED.')
    }
  }

  async stopOledStreaming(): Promise<void> {
    // Keep the session open — disconnecting is an explicit user action.
  }

  async sendOledStreaming(payload: string): Promise<void> {
    const { line1, line2, line3 } = parseLegacyOledPayload(payload)
    await this.sendOled(line1, line2, line3)
  }

  async sendOledStreamingBigNum(value: string): Promise<void> {
    await this.sendBigNum(value)
  }

  // ─── Legacy methods preserved for App.tsx/ProfilesView.tsx compatibility ──
  // The SIM-X firmware doesn't speak any of the >ID?/MAP/CFG/SAVE protocol,
  // so these return inert defaults or fail loudly so the user knows.

  async ping(): Promise<void> {
    if (!this.hub.getPrimary()?.isOpen()) throw new Error('ButtonBox não conectado.')
  }

  async getMapping(): Promise<Mapping> {
    return {
      profileName: 'Dispositivo',
      values: createEmptyMappingValues(),
      entries: [],
      updatedAt: new Date().toISOString()
    }
  }

  async setMapping(_mapping: MappingPatch | Partial<Mapping>): Promise<void> {
    throw new Error(UNSUPPORTED_FIRMWARE_MESSAGE)
  }

  async getConfig(): Promise<Config> {
    return {
      pulse: 80,
      debounce: 50,
      encmode: 'pulse',
      updatedAt: new Date().toISOString()
    }
  }

  async setConfig(_config: ConfigPatch): Promise<void> {
    throw new Error(UNSUPPORTED_FIRMWARE_MESSAGE)
  }

  async saveToDevice(): Promise<void> {
    throw new Error(UNSUPPORTED_FIRMWARE_MESSAGE)
  }

  async loadFromDevice(): Promise<void> {
    // No-op: nothing to load from a stateless firmware.
  }

  async resetToDefaults(): Promise<void> {
    throw new Error(UNSUPPORTED_FIRMWARE_MESSAGE)
  }

  async sendOledPreview(line: string): Promise<void> {
    const { line1, line2, line3 } = parseLegacyOledPayload(line)
    await this.sendOled(line1, line2, line3)
  }

  async applyProfileToDevice(_profile: ProfilePayload): Promise<void> {
    throw new Error(UNSUPPORTED_FIRMWARE_MESSAGE)
  }

  // ─── Internals ────────────────────────────────────────────────────────────
  private requirePrimary(): SerialDevice {
    const device = this.hub.getPrimary()
    if (!device || !device.isOpen()) {
      throw new Error('ButtonBox não conectado. Use Dispositivos > Conectar antes de enviar comandos.')
    }
    return device
  }

  private bindPrimary(device: SerialDevice): void {
    this.unbindPrimary()
    for (const event of PASSTHROUGH_EVENTS) {
      const handler = (...args: unknown[]): void => {
        this.emit(event, ...args)
      }
      device.on(event, handler)
      this.boundUnbinders.push(() => device.off(event, handler))
    }
    this.boundDevice = device
  }

  private unbindPrimary(): void {
    const unbinders = this.boundUnbinders
    this.boundUnbinders = []
    for (const fn of unbinders) {
      try {
        fn()
      } catch {
        // Listener removal on a torn-down device is best-effort.
      }
    }
    this.boundDevice = null
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createEmptyMappingValues(): MappingValues {
  return Object.fromEntries(EVENT_ORDER.map((eventId) => [eventId, 0])) as MappingValues
}

function parseLegacyOledPayload(raw: string): { line1: string; line2: string; line3: string } {
  const trimmed = (raw ?? '').replace(/^TEXT:/i, '').replace(/^CLEAR$/i, '')
  const [line1 = '', line2 = '', line3 = ''] = trimmed.split('|')
  return { line1, line2, line3 }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
