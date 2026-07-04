import { contextBridge, ipcRenderer } from 'electron'

// Dedicated preload for the fullscreen RGB button-box window. Exposes ONLY the
// generic `window.ipc` bridge with a TIGHT allowlist: the exact channels a button
// panel can ever fire — iRacing broadcast (`iracing:command`), a single keyboard
// macro emulation (`actions:testEmulation`), playlist cycling (`app:dash:cycle`),
// OLED page + overlay toggles (`oled:setActivePage`, `overlays:toggle`) — plus the
// panel's own window control / data + live-update events (`app:touchpanel:*`).
// It deliberately does NOT grant the whole `actions:` prefix, so the fullscreen
// window can never reach `actions:setBindings` / `actions:trigger`. It never sees
// `window.api`.

const EXACT_CHANNELS = new Set<string>([
  'iracing:command',
  'actions:testEmulation',
  'app:dash:cycle',
  'oled:setActivePage',
  'overlays:toggle'
])

const ALLOWED_PREFIXES = ['app:touchpanel:']

function isAllowed(channel: string): boolean {
  if (EXACT_CHANNELS.has(channel)) return true
  return ALLOWED_PREFIXES.some((prefix) => channel.startsWith(prefix))
}

const ipc = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!isAllowed(channel)) return Promise.reject(new Error(`Canal IPC não permitido para touch panel: ${channel}`))
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
