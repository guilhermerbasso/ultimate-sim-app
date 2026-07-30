import type { ModuleContext } from '../module-context'
import { DashboardManager } from '../dashboards/manager'
import { logger } from './logger'

let manager: DashboardManager | null = null

// Módulo de Dashboards (itens 5/11). Janelas próprias no monitor 1/2, telemetria
// ao vivo, import/export `.simhubdash` e CONSTRUTOR básico. IPC usa o prefixo
// `app:dash:*` para passar pela allowlist comum dos preloads (main e overlay).
export function register(ctx: ModuleContext): void {
  manager = new DashboardManager(ctx)
  manager.registerIpc()
  void manager.load().catch((error: unknown) => {
    logger.error('dashboards', 'initial load failed', { error: String(error) })
  })

  ctx.app.once('before-quit', () => {
    void manager?.dispose()
    manager = null
  })
}

// ── Additive accessor (F6 Dashboard AI) ──────────────────────────────────────
// Exposes the live DashboardManager so the `dashboard-ai` module can persist an
// AI-generated dashboard through the EXACT SAME store path as `app:dash:save`
// (write-through to disk + in-memory map + summary broadcast) without going
// through a renderer round-trip. Returns null before `register` runs. This is
// the only edit to this file and is purely additive — no existing behaviour
// changes.
export function getDashboardManager(): DashboardManager | null {
  return manager
}
