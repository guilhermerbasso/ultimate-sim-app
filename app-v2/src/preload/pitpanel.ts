import { contextBridge, ipcRenderer } from 'electron'

// Dedicated preload for the touch Pit & Command BrowserWindow. Exposes ONLY the
// generic `window.ipc` bridge with a tight allowlist: iRacing broadcast commands
// (`iracing:`), live telemetry (`telemetry:`) and the panel's own window control
// (`app:pitpanel:`). It never sees `window.api` (the full serial/profile surface)
// nor the broader `app:` namespace.

const EXACT_CHANNELS = new Set(['app:getSettings', 'app:settingsChanged'])
const ALLOWED_PREFIXES = ['iracing:', 'telemetry:', 'app:pitpanel:']

function isAllowed(channel: string): boolean {
  return EXACT_CHANNELS.has(channel) || ALLOWED_PREFIXES.some((prefix) => channel.startsWith(prefix))
}

const ipc = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!isAllowed(channel)) return Promise.reject(new Error(`Canal IPC não permitido para pit panel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  subscribe(channel: string, callback: (payload: unknown) => void): () => void {
    if (!isAllowed(channel)) return () => {}
    const listener = (_event: unknown, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener as never)
    return () => {
      ipcRenderer.off(channel, listener as never)
    }
  }
}

contextBridge.exposeInMainWorld('ipc', ipc)
