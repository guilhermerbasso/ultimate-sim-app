import type { ModuleContext } from '../module-context'
import { ActionDispatcher } from '../actions/dispatcher'
import { EmulationEngine } from '../actions/emulation'
import type { ActionBinding, EmulationTestRequest, HidButtonControl } from '../../shared/actions'
import { normalizeTouchKeyboardHoldRequest } from '../../shared/touch-panel'
import { ENGINEER_CHANNELS, resolveEngineerAction } from '../../shared/engineer-ipc'
import { getEngineerConfigSnapshot } from './ai-engineer'

interface DashboardCycleControlState {
  next: HidButtonControl | null
  prev: HidButtonControl | null
}

function getCycleControls(bindings: ActionBinding[]): DashboardCycleControlState {
  const state: DashboardCycleControlState = { next: null, prev: null }
  for (const binding of bindings) {
    if (!binding.enabled || binding.action.type !== 'app') continue
    if (binding.action.command.name === 'dash:cycleNext' && !state.next) state.next = binding.control
    if (binding.action.command.name === 'dash:cyclePrev' && !state.prev) state.prev = binding.control
  }
  return state
}

export function register(ctx: ModuleContext): void {
  const emulation = new EmulationEngine()
  const dispatcher = new ActionDispatcher(ctx.app.getPath('userData'), ctx.ipcMain, ctx.iracingControl, emulation)
  let cycleControls: DashboardCycleControlState = { next: null, prev: null }

  const refreshCycleControls = async (): Promise<void> => {
    cycleControls = getCycleControls(await dispatcher.getBindings())
    ctx.broadcast('app:dash:cycleControl', cycleControls)
  }

  ctx.ipcMain.handle('actions:getBindings', () => dispatcher.getBindings())
  ctx.ipcMain.handle('actions:setBindings', async (_event, bindings: ActionBinding[]) => {
    const saved = await dispatcher.setBindings(bindings)
    cycleControls = getCycleControls(saved)
    ctx.broadcast('app:dash:cycleControl', cycleControls)
    return saved
  })
  ctx.ipcMain.handle('actions:trigger', (_event, bindingId: string) => dispatcher.trigger(bindingId))
  ctx.ipcMain.handle('actions:emulationStatus', () => emulation.isAvailable())
  ctx.ipcMain.handle('actions:testEmulation', (_event, request: EmulationTestRequest) => {
    if (request.type === 'keyboard') return emulation.pressKey(request.command)
    return emulation.tapGamepad(request.command)
  })
  // Touch panels get one exact keyboard-only lifecycle channel. No gamepad or
  // generic action-store access is exposed by the dedicated preload.
  ctx.ipcMain.handle('actions:touchKeyboardHold', (_event, raw: unknown) => {
    const request = normalizeTouchKeyboardHoldRequest(raw)
    if (!request) return { ok: false, message: 'Invalid touch keyboard hold request.' }
    if (request.phase === 'begin') return emulation.beginKeyboardHold(request.token, request.command)
    return emulation.endKeyboardHold(request.token)
  })
  ctx.ipcMain.handle('app:dash:cycleControl:get', () => cycleControls)

  // ── Engineer Q&A hardware triggers (ADDITIVE) ─────────────────────────────────
  // A hardware button bound to an engineer action invokes this with the action id.
  // We resolve it against the persisted engineer config and broadcast a directive
  // the app-level engineer action runtime executes (ask preset / push-to-talk). This
  // is purely additive: it reads the engineer config snapshot, touches NO existing
  // binding, and never reaches serial / iFlag / revlights output.
  ctx.ipcMain.handle(ENGINEER_CHANNELS.invokeAction, (_event, payload: unknown) => {
    const actionId = typeof payload === 'string' ? payload : ((payload as { actionId?: unknown } | null)?.actionId ?? '')
    if (typeof actionId !== 'string' || !actionId) return { ok: false }
    const directive = resolveEngineerAction(getEngineerConfigSnapshot(), actionId)
    if (!directive) return { ok: false }
    ctx.broadcast(ENGINEER_CHANNELS.action, directive)
    return { ok: true }
  })

  ctx.app.on('before-quit', () => {
    void emulation.dispose().catch((error) => console.warn('[actions] Failed to dispose emulation engine.', error))
  })

  void refreshCycleControls().catch((error) => console.warn('[actions] Failed to publish dashboard cycle controls.', error))
}
