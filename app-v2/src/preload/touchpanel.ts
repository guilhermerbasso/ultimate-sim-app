import { contextBridge, ipcRenderer } from 'electron'
import { isTouchpanelIpcAllowed } from './ipc-allowlists'

// Dedicated preload for the fullscreen RGB button-box window. Exposes ONLY the
// generic `window.ipc` bridge with a TIGHT allowlist: the exact channels a button
// panel can ever fire — iRacing broadcast (`iracing:command`), a single keyboard
// macro emulation (`actions:testEmulation`), playlist cycling (`app:dash:cycle`),
// OLED page + overlay toggles (`oled:setActivePage`, `overlays:toggle`), read-only
// expression/results channels, plus the panel's own window control / data +
// live-update events (`app:touchpanel:*`).
// It deliberately does NOT grant the whole `actions:` prefix, so the fullscreen
// window can never reach `actions:setBindings` / `actions:trigger`. It never sees
// `window.api`.

const ipc = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!isTouchpanelIpcAllowed(channel)) return Promise.reject(new Error(`Canal IPC não permitido para touch panel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  subscribe(channel: string, callback: (payload: unknown) => void): () => void {
    if (!isTouchpanelIpcAllowed(channel)) return () => {}
    const listener = (_event: unknown, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener as never)
    return () => {
      ipcRenderer.off(channel, listener as never)
    }
  }
}

contextBridge.exposeInMainWorld('ipc', ipc)
