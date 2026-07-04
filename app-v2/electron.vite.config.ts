import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Multiple preload entries: `index` is the full ButtonBox bridge for the
        // main window; `overlay` is a minimal bridge with only `window.ipc` for
        // overlay BrowserWindows.
        input: {
          index: resolve('src/preload/index.ts'),
          overlay: resolve('src/preload/overlay.ts'),
          // Dedicated preload for the touch Pit & Command window (minimal
          // window.ipc: iracing:/telemetry:/app:pitpanel:).
          pitpanel: resolve('src/preload/pitpanel.ts'),
          // Dedicated preload for the editable RGB button-box window.
          touchpanel: resolve('src/preload/touchpanel.ts'),
          // Trusted toolbar preload for the embedded iRacing login window: exposes
          // only `window.simLogin.done()/cancel()` over real IPC (replaces the
          // fragile sentinel-navigation "Voltar" button).
          'iracing-login-toolbar': resolve('src/preload/iracing-login-toolbar.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html'),
          compositor: resolve('src/renderer/compositor.html'),
          dashboard: resolve('src/renderer/dashboard.html'),
          stream: resolve('src/renderer/stream.html'),
          // Touch Pit & Command panel (7" touchscreen).
          pitpanel: resolve('src/renderer/pitpanel.html'),
          // Editable RGB button-box panel (fullscreen touch window).
          touchpanel: resolve('src/renderer/touchpanel.html'),
          // Trusted file:// toolbar for the embedded iRacing login window. A
          // bundled file:// page (not a data: URL) lets the toolbar preload
          // (`window.simLogin`) load reliably in the packaged app.
          'login-toolbar': resolve('src/renderer/login-toolbar.html')
        }
      }
    }
  }
})
