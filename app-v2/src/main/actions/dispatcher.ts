import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { IpcMain } from 'electron'
import type {
  ActionBinding,
  ActionBindingsStore,
  ActionTriggerResult,
  GamepadEmulationCommand,
  IracingCommand,
  IracingCommandName,
  KeyboardMacroCommand
} from '../../shared/actions'
import type { IRacingCommand, IRacingControl } from '../iracing/control'
import type { EmulationEngine } from './emulation'

const STORE_FILE = 'actions-bindings.json'

function nowIso(): string {
  return new Date().toISOString()
}

function defaultStore(): ActionBindingsStore {
  return { version: 1, bindings: [], updatedAt: nowIso() }
}

function isBinding(value: unknown): value is ActionBinding {
  const candidate = value as Partial<ActionBinding>
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.label === 'string' &&
      typeof candidate.enabled === 'boolean' &&
      candidate.control?.source === 'gamepad' &&
      typeof candidate.control.buttonIndex === 'number' &&
      candidate.action &&
      (candidate.action.type === 'iracing' ||
        candidate.action.type === 'app' ||
        candidate.action.type === 'keyboard' ||
        candidate.action.type === 'gamepad')
  )
}

function normalizeBindings(bindings: ActionBinding[]): ActionBinding[] {
  const seen = new Set<string>()
  return bindings.filter((binding) => {
    if (!isBinding(binding) || seen.has(binding.id)) return false
    seen.add(binding.id)
    return true
  })
}

// Maps the user-facing action vocabulary (shared/actions.ts) to the raw irsdk
// broadcast vocabulary understood by IRacingControl. Returns null when the
// requested action has no clean SDK mapping (camera next/previous,
// black-box paging) — the dispatcher then reports an
// "indispolevel" message instead of pretending the command went through.
function mapIracingCommand(command: IracingCommand): IRacingCommand | null {
  const name: IracingCommandName = command.name
  switch (name) {
    case 'pit:addFuel':
      return { type: 'pit:fuel', payload: { liters: command.fuelLiters ?? 0 } }
    case 'pit:clearFuel':
      return { type: 'pit:fuel', payload: { liters: 0 } }
    case 'pit:toggleTyreLf':
      return { type: 'pit:tyres', payload: { tyres: ['lf'] } }
    case 'pit:toggleTyreRf':
      return { type: 'pit:tyres', payload: { tyres: ['rf'] } }
    case 'pit:toggleTyreLr':
      return { type: 'pit:tyres', payload: { tyres: ['lr'] } }
    case 'pit:toggleTyreRr':
      return { type: 'pit:tyres', payload: { tyres: ['rr'] } }
    case 'pit:fastRepair':
      return { type: 'pit:fastRepair' }
    case 'pit:clearAll':
      return { type: 'pit:clear' }
    // No deterministic SDK equivalent — irsdk does not expose "next camera",
    // "previous camera" or "next black box page". Returning
    // null surfaces a clear "not supported" message to the renderer.
    case 'camera:next':
    case 'camera:previous':
    case 'blackBox:next':
    case 'blackBox:previous':
      return null
    default: {
      const exhaustiveCheck: never = name
      void exhaustiveCheck
      return null
    }
  }
}

export class ActionDispatcher {
  private bindings: ActionBinding[] = []
  private loaded = false
  private readonly filePath: string

  constructor(
    userDataPath: string,
    private readonly ipcMain: IpcMain,
    private readonly iracingControl: IRacingControl,
    private readonly emulation: EmulationEngine
  ) {
    this.filePath = path.join(userDataPath, STORE_FILE)
  }

  async getBindings(): Promise<ActionBinding[]> {
    await this.ensureLoaded()
    return this.bindings
  }

  async setBindings(bindings: ActionBinding[]): Promise<ActionBinding[]> {
    this.bindings = normalizeBindings(bindings)
    await this.save()
    return this.bindings
  }

  async trigger(bindingId: string): Promise<ActionTriggerResult> {
    await this.ensureLoaded()
    const binding = this.bindings.find((item) => item.id === bindingId)
    if (!binding) throw new Error(`Binding not found: ${bindingId}`)
    if (!binding.enabled) {
      return this.result(binding, false, `Binding "${binding.label}" is disabled.`)
    }

    if (binding.action.type === 'iracing') return this.dispatchIracing(binding, binding.action.command)
    if (binding.action.type === 'keyboard') return this.dispatchKeyboard(binding, binding.action.command)
    if (binding.action.type === 'gamepad') return this.dispatchGamepad(binding, binding.action.command)

    return this.result(binding, true, 'App action must be executed directly in the renderer.')
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ActionBindingsStore>
      this.bindings = normalizeBindings(Array.isArray(parsed.bindings) ? parsed.bindings : [])
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') console.warn('[actions] Failed to load bindings, using empty store.', error)
      this.bindings = []
      if (code === 'ENOENT') await this.save(defaultStore())
    }
    this.loaded = true
  }

  private async save(store?: ActionBindingsStore): Promise<void> {
    const payload: ActionBindingsStore = store ?? { version: 1, bindings: this.bindings, updatedAt: nowIso() }
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }

  private dispatchIracing(binding: ActionBinding, command: IracingCommand): ActionTriggerResult {
    this.ipcMain.emit('actions:iracing', { source: 'action-engine', bindingId: binding.id }, command)
    const mapped = mapIracingCommand(command)
    if (!mapped) {
      return this.result(
        binding,
        false,
        `iRacing command "${command.name}" has no direct SDK broadcast mapping — unavailable.`
      )
    }
    const broadcastResult = this.iracingControl.execute(mapped)
    const message = broadcastResult.ok
      ? `iRacing: ${command.name} despachado.`
      : broadcastResult.message ?? `Failed to dispatch iRacing ${command.name}.`
    return this.result(binding, broadcastResult.ok, message)
  }

  private async dispatchKeyboard(binding: ActionBinding, command: KeyboardMacroCommand): Promise<ActionTriggerResult> {
    const result = await this.emulation.pressKey(command)
    return this.result(binding, result.ok, result.message)
  }

  private async dispatchGamepad(binding: ActionBinding, command: GamepadEmulationCommand): Promise<ActionTriggerResult> {
    const result = await this.emulation.tapGamepad(command)
    return this.result(binding, result.ok, result.message)
  }

  private result(binding: ActionBinding, ok: boolean, message: string): ActionTriggerResult {
    return {
      ok,
      bindingId: binding.id,
      actionType: binding.action.type,
      message,
      executedAt: nowIso()
    }
  }
}
