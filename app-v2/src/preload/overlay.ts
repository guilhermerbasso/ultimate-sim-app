import { contextBridge, ipcRenderer } from 'electron'

// Minimal preload dedicated to overlay BrowserWindows. It exposes ONLY the
// generic `window.ipc` bridge — overlays must never see `window.api` (the full
// ButtonBox serial / profile surface) because they run untrusted layouts in
// always-on-top click-through windows.

const ALLOWED_PREFIXES = [
  'telemetry:',
  'overlays:',
  'fuel:',
  'lap:',
  'alerts:',
  'outputs:',
  'expr:',
  'trackmap:',
  'coach:',
  'predictions:',
  'tire:',
  'teamfuel:'
]

const ALLOWED_APP_CHANNELS = new Set([
  'app:dash:get',
  'app:dash:updated',
  'app:dash:cycle',
  'app:dash:cycleControl',
  'app:dash:cycleControl:get',
  // Kiosk long-press exit closes the dashboard window via the existing handler.
  'app:dash:close'
])

function isAllowed(channel: string): boolean {
  return ALLOWED_APP_CHANNELS.has(channel) || ALLOWED_PREFIXES.some((prefix) => channel.startsWith(prefix))
}

const ipc = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!isAllowed(channel)) return Promise.reject(new Error(`Canal IPC não permitido para overlay: ${channel}`))
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
