import type { WebContents } from 'electron'
import type { ModuleContext } from '../module-context'
import { ActionDispatcher, mapIracingCommand } from '../actions/dispatcher'
import { EmulationEngine } from '../actions/emulation'
import {
  registerTouchActionOwnerReleaser,
  registerTouchSemanticActionRuntime
} from '../actions/touch-owner'
import type { ActionBinding, EmulationTestRequest, HidButtonControl } from '../../shared/actions'
import {
  TOUCH_ACTION_IPC_CHANNEL,
  normalizeTouchSemanticActionRequest,
  type TouchSemanticActionRequest
} from '../../shared/touch-panel'
import type { OverlayWidgetId } from '../../shared/overlays'
import { getDashboardManager } from './dashboards'
import { getOverlayManager } from './overlays-core'
import { getOledDashboardEngine } from './oled-dashboard'
import { ENGINEER_CHANNELS, resolveEngineerAction } from '../../shared/engineer-ipc'
import { getEngineerConfigSnapshot } from './ai-engineer'

export interface TouchActionExecutionResult {
  ok: boolean
  message: string
}

export interface TouchActionEmulation {
  pressKey(command: import('../../shared/actions').KeyboardMacroCommand): Promise<TouchActionExecutionResult>
  beginKeyboardHold(token: string, command: import('../../shared/actions').KeyboardMacroCommand): Promise<TouchActionExecutionResult>
  endKeyboardHold(token: string): Promise<TouchActionExecutionResult>
  toggleTouchKeyboard(
    token: string,
    command: import('../../shared/actions').KeyboardMacroCommand
  ): Promise<TouchActionExecutionResult>
  setTouchKeyboardToggle(
    token: string,
    command: import('../../shared/actions').KeyboardMacroCommand,
    active: boolean
  ): Promise<TouchActionExecutionResult>
  releaseTouchKeyboardOwner(ownerKey: string): Promise<void>
}

export class TouchActionOwnerRegistry {
  private readonly generations = new Map<number, number>()
  private readonly tracked = new Set<number>()

  constructor(private readonly emulation: Pick<TouchActionEmulation, 'releaseTouchKeyboardOwner'>) {}

  currentOwnerKey(webContentsId: number): string {
    return `webcontents-${webContentsId}-generation-${this.generations.get(webContentsId) ?? 0}`
  }

  async release(webContentsId: number): Promise<void> {
    const ownerKey = this.currentOwnerKey(webContentsId)
    // Advance synchronously so a new document can never inherit an in-flight release.
    this.generations.set(webContentsId, (this.generations.get(webContentsId) ?? 0) + 1)
    await this.emulation.releaseTouchKeyboardOwner(ownerKey)
  }

  track(sender: WebContents): void {
    const webContentsId = sender.id
    if (this.tracked.has(webContentsId)) return
    this.tracked.add(webContentsId)
    sender.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame !== false) void this.release(webContentsId)
    })
    sender.on('render-process-gone', () => void this.release(webContentsId))
    sender.once('destroyed', () => {
      this.tracked.delete(webContentsId)
      void this.release(webContentsId)
    })
  }
}


function rejected(message: string): TouchActionExecutionResult {
  return { ok: false, message }
}

async function executeTouchAppAction(request: TouchSemanticActionRequest): Promise<TouchActionExecutionResult> {
  if (request.action.kind !== 'app') return rejected('Invalid Touch app action.')
  switch (request.action.command.name) {
    case 'dash:cycleNext':
    case 'dash:cyclePrev': {
      const manager = getDashboardManager()
      if (!manager) return rejected('Dashboard manager is unavailable.')
      await manager.cycle(request.action.command.name === 'dash:cyclePrev' ? 'prev' : 'next')
      return { ok: true, message: 'Dashboard playlist cycled.' }
    }
    case 'oled:setActivePage': {
      const engine = getOledDashboardEngine()
      if (!engine) return rejected('OLED dashboard engine is unavailable.')
      await engine.setActivePage(request.action.command.pageIndex ?? 0)
      return { ok: true, message: 'OLED page changed.' }
    }
    case 'overlays:toggle': {
      const manager = getOverlayManager()
      if (!manager) return rejected('Overlay manager is unavailable.')
      try {
        await manager.toggle((request.action.command.overlayId ?? 'relative') as OverlayWidgetId)
        return { ok: true, message: 'Overlay toggled.' }
      } catch (error) {
        return rejected(error instanceof Error ? error.message : 'Overlay action failed.')
      }
    }
  }
}

export function createTouchSemanticActionHandler(
  ctx: ModuleContext,
  emulation: TouchActionEmulation
): (raw: unknown, ownerKey?: string) => Promise<TouchActionExecutionResult> {
  return async (
    raw: unknown,
    ownerKey = 'webcontents-unscoped-generation-0'
  ): Promise<TouchActionExecutionResult> => {
    const request = normalizeTouchSemanticActionRequest(raw)
    if (!request) return rejected('Invalid semantic Touch action request.')
    try {
      if (request.action.kind === 'iracing') {
        const command = mapIracingCommand(request.action.command)
        if (!command) return rejected(`iRacing command "${request.action.command.name}" is unavailable.`)
        const result = ctx.iracingControl.execute(command)
        return {
          ok: result.ok,
          message: result.ok
            ? `iRacing: ${request.action.command.name} dispatched.`
            : result.message ?? `iRacing command "${request.action.command.name}" failed.`
        }
      }
      if (request.action.kind === 'app') return executeTouchAppAction(request)
      if (request.action.kind !== 'keyboard') return rejected('Unsupported Touch action.')

      const command = request.action.command
      const ownedToken = `${ownerKey}:${request.token}`
      if (command.mode === 'hold') {
        if (request.phase === 'begin') return emulation.beginKeyboardHold(ownedToken, command)
        if (request.phase === 'end' || request.phase === 'cancel') return emulation.endKeyboardHold(ownedToken)
        return emulation.pressKey(command)
      }
      if (command.mode === 'toggle') {
        if (request.phase === 'cancel' || request.zone === 'off') {
          return emulation.setTouchKeyboardToggle(ownedToken, command, false)
        }
        if (request.zone === 'on') {
          return emulation.setTouchKeyboardToggle(ownedToken, command, true)
        }
        return emulation.toggleTouchKeyboard(ownedToken, command)
      }
      if (command.mode === 'repeat') {
        const singlePress = {
          mode: 'press' as const,
          keys: [...command.keys],
          ...(command.delayMs !== undefined ? { delayMs: command.delayMs } : {}),
          ...(command.pressDelayMs !== undefined ? { pressDelayMs: command.pressDelayMs } : {}),
          ...(command.releaseDelayMs !== undefined ? { releaseDelayMs: command.releaseDelayMs } : {})
        }
        return emulation.pressKey(singlePress)
      }
      return emulation.pressKey(command)
    } catch (error) {
      return rejected(error instanceof Error ? error.message : 'Touch action execution failed.')
    }
  }
}
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
  // The Touch preload exposes only this semantic, runtime-validated action boundary.
  const handleTouchAction = createTouchSemanticActionHandler(ctx, emulation)
  const touchActionOwners = new TouchActionOwnerRegistry(emulation)
  const unregisterTouchActionOwners = registerTouchActionOwnerReleaser((webContentsId) =>
    touchActionOwners.release(webContentsId)
  )
  const unregisterTouchSemanticRuntime = registerTouchSemanticActionRuntime({
    execute: handleTouchAction,
    releaseOwner: (ownerKey) => emulation.releaseTouchKeyboardOwner(ownerKey)
  })
  ctx.ipcMain.handle(TOUCH_ACTION_IPC_CHANNEL, (event, raw: unknown) => {
    touchActionOwners.track(event.sender)
    return handleTouchAction(raw, touchActionOwners.currentOwnerKey(event.sender.id))
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

  ctx.registerGracefulTeardown(async () => {
    unregisterTouchActionOwners()
    try {
      await unregisterTouchSemanticRuntime()
    } catch (error) {
      console.warn('[actions] Failed to drain Touch semantic action owners.', error)
    }
    await emulation.dispose()
  }, 'quiesce')

  void refreshCycleControls().catch((error) => console.warn('[actions] Failed to publish dashboard cycle controls.', error))
}
