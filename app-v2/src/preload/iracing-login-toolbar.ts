import { contextBridge, ipcRenderer } from 'electron'

// Trusted, MINIMAL preload for the iRacing login TOOLBAR window only — our own
// `data:` page rendered by the BrowserWindow's webContents. It exposes exactly
// two no-arg calls so the toolbar buttons reach the main process via REAL IPC
// instead of the fragile sentinel-navigation hack (which doesn't fire reliably
// in the packaged app — the actual bug being fixed here).
//
// Security: this bridge is intentionally tiny. It exposes ONLY `done`/`cancel`
// and never hands the page arbitrary `ipcRenderer` access. It is attached ONLY
// to our toolbar window; iRacing's genuine page lives in a separate, sandboxed,
// preload-free WebContentsView and never sees anything injected.

export const IRACING_LOGIN_DONE_CHANNEL = 'iracing-login:done'
export const IRACING_LOGIN_CANCEL_CHANNEL = 'iracing-login:cancel'

contextBridge.exposeInMainWorld('simLogin', {
  done(): void {
    ipcRenderer.send(IRACING_LOGIN_DONE_CHANNEL)
  },
  cancel(): void {
    ipcRenderer.send(IRACING_LOGIN_CANCEL_CHANNEL)
  }
})
