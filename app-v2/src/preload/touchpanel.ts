import { contextBridge, ipcRenderer } from 'electron'
import { isTouchpanelIpcAllowed } from './ipc-allowlists'

// Dedicated preload for the fullscreen touch window. The shared allowlist grants
// only discrete actions, the keyboard hold lifecycle, read-only expression data,
// and the panel's own read/close/update channels. It exposes neither a mutable
// channel prefix nor `window.api`.

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
