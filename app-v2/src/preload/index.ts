import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  ButtonBoxApi,
  Config,
  ConfigPatch,
  DeviceInfo,
  EncoderEvent,
  Mapping,
  MappingPatch,
  PortInfo,
  ProfilePayload,
  ProfileRecord,
  ProfileSummary
} from '../shared/ipc'

const api: ButtonBoxApi = {
  // Device protocol (SIM-X / SimHub) ──────────────────────────────────────────
  listPorts: (): Promise<PortInfo[]> => ipcRenderer.invoke('buttonbox:listPorts'),
  connect: (path: string): Promise<DeviceInfo> => ipcRenderer.invoke('buttonbox:connect', path),
  disconnect: (): Promise<void> => ipcRenderer.invoke('buttonbox:disconnect'),
  sendOled: (line1: string, line2: string, line3: string): Promise<void> =>
    ipcRenderer.invoke('buttonbox:sendOled', line1, line2, line3),
  sendBigNum: (value: string): Promise<void> => ipcRenderer.invoke('buttonbox:sendBigNum', value),
  sendRevLevel: (level: number): Promise<void> => ipcRenderer.invoke('buttonbox:sendRevLevel', level),
  sendShiftBlink: (active: boolean): Promise<void> => ipcRenderer.invoke('buttonbox:sendShiftBlink', active),
  sendStartLed: (on: boolean): Promise<void> => ipcRenderer.invoke('buttonbox:sendStartLed', on),
  runSelfTest: (): Promise<void> => ipcRenderer.invoke('buttonbox:selfTest'),
  onEncoder: (callback: (event: EncoderEvent) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: EncoderEvent): void => callback(payload)
    ipcRenderer.on('buttonbox:encoder', listener)
    return () => {
      ipcRenderer.off('buttonbox:encoder', listener)
    }
  },
  getStatus: (): Promise<DeviceInfo | null> => ipcRenderer.invoke('buttonbox:getStatus'),
  onConnectionChange: (callback: (device: DeviceInfo | null) => void): (() => void) => {
    const onConnected = (_event: IpcRendererEvent, info: DeviceInfo): void => callback(info)
    const onDisconnected = (): void => callback(null)
    ipcRenderer.on('buttonbox:connected', onConnected)
    ipcRenderer.on('buttonbox:disconnected', onDisconnected)
    return () => {
      ipcRenderer.off('buttonbox:connected', onConnected)
      ipcRenderer.off('buttonbox:disconnected', onDisconnected)
    }
  },

  // Legacy (kept inert for App.tsx + ProfilesView.tsx + on-disk profiles) ─────
  ping: (): Promise<void> => ipcRenderer.invoke('buttonbox:ping'),
  getMapping: (): Promise<Mapping> => ipcRenderer.invoke('buttonbox:getMapping'),
  setMapping: (mapping: MappingPatch | Partial<Mapping>): Promise<void> =>
    ipcRenderer.invoke('buttonbox:setMapping', mapping),
  getConfig: (): Promise<Config> => ipcRenderer.invoke('buttonbox:getConfig'),
  setConfig: (config: ConfigPatch): Promise<void> => ipcRenderer.invoke('buttonbox:setConfig', config),
  saveToDevice: (): Promise<void> => ipcRenderer.invoke('buttonbox:saveToDevice'),
  loadFromDevice: (): Promise<void> => ipcRenderer.invoke('buttonbox:loadFromDevice'),
  resetToDefaults: (): Promise<void> => ipcRenderer.invoke('buttonbox:resetToDefaults'),
  sendOledPreview: (line: string): Promise<void> => ipcRenderer.invoke('buttonbox:sendOledPreview', line),
  listProfiles: (): Promise<ProfileSummary[]> => ipcRenderer.invoke('buttonbox:listProfiles'),
  saveProfile: (name: string, data: ProfilePayload): Promise<ProfileRecord> =>
    ipcRenderer.invoke('buttonbox:saveProfile', name, data),
  loadProfile: (name: string): Promise<ProfileRecord> => ipcRenderer.invoke('buttonbox:loadProfile', name),
  deleteProfile: (name: string): Promise<void> => ipcRenderer.invoke('buttonbox:deleteProfile', name),
  applyProfileToDevice: (data: ProfilePayload): Promise<void> =>
    ipcRenderer.invoke('buttonbox:applyProfileToDevice', data)
}

contextBridge.exposeInMainWorld('api', api)

// ─── Ponte IPC genérica (window.ipc) — inalterada ─────────────────────────────
// Mantém allowlist por prefixo. Inclui 'revlights:' (novo) para o engine de
// rev lights e 'buttonbox:' para canais relacionados a device (não usados por
// agora, mas mantidos para futura compatibilidade).
const ALLOWED_PREFIXES = [
  'telemetry:',
  'iracing:',
  'oled:',
  'overlays:',
  'fuel:',
  'lap:',
  'alerts:',
  'accessibilityCues:',
  'recording:',
  'actions:',
  'expr:',
  'profilesv2:',
  'revlights:',
  'arduino:',
  'devices:',
  'setup:',
  'arduinosetup:',
  'outputs:',
  'trackmap:',
  'app:',
  'soundshift:',
  'setups:',
  'tire:',
  'pinout:',
  'rgbmatrix:',
  'esp32:',
  'career:',
  'drivers:',
  'spotter:',
  'engineer:',
  'tts:',
  'haptics:',
  'teamfuel:',
  'paints:',
  'coach:',
  'predictions:',
  'debrief:',
  'pacemodel:',
  'search:',
  'strategy:',
  'incidents:',
  'community:',
  'dashai:',
  'bio:',
  'hapticsZonal:',
  'iflagDynamic:',
  'spotter3d:',
  'stt:',
  'streaming:',
  'simhub:',
  // ─── Config EXPORT/IMPORT + saved-state VIEW/DELETE (perfil completo, por
  //     seção, listSaved/deleteSection/resetSection, changed broadcast) ──────────
  'config:',
  // ─── Diagnostic LOGS (write/export/open/info) — 24h rolling logger ──────────
  'logs:',
  // ─── One-click bug report: collect last-2h logs + open a prefilled GH issue ──
  'bug:'
]

function isAllowed(channel: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => channel.startsWith(prefix))
}

const ipc = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!isAllowed(channel)) return Promise.reject(new Error(`Canal IPC não permitido: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  subscribe(channel: string, callback: (payload: unknown) => void): () => void {
    if (!isAllowed(channel)) return () => {}
    const listener = (_event: IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.off(channel, listener)
    }
  }
}

contextBridge.exposeInMainWorld('ipc', ipc)
