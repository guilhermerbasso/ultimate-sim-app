import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Minimal Vite config that serves the two visual-audit galleries. The galleries
// live OUTSIDE the app `src/` tree but import the REAL renderer widgets and
// shared modules through the `@renderer` / `@shared` aliases, so the shots are
// production-accurate. `server.fs.allow` is widened to the app root so Vite can
// serve those out-of-root source files and their CSS/font assets.
const here = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(here, '..')

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(appRoot, 'src/renderer/src'),
      '@shared': resolve(appRoot, 'src/shared')
    }
  },
  server: {
    fs: {
      // Allow importing the app's source (one level up from visual-audit/).
      allow: [appRoot]
    }
  },
  // Keep dependency optimisation quiet/deterministic for screenshotting.
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client']
  }
})
