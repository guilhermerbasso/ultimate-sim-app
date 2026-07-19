import { contextBridge, ipcRenderer } from 'electron'
import { isOverlayIpcAllowed } from './ipc-allowlists'

// Minimal preload dedicated to overlay BrowserWindows. It exposes ONLY the
// generic `window.ipc` bridge — overlays must never see `window.api` (the full
// ButtonBox serial / profile surface) because they run untrusted layouts in
// always-on-top click-through windows.

const ipc = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!isOverlayIpcAllowed(channel)) return Promise.reject(new Error(`Canal IPC não permitido para overlay: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  subscribe(channel: string, callback: (payload: unknown) => void): () => void {
    if (!isOverlayIpcAllowed(channel)) return () => {}
    const listener = (_event: unknown, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener as never)
    return () => {
      ipcRenderer.off(channel, listener as never)
    }
  }
}

contextBridge.exposeInMainWorld('ipc', ipc)
