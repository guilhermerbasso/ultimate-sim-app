import { createRequire } from 'node:module'
import type {
  EmulationCapability,
  EmulationStatus,
  GamepadEmulationCommand,
  KeyboardMacroCommand
} from '../../shared/actions'

const nativeRequire = createRequire(import.meta.url)

interface EmulationResult {
  ok: boolean
  message: string
}

export type NutKey = string | number

export interface NutKeyboard {
  pressKey(...keys: NutKey[]): Promise<void> | void
  releaseKey(...keys: NutKey[]): Promise<void> | void
}

export interface NutModule {
  keyboard: NutKeyboard
  Key: Record<string, NutKey>
}
export interface EmulationEngineOptions {
  nut?: NutModule
}

interface TouchHoldState {
  token: string
  cancelRequested: boolean
  keys: NutKey[] | null
  timer: ReturnType<typeof setTimeout> | null
  operation: Promise<EmulationResult>
}

interface TouchToggleState {
  token: string
  desiredActive: boolean
  keys: NutKey[] | null
  timer: ReturnType<typeof setTimeout> | null
  operation: Promise<EmulationResult>
}

interface VirtualPad {
  connect?(): Promise<void> | void
  disconnect?(): Promise<void> | void
  dispose?(): Promise<void> | void
  reset?(): Promise<void> | void
  update?(): Promise<void> | void
  pressButton?(button: number | string): Promise<void> | void
  releaseButton?(button: number | string): Promise<void> | void
  setButton?(button: number | string, value: boolean | number): Promise<void> | void
  button?(button: number | string, value: boolean | number): Promise<void> | void
}

interface VigemClient {
  connect?(): Promise<void> | void
  disconnect?(): Promise<void> | void
  dispose?(): Promise<void> | void
  createX360Controller?(): VirtualPad
  createXbox360Controller?(): VirtualPad
  createDS4Controller?(): VirtualPad
}

type VigemModule = Record<string, unknown>

const KEY_ALIASES: Record<string, string> = {
  alt: 'LeftAlt',
  backquote: 'Grave',
  backslash: 'Backslash',
  backspace: 'Backspace',
  bracketleft: 'LeftBracket',
  bracketright: 'RightBracket',
  cmd: 'LeftSuper',
  comma: 'Comma',
  command: 'LeftSuper',
  control: 'LeftControl',
  ctrl: 'LeftControl',
  del: 'Delete',
  delete: 'Delete',
  down: 'Down',
  end: 'End',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  home: 'Home',
  left: 'Left',
  meta: 'LeftSuper',
  minus: 'Minus',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  period: 'Period',
  plus: 'Equal',
  quote: 'Quote',
  right: 'Right',
  semicolon: 'Semicolon',
  shift: 'LeftShift',
  slash: 'Slash',
  space: 'Space',
  tab: 'Tab',
  up: 'Up',
  win: 'LeftSuper',
  windows: 'LeftSuper'
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unavailable(message: string): EmulationCapability {
  return { available: false, message }
}

function ok(message: string): EmulationCapability {
  return { available: true, message }
}

function pickConstructor<T>(module: VigemModule, names: string[]): (new (...args: unknown[]) => T) | null {
  for (const name of names) {
    const candidate = module[name]
    if (typeof candidate === 'function') return candidate as new (...args: unknown[]) => T
  }
  const defaultExport = module.default as VigemModule | undefined
  if (!defaultExport) return null
  return pickConstructor(defaultExport, names)
}

export class EmulationEngine {
  private nut: NutModule | null = null
  private nutError: string | null = null
  private vigemClient: VigemClient | null = null
  private virtualPad: VirtualPad | null = null
  private vigemError: string | null = null
  private toggledButtons = new Set<string>()
  private toggledKeyboard = new Map<string, NutKey[]>()
  private touchHoldStates = new Map<string, TouchHoldState>()
  private touchToggleStates = new Map<string, TouchToggleState>()

  constructor(options: EmulationEngineOptions = {}) {
    if (options.nut) this.nut = options.nut
  }

  isAvailable(): EmulationStatus {
    return {
      platform: process.platform,
      keyboard: this.probeKeyboard(),
      gamepad: this.probeGamepad()
    }
  }

  async pressKey(macro: KeyboardMacroCommand): Promise<EmulationResult> {
    const nut = this.ensureNut()
    if (!nut.ok) return nut

    try {
      const keys = macro.keys.map((key) => this.resolveKey(key, this.nut as NutModule))
      if (keys.length === 0) return { ok: false, message: 'Enter at least one key for the macro.' }

      if (macro.pressDelayMs && macro.pressDelayMs > 0) await delay(macro.pressDelayMs)

      if (macro.mode === 'toggle') {
        const signature = macro.keys.join('+').toLowerCase()
        const toggled = this.toggledKeyboard.get(signature)
        if (toggled) {
          await this.releaseKeyboardKeys(toggled)
          this.toggledKeyboard.delete(signature)
          return { ok: true, message: `Macro de teclado desativada: ${macro.keys.join(' + ')}` }
        }
        await Promise.resolve((this.nut as NutModule).keyboard.pressKey(...keys))
        this.toggledKeyboard.set(signature, keys)
        return { ok: true, message: `Macro de teclado ativada: ${macro.keys.join(' + ')}` }
      }

      if (macro.mode === 'repeat') {
        const count = Math.max(1, Math.min(25, Math.round(macro.repeatCount ?? 3)))
        for (let index = 0; index < count; index += 1) {
          await this.tapKeyboardKeys(keys, macro)
          if (index < count - 1) await delay(macro.repeatMs ?? 120)
        }
      } else if (macro.mode === 'sequence') {
        for (const key of keys) {
          await this.tapKeyboardKeys([key], macro)
          await delay(macro.delayMs ?? 60)
        }
      } else if (macro.mode === 'chord' || macro.mode === 'hold') {
        await this.tapKeyboardKeys(keys, macro)
      } else {
        await this.tapKeyboardKeys([keys[0]], macro)
      }

      return { ok: true, message: `Macro de teclado enviada: ${macro.keys.join(' + ')}` }
    } catch (error) {
      return { ok: false, message: `Failed to emulate keyboard: ${errorMessage(error)}` }
    }
  }

  /** Register pending state before any await so a fast release can cancel safely. */
  async beginKeyboardHold(token: string, macro: KeyboardMacroCommand): Promise<EmulationResult> {
    const nut = this.ensureNut()
    if (!nut.ok) return nut

    const previous = this.touchHoldStates.get(token)
    if (previous) {
      previous.cancelRequested = true
      if (previous.timer) clearTimeout(previous.timer)
      previous.timer = null
    }
    const state: TouchHoldState = {
      token,
      cancelRequested: false,
      keys: null,
      timer: null,
      operation: Promise.resolve({ ok: true, message: 'Hold pending.' })
    }
    this.touchHoldStates.set(token, state)
    state.operation = this.runTouchHoldBegin(state, macro, previous)
    return state.operation
  }

  async endKeyboardHold(token: string): Promise<EmulationResult> {
    const state = this.touchHoldStates.get(token)
    if (!state) return { ok: true, message: 'Hold already released.' }
    // This mutation is intentionally synchronous. `runTouchHoldBegin` observes it
    // before and after every await, including an in-flight keyboard.pressKey().
    state.cancelRequested = true
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
    return state.operation
      .catch(() => ({ ok: false, message: 'Hold activation failed before release.' }))
      .then(() => this.releaseTouchHoldState(state))
  }

  private async runTouchHoldBegin(
    state: TouchHoldState,
    macro: KeyboardMacroCommand,
    previous?: TouchHoldState
  ): Promise<EmulationResult> {
    try {
      if (previous) {
        await previous.operation.catch(() => undefined)
        await this.releaseTouchHoldState(previous)
      }
      if (state.cancelRequested || this.touchHoldStates.get(state.token) !== state) {
        this.deleteTouchHoldState(state)
        return { ok: true, message: 'Hold canceled before activation.' }
      }
      const keys = macro.keys.map((key) => this.resolveKey(key, this.nut as NutModule))
      if (keys.length === 0) {
        this.deleteTouchHoldState(state)
        return { ok: false, message: 'Enter at least one key for hold.' }
      }
      if (macro.pressDelayMs && macro.pressDelayMs > 0) await delay(macro.pressDelayMs)
      if (state.cancelRequested || this.touchHoldStates.get(state.token) !== state) {
        this.deleteTouchHoldState(state)
        return { ok: true, message: 'Hold canceled before activation.' }
      }
      await Promise.resolve((this.nut as NutModule).keyboard.pressKey(...keys))
      state.keys = keys
      if (state.cancelRequested || this.touchHoldStates.get(state.token) !== state) {
        return this.releaseTouchHoldState(state)
      }
      state.timer = setTimeout(() => {
        state.cancelRequested = true
        void this.releaseTouchHoldState(state)
      }, 30_000)
      return { ok: true, message: `Hold started: ${macro.keys.join(' + ')}` }
    } catch (error) {
      await this.releaseTouchHoldState(state).catch(() => undefined)
      return { ok: false, message: `Failed to start keyboard hold: ${errorMessage(error)}` }
    }
  }

  private async releaseTouchHoldState(state: TouchHoldState): Promise<EmulationResult> {
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
    const keys = state.keys
    if (!keys) {
      this.deleteTouchHoldState(state)
      return { ok: true, message: 'Hold released.' }
    }
    try {
      await this.releaseKeyboardKeys(keys)
      state.keys = null
      this.deleteTouchHoldState(state)
      return { ok: true, message: 'Hold released.' }
    } catch (error) {
      state.timer = setTimeout(() => void this.releaseTouchHoldState(state), 1_000)
      return { ok: false, message: `Failed to release keyboard hold: ${errorMessage(error)}` }
    }
  }

  private deleteTouchHoldState(state: TouchHoldState): void {
    if (this.touchHoldStates.get(state.token) === state) this.touchHoldStates.delete(state.token)
  }

  /** Deterministic, token-scoped latching keyboard state used only by Touch. */
  async setTouchKeyboardToggle(
    token: string,
    macro: KeyboardMacroCommand,
    active: boolean
  ): Promise<EmulationResult> {
    let state = this.touchToggleStates.get(token)
    if (!state) {
      state = {
        token,
        desiredActive: active,
        keys: null,
        timer: null,
        operation: Promise.resolve({ ok: true, message: 'Toggle pending.' })
      }
      this.touchToggleStates.set(token, state)
    } else {
      state.desiredActive = active
      if (state.timer) clearTimeout(state.timer)
      state.timer = null
    }
    const current = state
    const previous = current.operation
    current.operation = previous
      .catch(() => ({ ok: false, message: 'Previous toggle operation failed.' }))
      .then(() => this.reconcileTouchKeyboardToggle(current, macro))
    return current.operation
  }

  private async reconcileTouchKeyboardToggle(
    state: TouchToggleState,
    macro: KeyboardMacroCommand
  ): Promise<EmulationResult> {
    if (!state.desiredActive) return this.releaseTouchToggleState(state)
    if (state.keys) return { ok: true, message: `Toggle active: ${macro.keys.join(' + ')}` }
    const nut = this.ensureNut()
    if (!nut.ok) return nut
    try {
      const keys = macro.keys.map((key) => this.resolveKey(key, this.nut as NutModule))
      if (keys.length === 0) return { ok: false, message: 'Enter at least one key for toggle.' }
      if (macro.pressDelayMs && macro.pressDelayMs > 0) await delay(macro.pressDelayMs)
      if (!state.desiredActive) return this.releaseTouchToggleState(state)
      await Promise.resolve((this.nut as NutModule).keyboard.pressKey(...keys))
      state.keys = keys
      if (!state.desiredActive) return this.releaseTouchToggleState(state)
      return { ok: true, message: `Toggle active: ${macro.keys.join(' + ')}` }
    } catch (error) {
      await this.releaseTouchToggleState(state).catch(() => undefined)
      return { ok: false, message: `Failed to set keyboard toggle: ${errorMessage(error)}` }
    }
  }

  private async releaseTouchToggleState(state: TouchToggleState): Promise<EmulationResult> {
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
    const keys = state.keys
    if (!keys) {
      if (!state.desiredActive && this.touchToggleStates.get(state.token) === state) {
        this.touchToggleStates.delete(state.token)
      }
      return { ok: true, message: 'Toggle released.' }
    }
    try {
      await this.releaseKeyboardKeys(keys)
      state.keys = null
      if (!state.desiredActive && this.touchToggleStates.get(state.token) === state) {
        this.touchToggleStates.delete(state.token)
      }
      return { ok: true, message: 'Toggle released.' }
    } catch (error) {
      state.timer = setTimeout(() => void this.releaseTouchToggleState(state), 1_000)
      return { ok: false, message: `Failed to release keyboard toggle: ${errorMessage(error)}` }
    }
  }
  async tapGamepad(command: GamepadEmulationCommand): Promise<EmulationResult> {
    return this.setGamepad(command)
  }

  async setGamepad(command: GamepadEmulationCommand): Promise<EmulationResult> {
    const pad = await this.ensureGamepad()
    if (!pad.ok) return pad

    try {
      const buttonKey = String(command.button)
      const pressValue = command.value ?? 1

      if (command.mode === 'toggle') {
        const nextPressed = !this.toggledButtons.has(buttonKey)
        await this.setPadButton(command.button, nextPressed ? pressValue : 0)
        if (nextPressed) this.toggledButtons.add(buttonKey)
        else this.toggledButtons.delete(buttonKey)
        return { ok: true, message: `Virtual button ${command.button} ${nextPressed ? 'enabled' : 'desenabled'}.` }
      }

      await this.setPadButton(command.button, pressValue)
      if (command.mode === 'press' || command.mode === 'hold') {
        // Momentary tap. (True press-and-hold needs a falling-edge release from
        // the action runtime; auto-releasing here avoids a stuck virtual button.)
        await delay(70)
        await this.setPadButton(command.button, 0)
      }

      return { ok: true, message: `Virtual gamepad: button ${command.button} sent (${command.mode}).` }
    } catch (error) {
      return { ok: false, message: `Failed to emulate gamepad: ${errorMessage(error)}` }
    }
  }

  async dispose(): Promise<void> {
    const holds = [...this.touchHoldStates.values()]
    const toggles = [...this.touchToggleStates.values()]
    for (const state of holds) {
      state.cancelRequested = true
      if (state.timer) clearTimeout(state.timer)
      state.timer = null
    }
    for (const state of toggles) {
      state.desiredActive = false
      if (state.timer) clearTimeout(state.timer)
      state.timer = null
    }
    try {
      for (const keys of this.toggledKeyboard.values()) {
        await this.releaseKeyboardKeys(keys).catch(() => undefined)
      }
      for (const state of holds) {
        await state.operation.catch(() => undefined)
        await this.releaseTouchHoldState(state).catch(() => undefined)
      }
      for (const state of toggles) {
        await state.operation.catch(() => undefined)
        await this.releaseTouchToggleState(state).catch(() => undefined)
      }
      if (this.virtualPad?.reset) await Promise.resolve(this.virtualPad.reset())
      if (this.virtualPad?.disconnect) await Promise.resolve(this.virtualPad.disconnect())
      if (this.virtualPad?.dispose) await Promise.resolve(this.virtualPad.dispose())
      if (this.vigemClient?.disconnect) await Promise.resolve(this.vigemClient.disconnect())
      if (this.vigemClient?.dispose) await Promise.resolve(this.vigemClient.dispose())
    } finally {
      this.virtualPad = null
      this.vigemClient = null
      this.toggledButtons.clear()
      this.toggledKeyboard.clear()
      for (const state of this.touchHoldStates.values()) if (state.timer) clearTimeout(state.timer)
      for (const state of this.touchToggleStates.values()) if (state.timer) clearTimeout(state.timer)
      this.touchHoldStates.clear()
      this.touchToggleStates.clear()
    }
  }

  private probeKeyboard(): EmulationCapability {
    const result = this.ensureNut()
    return result.ok ? ok('Keyboard available through nut-js.') : unavailable(result.message)
  }

  private probeGamepad(): EmulationCapability {
    if (process.platform !== 'win32') {
      return unavailable('Virtual gamepad requires Windows + the ViGEmBus driver.')
    }
    try {
      nativeRequire('vigemclient') as VigemModule
      return ok('Virtual gamepad available through vigemclient/ViGEmBus.')
    } catch (error) {
      this.vigemError = errorMessage(error)
      return unavailable(`vigemclient/ViGEmBus dependency unavailable: ${this.vigemError}`)
    }
  }

  private ensureNut(): EmulationResult {
    if (process.platform !== 'win32') {
      return { ok: false, message: 'Keyboard emulation requires Windows in this version.' }
    }
    if (this.nut) return { ok: true, message: 'Keyboard available.' }
    if (this.nutError) return { ok: false, message: `nut-js dependency unavailable: ${this.nutError}` }

    try {
      const loaded = nativeRequire('@nut-tree-fork/nut-js') as Partial<NutModule>
      if (!loaded.keyboard || !loaded.Key) throw new Error('keyboard/Key API not found in nut-js.')
      this.nut = { keyboard: loaded.keyboard, Key: loaded.Key }
      return { ok: true, message: 'Keyboard available.' }
    } catch (error) {
      this.nutError = errorMessage(error)
      return { ok: false, message: `nut-js dependency unavailable: ${this.nutError}` }
    }
  }

  private gamepadInit: Promise<EmulationResult> | null = null

  private async ensureGamepad(): Promise<EmulationResult> {
    if (process.platform !== 'win32') {
      return { ok: false, message: 'Virtual gamepad emulation requires Windows + ViGEmBus driver.' }
    }
    if (this.virtualPad) return { ok: true, message: 'Virtual gamepad connected.' }
    if (this.vigemError) return { ok: false, message: `vigemclient/ViGEmBus dependency unavailable: ${this.vigemError}` }
    // Memoize the in-flight init so concurrent first-use callers don't each create
    // (and leak) a second ViGEm client/virtual pad.
    if (this.gamepadInit) return this.gamepadInit
    this.gamepadInit = this.createGamepad()
    try {
      return await this.gamepadInit
    } finally {
      if (!this.virtualPad) this.gamepadInit = null
    }
  }

  private async createGamepad(): Promise<EmulationResult> {
    try {
      const module = nativeRequire('vigemclient') as VigemModule
      const ClientCtor = pickConstructor<VigemClient>(module, ['ViGEmClient', 'VigemClient', 'Client'])
      if (!ClientCtor) throw new Error('ViGEm client not found in the vigemclient package.')

      const client = new ClientCtor()
      if (client.connect) await Promise.resolve(client.connect())

      const ControllerCtor = pickConstructor<VirtualPad>(module, [
        'Xbox360Controller',
        'X360Controller',
        'XboxController',
        'DS4Controller'
      ])
      const pad =
        client.createX360Controller?.() ??
        client.createXbox360Controller?.() ??
        client.createDS4Controller?.() ??
        (ControllerCtor ? new ControllerCtor(client) : null)

      if (!pad) throw new Error('Virtual Xbox 360/DS4 controller could not be created.')
      if (pad.connect) await Promise.resolve(pad.connect())

      this.vigemClient = client
      this.virtualPad = pad
      return { ok: true, message: 'Virtual gamepad connected.' }
    } catch (error) {
      this.vigemError = errorMessage(error)
      return { ok: false, message: `vigemclient/ViGEmBus dependency unavailable: ${this.vigemError}` }
    }
  }

  private resolveKey(rawKey: string, nut: NutModule): NutKey {
    const token = rawKey.trim()
    const lower = token.toLowerCase()
    const candidates = [
      KEY_ALIASES[lower],
      token,
      token.toUpperCase(),
      token.charAt(0).toUpperCase() + token.slice(1),
      /^\d$/.test(token) ? `Num${token}` : undefined,
      /^f\d{1,2}$/i.test(token) ? token.toUpperCase() : undefined
    ].filter((value): value is string => Boolean(value))

    for (const candidate of candidates) {
      const key = nut.Key[candidate]
      if (key !== undefined) return key
    }
    throw new Error(`Key not recognized by nut-js: ${rawKey}`)
  }

  private async tapKeyboardKeys(keys: NutKey[], macro: KeyboardMacroCommand): Promise<void> {
    await Promise.resolve((this.nut as NutModule).keyboard.pressKey(...keys))
    await delay(macro.mode === 'hold' ? macro.releaseDelayMs ?? 450 : macro.delayMs ?? 45)
    await this.releaseKeyboardKeys(keys)
    // Release delay paces the NEXT action (it runs AFTER the keys are freed),
    // so it must not extend the press hold above.
    if (macro.releaseDelayMs && macro.mode !== 'hold') await delay(macro.releaseDelayMs)
  }

  private async releaseKeyboardKeys(keys: NutKey[]): Promise<void> {
    await Promise.resolve((this.nut as NutModule).keyboard.releaseKey(...[...keys].reverse()))
  }

  private async setPadButton(button: number | string, value: number): Promise<void> {
    const pad = this.virtualPad as VirtualPad
    if (pad.setButton) await Promise.resolve(pad.setButton(button, value))
    else if (pad.button) await Promise.resolve(pad.button(button, value))
    else if (value > 0 && pad.pressButton) await Promise.resolve(pad.pressButton(button))
    else if (pad.releaseButton) await Promise.resolve(pad.releaseButton(button))
    else throw new Error('Button API not found on the virtual controller.')

    if (pad.update) await Promise.resolve(pad.update())
  }
}
