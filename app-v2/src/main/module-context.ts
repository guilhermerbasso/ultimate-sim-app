import type { App, BrowserWindow, IpcMain } from 'electron'
import type { IRacingControl } from './iracing/control'
import type { ProfileStore } from './profiles'
import type { SerialManager } from './serial-manager'
import type { SerialHub } from './serial/hub'
import type { TelemetryHub } from './telemetry/hub'

// Contexto compartilhado entregue a cada módulo no registro. Permite que módulos
// (telemetria, overlays, OLED, ações, etc.) registrem IPC e usem os serviços
// centrais SEM editar arquivos centrais — cada módulo vive nos próprios arquivos.
export interface ModuleContext {
  app: App
  ipcMain: IpcMain
  telemetryHub: TelemetryHub
  // Legacy single-device facade: wraps the PRIMARY (SIM-X) device on the hub.
  // Existing callers (revlights, OLED, arduino, buttonbox:* IPC) keep using
  // this exactly as before.
  serialManager: SerialManager
  // Multi-device fleet: use this to target a non-primary device (custom
  // serial outputs for alerts/expressions, extra Arduinos, etc.).
  serialHub: SerialHub
  profileStore: ProfileStore
  iracingControl: IRacingControl
  getMainWindow(): BrowserWindow | null
  // Envia um evento para TODAS as janelas (principal + overlays).
  broadcast(channel: string, payload: unknown): void
}
