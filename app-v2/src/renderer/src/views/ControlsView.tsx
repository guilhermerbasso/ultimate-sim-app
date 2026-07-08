import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ActionBinding,
  ActionDefinition,
  AppActionName,
  EmulationStatus,
  GamepadEmulationCommand,
  HidButtonControl,
  HidButtonType,
  HidSwitchType,
  IracingCommandName,
  KeyboardMacroCommand
} from '../../../shared/actions'
import type { AppViewProps } from '../App'
import { setActionRuntimeSuppressed } from '../lib/action-runtime'
import { SectionExportImport } from '../components/SectionExportImport'
import { findFirstPressedButton, listConnectedGamepads, type GamepadSummary } from '../lib/gamepad'
import { tt } from '../i18n'
import {
  composeKeyboardCombo,
  isKeyboardCaptureCancel,
  isKeyboardModifier,
  keyboardTokenFromEvent
} from '../lib/keyboard-capture'

type OutputType = 'keyboard' | 'gamepad' | 'iracing' | 'app'
type KeyboardMode = KeyboardMacroCommand['mode']
type GamepadMode = GamepadEmulationCommand['mode']
type CaptureTarget = 'hid' | 'keyboard' | null

const IRACING_COMMANDS: Array<{ name: IracingCommandName; label: string }> = [
  { name: 'pit:addFuel', label: 'Pit · add fuel' },
  { name: 'pit:clearFuel', label: 'Pit · clear fuel' },
  { name: 'pit:toggleTyreLf', label: 'Pit · toggle left-front tyre' },
  { name: 'pit:toggleTyreRf', label: 'Pit · toggle right-front tyre' },
  { name: 'pit:toggleTyreLr', label: 'Pit · toggle left-rear tyre' },
  { name: 'pit:toggleTyreRr', label: 'Pit · toggle right-rear tyre' },
  { name: 'pit:fastRepair', label: 'Pit · fast repair' },
  { name: 'pit:clearAll', label: 'Pit · clear all services' },
  { name: 'camera:next', label: 'Camera · next' },
  { name: 'camera:previous', label: 'Camera · previous' },
  { name: 'blackBox:next', label: 'Black box · next' },
  { name: 'blackBox:previous', label: 'Black box · previous' }
]

const APP_ACTIONS: Array<{ name: AppActionName; label: string }> = [
  { name: 'dash:cycleNext', label: 'Dashboard · next' },
  { name: 'dash:cyclePrev', label: 'Dashboard · previous' },
  { name: 'oled:setActivePage', label: 'OLED · set page' },
  { name: 'overlays:toggle', label: 'Overlay · toggle' }
]

const OVERLAY_IDS = ['relative', 'standings', 'fuel', 'inputs', 'flags']

interface DraftState {
  editingId: string | null
  label: string
  gamepadIndex: number | null
  gamepadId: string
  buttonIndex: number | null
  // ButtonBox read config (how the physical contact is interpreted).
  switchType: HidSwitchType
  buttonType: HidButtonType
  stepsPerDetent: number
  flipInvertCover: boolean
  flipEngineRpmThreshold: number
  flipReconcileDebounceMs: number
  outputType: OutputType
  keyboardMode: KeyboardMode
  keyboardKeys: string
  keyboardDelayMs: number
  keyboardPressDelayMs: number
  keyboardReleaseDelayMs: number
  keyboardRepeatMs: number
  keyboardRepeatCount: number
  gamepadButton: string
  gamepadValue: number
  gamepadMode: GamepadMode
  iracingCommand: IracingCommandName
  fuelLiters: number
  appAction: AppActionName
  oledPage: number
  overlayId: string
}

interface EmulationResult {
  ok: boolean
  message: string
}

interface BindPreset {
  id: string
  title: string
  subtitle: string
  patch: Partial<DraftState>
}

const EMPTY_DRAFT: DraftState = {
  editingId: null,
  label: '',
  gamepadIndex: null,
  gamepadId: '',
  buttonIndex: null,
  switchType: 'momentary',
  buttonType: 'push',
  stepsPerDetent: 1,
  flipInvertCover: false,
  flipEngineRpmThreshold: 200,
  flipReconcileDebounceMs: 1500,
  outputType: 'keyboard',
  keyboardMode: 'chord',
  keyboardKeys: 'ctrl+shift+p',
  keyboardDelayMs: 60,
  keyboardPressDelayMs: 0,
  keyboardReleaseDelayMs: 45,
  keyboardRepeatMs: 120,
  keyboardRepeatCount: 3,
  gamepadButton: '0',
  gamepadValue: 1,
  gamepadMode: 'press',
  iracingCommand: 'pit:fastRepair',
  fuelLiters: 10,
  appAction: 'dash:cycleNext',
  oledPage: 0,
  overlayId: 'relative'
}

const DEFAULT_STATUS: EmulationStatus = {
  platform: 'unknown',
  keyboard: { available: false, message: 'Status not loaded yet.' },
  gamepad: { available: false, message: 'Status not loaded yet.' }
}

const BIND_PRESETS: BindPreset[] = [
  {
    id: 'push-to-talk',
    title: 'Push-to-talk',
    subtitle: 'Timed V hold, common for radio/Discord',
    patch: { label: 'Push-to-talk', outputType: 'keyboard', keyboardMode: 'hold', keyboardKeys: 'v', keyboardReleaseDelayMs: 450 }
  },
  {
    id: 'fast-repair',
    title: 'Fast repair',
    subtitle: 'Native iRacing pit command',
    patch: { label: 'Fast repair', outputType: 'iracing', iracingCommand: 'pit:fastRepair' }
  },
  {
    id: 'pit-toggle',
    title: 'Pit toggle',
    subtitle: 'Toggle a keyboard bind without retyping',
    patch: { label: 'Pit toggle', outputType: 'keyboard', keyboardMode: 'toggle', keyboardKeys: 'p' }
  },
  {
    id: 'dash-next',
    title: 'Dashboard next',
    subtitle: 'Cycle the in-app dash playlist',
    patch: { label: 'Dashboard next', outputType: 'app', appAction: 'dash:cycleNext' }
  },
  {
    id: 'dash-prev',
    title: 'Dashboard previous',
    subtitle: 'Go back in the dash playlist',
    patch: { label: 'Dashboard previous', outputType: 'app', appAction: 'dash:cyclePrev' }
  },
  {
    id: 'oled-page',
    title: 'OLED page',
    subtitle: 'Jump to a fixed hardware page',
    patch: { label: 'OLED page 1', outputType: 'app', appAction: 'oled:setActivePage', oledPage: 0 }
  },
  {
    id: 'flip-cover-ignition',
    title: 'Flip cover ignition',
    subtitle: 'Sync a maintained cover to iRacing ignition',
    patch: {
      label: 'Ignition (flip cover)',
      switchType: 'flip-cover',
      buttonType: 'maintained',
      outputType: 'gamepad',
      gamepadButton: 'A',
      gamepadMode: 'press'
    }
  }
]

const KEYBOARD_MODE_LABELS: Record<KeyboardMode, string> = {
  press: 'Press',
  chord: 'Chord',
  sequence: 'Sequence',
  hold: 'Hold',
  toggle: 'Toggle',
  repeat: 'Repeat'
}

const SWITCH_TYPE_OPTIONS: Array<{ value: HidSwitchType; label: string; hint: string }> = [
  { value: 'momentary', label: 'Momentary (push)', hint: 'Fire on press. Standard push button.' },
  { value: 'toggle', label: 'Toggle (fire on ON)', hint: 'Maintained switch — fire only when turned ON.' },
  { value: 'pulse-both-edges', label: 'Pulse on both edges', hint: 'Maintained switch — one pulse per flip (On→Off and Off→On).' },
  { value: 'flip-cover', label: 'Flip cover (ignition)', hint: 'Syncs the cover position to the iRacing engine/ignition state.' }
]

const BUTTON_TYPE_OPTIONS: Array<{ value: HidButtonType; label: string }> = [
  { value: 'push', label: 'Push (momentary contact)' },
  { value: 'maintained', label: 'Maintained (latching)' }
]

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `binding-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseButton(value: string): number | string {
  const trimmed = value.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed
}

function keyboardKeys(draft: DraftState): string[] {
  return draft.keyboardKeys.split(/[+,]/).map((key) => key.trim()).filter(Boolean)
}

function optionalPositive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function keyboardCommand(draft: DraftState): KeyboardMacroCommand {
  return {
    mode: draft.keyboardMode,
    keys: keyboardKeys(draft),
    delayMs: optionalPositive(draft.keyboardDelayMs),
    pressDelayMs: optionalPositive(draft.keyboardPressDelayMs),
    releaseDelayMs: optionalPositive(draft.keyboardReleaseDelayMs),
    repeatMs: draft.keyboardMode === 'repeat' ? optionalPositive(draft.keyboardRepeatMs) : undefined,
    repeatCount: draft.keyboardMode === 'repeat' ? Math.max(1, Math.round(draft.keyboardRepeatCount || 1)) : undefined
  }
}

function gamepadCommand(draft: DraftState): GamepadEmulationCommand {
  return {
    button: parseButton(draft.gamepadButton),
    value: draft.gamepadValue,
    mode: draft.gamepadMode
  }
}

function iracingGroup(name: IracingCommandName): 'pit' | 'camera' | 'blackBox' {
  if (name.startsWith('pit:')) return 'pit'
  if (name.startsWith('camera:')) return 'camera'
  return 'blackBox'
}

function buildAction(draft: DraftState): ActionDefinition {
  if (draft.outputType === 'gamepad') return { type: 'gamepad', command: gamepadCommand(draft) }
  if (draft.outputType === 'keyboard') return { type: 'keyboard', command: keyboardCommand(draft) }
  if (draft.outputType === 'iracing') {
    return {
      type: 'iracing',
      command: {
        group: iracingGroup(draft.iracingCommand),
        name: draft.iracingCommand,
        fuelLiters: draft.iracingCommand === 'pit:addFuel' ? draft.fuelLiters : undefined
      }
    }
  }
  return {
    type: 'app',
    command: draft.appAction === 'oled:setActivePage'
      ? { name: 'oled:setActivePage', pageIndex: draft.oledPage }
      : draft.appAction === 'overlays:toggle'
        ? { name: 'overlays:toggle', overlayId: draft.overlayId.trim() || 'relative' }
        : { name: draft.appAction }
  }
}

function buildControl(draft: DraftState): HidButtonControl {
  const control: HidButtonControl = {
    source: 'gamepad',
    gamepadId: draft.gamepadId || undefined,
    gamepadIndex: draft.gamepadIndex ?? undefined,
    buttonIndex: draft.buttonIndex ?? 0,
    switchType: draft.switchType,
    buttonType: draft.buttonType
  }
  const steps = Math.max(1, Math.round(draft.stepsPerDetent || 1))
  if (steps > 1) control.stepsPerDetent = steps
  if (draft.switchType === 'flip-cover') {
    control.flipCover = {
      engineRpmThreshold: Math.max(0, Math.round(draft.flipEngineRpmThreshold || 0)) || undefined,
      reconcileDebounceMs: Math.max(0, Math.round(draft.flipReconcileDebounceMs || 0)) || undefined,
      invertCover: draft.flipInvertCover || undefined
    }
  }
  return control
}

function actionLabel(action: ActionDefinition): string {
  if (action.type === 'keyboard') {
    const repeat = action.command.mode === 'repeat' && action.command.repeatMs ? ` · ${action.command.repeatMs}ms` : ''
    return `Keyboard ${KEYBOARD_MODE_LABELS[action.command.mode]}: ${action.command.keys.join(' + ')}${repeat}`
  }
  if (action.type === 'gamepad') return `Virtual pad ${action.command.mode}: button ${action.command.button}`
  if (action.type === 'iracing') return IRACING_COMMANDS.find((c) => c.name === action.command.name)?.label ?? action.command.name
  if (action.command.name === 'oled:setActivePage') return `OLED page ${action.command.pageIndex ?? 0}`
  if (action.command.name === 'overlays:toggle') return `Overlay ${action.command.overlayId ?? 'relative'}`
  return APP_ACTIONS.find((a) => a.name === action.command.name)?.label ?? action.command.name
}

function actionTone(action: ActionDefinition): string {
  if (action.type === 'keyboard') return KEYBOARD_MODE_LABELS[action.command.mode]
  if (action.type === 'gamepad') return action.command.mode.toUpperCase()
  if (action.type === 'iracing') return 'iRacing'
  return 'App'
}

function draftFromBinding(binding: ActionBinding): DraftState {
  const base: DraftState = {
    ...EMPTY_DRAFT,
    editingId: binding.id,
    label: binding.label,
    gamepadIndex: binding.control.gamepadIndex ?? null,
    gamepadId: binding.control.gamepadId ?? '',
    buttonIndex: binding.control.buttonIndex,
    switchType: binding.control.switchType ?? 'momentary',
    buttonType: binding.control.buttonType ?? 'push',
    stepsPerDetent: binding.control.stepsPerDetent ?? 1,
    flipInvertCover: binding.control.flipCover?.invertCover ?? false,
    flipEngineRpmThreshold: binding.control.flipCover?.engineRpmThreshold ?? 200,
    flipReconcileDebounceMs: binding.control.flipCover?.reconcileDebounceMs ?? 1500,
    outputType: binding.action.type
  }

  if (binding.action.type === 'gamepad') {
    return {
      ...base,
      gamepadButton: String(binding.action.command.button),
      gamepadValue: binding.action.command.value ?? 1,
      gamepadMode: binding.action.command.mode
    }
  }
  if (binding.action.type === 'keyboard') {
    return {
      ...base,
      keyboardMode: binding.action.command.mode,
      keyboardKeys: binding.action.command.keys.join('+'),
      keyboardDelayMs: binding.action.command.delayMs ?? EMPTY_DRAFT.keyboardDelayMs,
      keyboardPressDelayMs: binding.action.command.pressDelayMs ?? EMPTY_DRAFT.keyboardPressDelayMs,
      keyboardReleaseDelayMs: binding.action.command.releaseDelayMs ?? EMPTY_DRAFT.keyboardReleaseDelayMs,
      keyboardRepeatMs: binding.action.command.repeatMs ?? EMPTY_DRAFT.keyboardRepeatMs,
      keyboardRepeatCount: binding.action.command.repeatCount ?? EMPTY_DRAFT.keyboardRepeatCount
    }
  }
  if (binding.action.type === 'iracing') {
    return {
      ...base,
      iracingCommand: binding.action.command.name,
      fuelLiters: binding.action.command.fuelLiters ?? 10
    }
  }
  return {
    ...base,
    appAction: binding.action.command.name,
    oledPage: binding.action.command.pageIndex ?? 0,
    overlayId: binding.action.command.overlayId ?? 'relative'
  }
}

async function dispatchAppAction(action: Extract<ActionDefinition, { type: 'app' }>): Promise<string> {
  const command = action.command
  if (command.name === 'oled:setActivePage') {
    await window.ipc.invoke('oled:setActivePage', command.pageIndex ?? 0)
    return `OLED page ${command.pageIndex ?? 0}`
  }
  if (command.name === 'overlays:toggle') {
    await window.ipc.invoke('overlays:toggle', command.overlayId ?? 'relative')
    return `overlay ${command.overlayId ?? 'relative'}`
  }
  const direction = command.name === 'dash:cyclePrev' ? 'prev' : 'next'
  await window.ipc.invoke('app:dash:cycle', direction)
  return `dashboard ${direction}`
}

function ControlsView({ showToast, language }: AppViewProps): ReactElement {
  const [bindings, setBindings] = useState<ActionBinding[]>([])
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT)
  const [gamepads, setGamepads] = useState<GamepadSummary[]>([])
  const [status, setStatus] = useState<EmulationStatus>(DEFAULT_STATUS)
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget>(null)
  const [keyboardPreview, setKeyboardPreview] = useState('')
  const [lastResult, setLastResult] = useState('No test run yet.')
  const hidCaptureStateRef = useRef(new Map<string, boolean>())
  const heldKeyboardRef = useRef(new Map<string, string>())
  const lastKeyboardComboRef = useRef<string[]>([])
  const previousCaptureTargetRef = useRef<CaptureTarget>(null)

  const selectedGamepad = useMemo(
    () => gamepads.find((gamepad) => gamepad.index === draft.gamepadIndex) ?? null,
    [draft.gamepadIndex, gamepads]
  )

  const enabledBindings = bindings.filter((binding) => binding.enabled).length
  const needsEmulation = draft.outputType === 'keyboard' || draft.outputType === 'gamepad'
  const captureArmed = captureTarget !== null

  const refreshStatus = useCallback(async () => {
    const nextStatus = await window.ipc.invoke<EmulationStatus>('actions:emulationStatus')
    setStatus(nextStatus)
  }, [])

  const persistBindings = useCallback(async (nextBindings: ActionBinding[]) => {
    const saved = await window.ipc.invoke<ActionBinding[]>('actions:setBindings', nextBindings)
    setBindings(saved)
  }, [])

  const reloadBindings = useCallback(async () => {
    try {
      const loaded = await window.ipc.invoke<ActionBinding[]>('actions:getBindings')
      setBindings(loaded)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }, [showToast])

  const resetKeyboardCaptureRefs = useCallback(() => {
    heldKeyboardRef.current.clear()
    lastKeyboardComboRef.current = []
  }, [])

  const clearKeyboardCapture = useCallback(() => {
    resetKeyboardCaptureRefs()
    setKeyboardPreview('')
  }, [resetKeyboardCaptureRefs])

  const cancelCapture = useCallback(() => {
    clearKeyboardCapture()
    setCaptureTarget(null)
  }, [clearKeyboardCapture])

  const applyPreset = useCallback((preset: BindPreset) => {
    cancelCapture()
    setDraft((current) => ({
      ...current,
      ...preset.patch,
      editingId: current.editingId
    }))
  }, [cancelCapture])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.ipc.invoke<ActionBinding[]>('actions:getBindings'),
      window.ipc.invoke<EmulationStatus>('actions:emulationStatus')
    ])
      .then(([loadedBindings, loadedStatus]) => {
        if (cancelled) return
        setBindings(loadedBindings)
        setStatus(loadedStatus)
      })
      .catch((error) => showToast(error instanceof Error ? error.message : String(error), 'error'))
    return () => { cancelled = true }
  }, [showToast])

  useEffect(() => {
    setActionRuntimeSuppressed(captureArmed)
    return () => setActionRuntimeSuppressed(false)
  }, [captureArmed])

  useEffect(() => {
    if (previousCaptureTargetRef.current === 'keyboard' && captureTarget !== 'keyboard') {
      clearKeyboardCapture()
    }
    previousCaptureTargetRef.current = captureTarget
  }, [captureTarget, clearKeyboardCapture])

  useEffect(() => {
    if (captureTarget !== 'keyboard') return undefined
    clearKeyboardCapture()

    const updatePreview = (): string[] => {
      const combo = composeKeyboardCombo(heldKeyboardRef.current)
      setKeyboardPreview(combo.join(' + '))
      return combo
    }

    const rememberBestCombo = (combo: string[]): void => {
      if (combo.length >= lastKeyboardComboRef.current.length) {
        lastKeyboardComboRef.current = combo
      }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (isKeyboardCaptureCancel(event)) {
        cancelCapture()
        return
      }
      const token = keyboardTokenFromEvent(event)
      if (token) heldKeyboardRef.current.set(event.code, token)
      else if (isKeyboardModifier(event.code)) heldKeyboardRef.current.set(event.code, event.code)
      rememberBestCombo(updatePreview())
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (isKeyboardCaptureCancel(event)) {
        cancelCapture()
        return
      }
      heldKeyboardRef.current.delete(event.code)
      updatePreview()
      const isFinalRelease = !isKeyboardModifier(event.code) || heldKeyboardRef.current.size === 0
      if (isFinalRelease) {
        const finalCombo = lastKeyboardComboRef.current
        if (finalCombo.length > 0) {
          setDraft((current) => ({
            ...current,
            outputType: 'keyboard',
            keyboardKeys: finalCombo.join('+'),
            keyboardMode: finalCombo.length > 1 && current.keyboardMode === 'press' ? 'chord' : current.keyboardMode,
            label: current.label || finalCombo.join(' + ').toUpperCase()
          }))
          showToast(`Captured ${finalCombo.join(' + ')}`, 'success')
        }
        cancelCapture()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      resetKeyboardCaptureRefs()
    }
  }, [cancelCapture, captureTarget, clearKeyboardCapture, resetKeyboardCaptureRefs, showToast])

  useEffect(() => {
    let frame = 0
    let lastSignature = ''

    const tick = (): void => {
      const connected = listConnectedGamepads()
      const signature = connected.map((gamepad) => `${gamepad.index}:${gamepad.id}:${gamepad.buttons}`).join('|')
      if (signature !== lastSignature) {
        setGamepads(connected)
        lastSignature = signature
      }

      if (captureTarget === 'hid') {
        const pressed = findFirstPressedButton(hidCaptureStateRef.current)
        if (pressed) {
          setDraft((current) => ({
            ...current,
            gamepadIndex: pressed.gamepadIndex,
            gamepadId: pressed.gamepadId,
            buttonIndex: pressed.buttonIndex,
            label: current.label || `Button ${pressed.buttonIndex + 1}`
          }))
          setCaptureTarget(null)
          showToast(`Captured HID button ${pressed.buttonIndex + 1}`, 'success')
        }
      }

      frame = window.requestAnimationFrame(tick)
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [captureTarget, showToast])

  const saveDraft = useCallback(async () => {
    if (draft.buttonIndex === null || draft.gamepadIndex === null) {
      showToast('Capture a HID button before saving.', 'error')
      return
    }
    if (draft.outputType === 'keyboard' && keyboardCommand(draft).keys.length === 0) {
      showToast('Capture or enter a key/combo to emulate.', 'error')
      return
    }
    if (draft.outputType === 'gamepad' && !draft.gamepadButton.trim()) {
      showToast('Enter the virtual gamepad button.', 'error')
      return
    }

    const timestamp = new Date().toISOString()
    const allBindings = await window.ipc.invoke<ActionBinding[]>('actions:getBindings')
    const existing = allBindings.find((binding) => binding.id === draft.editingId)
    const binding: ActionBinding = {
      id: draft.editingId ?? createId(),
      label: draft.label.trim() || `Button ${draft.buttonIndex + 1}`,
      enabled: existing?.enabled ?? true,
      control: {
        ...buildControl(draft),
        gamepadId: draft.gamepadId || selectedGamepad?.id,
        gamepadIndex: draft.gamepadIndex,
        buttonIndex: draft.buttonIndex
      },
      action: buildAction(draft),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    }

    const withoutCurrent = allBindings.filter((item) => item.id !== binding.id)
    await persistBindings([...withoutCurrent, binding])
    setDraft(EMPTY_DRAFT)
    showToast('Binding saved.', 'success')
  }, [draft, persistBindings, selectedGamepad?.id, showToast])

  const deleteBinding = useCallback(async (bindingId: string) => {
    const allBindings = await window.ipc.invoke<ActionBinding[]>('actions:getBindings')
    await persistBindings(allBindings.filter((binding) => binding.id !== bindingId))
    showToast('Binding removed.', 'success')
  }, [persistBindings, showToast])

  const toggleBinding = useCallback(async (bindingId: string) => {
    const allBindings = await window.ipc.invoke<ActionBinding[]>('actions:getBindings')
    await persistBindings(allBindings.map((binding) => (
      binding.id === bindingId ? { ...binding, enabled: !binding.enabled, updatedAt: new Date().toISOString() } : binding
    )))
  }, [persistBindings])

  const testDraft = useCallback(async () => {
    try {
      if (draft.outputType === 'keyboard' || draft.outputType === 'gamepad') {
        const request = draft.outputType === 'keyboard'
          ? { type: 'keyboard' as const, command: keyboardCommand(draft) }
          : { type: 'gamepad' as const, command: gamepadCommand(draft) }
        const result = await window.ipc.invoke<EmulationResult>('actions:testEmulation', request)
        setLastResult(result.message)
        showToast(result.message, result.ok ? 'success' : 'error')
        await refreshStatus()
        return
      }
      if (draft.outputType === 'app') {
        const action = buildAction(draft)
        if (action.type === 'app') {
          const message = await dispatchAppAction(action)
          setLastResult(message)
          showToast(`Executed: ${message}`, 'success')
        }
        return
      }
      showToast('Save the binding and use Test from the list (requires iRacing running).', 'error')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastResult(`Error: ${message}`)
      showToast(message, 'error')
    }
  }, [draft, refreshStatus, showToast])

  const testBinding = useCallback(async (binding: ActionBinding) => {
    try {
      if (binding.action.type === 'app') {
        const message = await dispatchAppAction(binding.action)
        setLastResult(`${binding.label}: ${message}`)
        showToast(`Executed: ${message}`, 'success')
        return
      }
      const result = await window.ipc.invoke<EmulationResult>('actions:trigger', binding.id)
      setLastResult(`${binding.label}: ${result.message}`)
      showToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastResult(`Error: ${message}`)
      showToast(message, 'error')
    }
  }, [showToast])

  return (
    <section className="controls-cockpit">
      <header className="panel-card controls-hero-card">
        <div>
          <span className="panel-label">Controls & Keyboard</span>
          <h3>ButtonBox command deck</h3>
          <p>Map every physical HID button to keyboard macros, a virtual gamepad, iRacing pit/camera commands, or app actions.</p>
        </div>
        <div className="controls-hero-actions">
          <SectionExportImport sectionId="actions" label={tt(language, 'controls.actionsExportLabel')} language={language} onImported={() => void reloadBindings()} />
          <button className="primary-action compact" type="button" onClick={() => setCaptureTarget('hid')}>{captureTarget === 'hid' ? 'Press a HID button…' : 'Capture HID button'}</button>
          <button className="ghost-action compact" type="button" onClick={() => setCaptureTarget('keyboard')}>{captureTarget === 'keyboard' ? 'Press keys…' : 'Capture keyboard combo'}</button>
          {captureArmed && <button className="ghost-action compact danger" type="button" onClick={cancelCapture}>Cancel / Esc</button>}
        </div>
      </header>

      <div className="controls-status-grid">
        <article className={`metric-card ${status.keyboard.available ? 'is-good' : 'is-muted'}`}>
          <span>Keyboard emulator</span>
          <strong>{status.keyboard.available ? 'Ready' : 'Windows only'}</strong>
          <small>{status.keyboard.message}</small>
        </article>
        <article className={`metric-card ${status.gamepad.available ? 'is-good' : 'is-muted'}`}>
          <span>Virtual gamepad</span>
          <strong>{status.gamepad.available ? 'Ready' : 'Needs ViGEmBus'}</strong>
          <small>{status.gamepad.message}</small>
        </article>
        <article className="metric-card is-good">
          <span>Saved bindings</span>
          <strong>{enabledBindings}/{bindings.length}</strong>
          <small>{bindings.length === 0 ? 'No bindings yet' : `${bindings.length - enabledBindings} paused`}</small>
        </article>
        <article className="metric-card is-muted">
          <span>Platform</span>
          <strong>{status.platform}</strong>
          <small>Target runtime is Windows-only for emulation.</small>
        </article>
      </div>

      {captureTarget === 'keyboard' && (
        <div className="keyboard-capture-banner" role="status">
          <div>
            <span className="panel-label">Live capture armed</span>
            <strong>{keyboardPreview || 'Press the keys…'}</strong>
          </div>
          <small>Release the last key to freeze the combo. Escape cancels.</small>
        </div>
      )}

      <div className="quick-preset-rail">
        {BIND_PRESETS.map((preset) => (
          <button className="preset-card" key={preset.id} type="button" onClick={() => applyPreset(preset)}>
            <strong>{preset.title}</strong>
            <small>{preset.subtitle}</small>
          </button>
        ))}
      </div>

      <div className="controls-workbench">
        <section className="panel-card bindings-board full-height scroll-card">
          <div className="panel-heading-row sticky-heading">
            <div>
              <span className="panel-label">Bindings matrix</span>
              <h3>Physical → output</h3>
              <p>Prominent scan-friendly list for enable/disable, edit, test, and cleanup.</p>
            </div>
            <button className="ghost-action compact" type="button" onClick={() => void refreshStatus()}>Refresh status</button>
          </div>

          <div className="binding-table-header">
            <span>Binding</span>
            <span>Input</span>
            <span>Output</span>
            <span>Actions</span>
          </div>
          <div className="binding-table">
            {bindings.length === 0 && <p className="empty-state">No bindings saved. Capture a HID button, choose a preset or output, then save.</p>}
            {bindings.map((binding) => (
              <article className={`binding-row ${binding.enabled ? '' : 'is-disabled'}`} key={binding.id}>
                <div className="binding-title-cell">
                  <span className="binding-led" />
                  <div>
                    <strong>{binding.label}</strong>
                    <small>{binding.enabled ? 'Enabled' : 'Paused'}</small>
                  </div>
                </div>
                <div>
                  <strong>HID {binding.control.gamepadIndex ?? '-'}</strong>
                  <small>Button {binding.control.buttonIndex + 1}{binding.control.switchType && binding.control.switchType !== 'momentary' ? ` · ${SWITCH_TYPE_OPTIONS.find((option) => option.value === binding.control.switchType)?.label ?? binding.control.switchType}` : ''}</small>
                </div>
                <div>
                  <span className="binding-type-pill">{actionTone(binding.action)}</span>
                  <small>{actionLabel(binding.action)}</small>
                </div>
                <div className="profile-actions">
                  <button className="ghost-action compact" type="button" onClick={() => void toggleBinding(binding.id)}>{binding.enabled ? 'Pause' : 'Enable'}</button>
                  <button className="ghost-action compact" type="button" onClick={() => setDraft(draftFromBinding(binding))}>Edit</button>
                  <button className="ghost-action compact" type="button" onClick={() => void testBinding(binding)}>Test</button>
                  <button className="ghost-action compact danger" type="button" onClick={() => void deleteBinding(binding.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel-card binding-editor full-height scroll-card">
          <div className="panel-heading-row">
            <div>
              <span className="panel-label">Rich editor</span>
              <h3>{draft.editingId ? 'Edit binding' : 'New binding'}</h3>
              <p>Arm-and-press for both the physical button and keyboard combo.</p>
            </div>
            <span className="muted-pill">{draft.outputType}</span>
          </div>

          <div className="editor-split">
            <label>
              <span className="field-label">Name</span>
              <input
                className="text-field"
                onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder="Push-to-talk / Fast repair / Dashboard next"
                value={draft.label}
              />
            </label>
            <label>
              <span className="field-label">Output type</span>
              <select className="select-field" value={draft.outputType} onChange={(event) => setDraft((current) => ({ ...current, outputType: event.target.value as OutputType }))}>
                <option value="keyboard">Keyboard / macro</option>
                <option value="gamepad">Virtual gamepad</option>
                <option value="iracing">iRacing command</option>
                <option value="app">App action</option>
              </select>
            </label>
          </div>

          <div className="capture-panel">
            <div>
              <span className="panel-label">Input source</span>
              <strong>{draft.buttonIndex === null ? 'No HID button captured' : `Button ${draft.buttonIndex + 1}`}</strong>
              <small>{selectedGamepad ? selectedGamepad.id : 'Press a hardware button so Chromium exposes it via the Web Gamepad API.'}</small>
            </div>
            <button className="primary-action compact" type="button" onClick={() => setCaptureTarget('hid')}>{captureTarget === 'hid' ? 'Waiting…' : 'Capture button'}</button>
          </div>

          <label className="field-label" htmlFor="controls-gamepad">HID device</label>
          <select
            className="select-field wide"
            id="controls-gamepad"
            value={draft.gamepadIndex ?? ''}
            onChange={(event) => {
              const index = Number(event.target.value)
              const gamepad = gamepads.find((item) => item.index === index)
              setDraft((current) => ({ ...current, gamepadIndex: index, gamepadId: gamepad?.id ?? current.gamepadId }))
            }}
          >
            <option value="" disabled>No device selected</option>
            {gamepads.map((gamepad) => <option key={gamepad.index} value={gamepad.index}>{gamepad.index} · {gamepad.id}</option>)}
          </select>

          <div className="divider" />

          <div className="buttonbox-read-config">
            <span className="panel-label">ButtonBox read</span>
            <p className="helper-text">How this physical input is interpreted before it triggers the output.</p>
            <div className="form-grid compact-grid">
              <label>
                <span>Switch type</span>
                <select
                  className="select-field"
                  value={draft.switchType}
                  onChange={(event) => {
                    const switchType = event.target.value as HidSwitchType
                    setDraft((current) => ({
                      ...current,
                      switchType,
                      // Flip-cover only makes sense pulsing the virtual ignition button.
                      outputType: switchType === 'flip-cover' ? 'gamepad' : current.outputType,
                      buttonType: switchType === 'momentary' ? current.buttonType : 'maintained'
                    }))
                  }}
                >
                  {SWITCH_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Button type</span>
                <select className="select-field" value={draft.buttonType} onChange={(event) => setDraft((current) => ({ ...current, buttonType: event.target.value as HidButtonType }))}>
                  {BUTTON_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                <span>Encoder steps / detent</span>
                <input className="text-field" min={1} step={1} type="number" value={draft.stepsPerDetent} onChange={(event) => setDraft((current) => ({ ...current, stepsPerDetent: Number(event.target.value) }))} />
              </label>
            </div>
            <small className="helper-text">{SWITCH_TYPE_OPTIONS.find((option) => option.value === draft.switchType)?.hint}</small>

            {draft.switchType === 'flip-cover' && (
              <div className="flip-cover-config">
                <p className="helper-text">
                  Flip cover ignition sync — bind iRacing&apos;s <strong>ignition</strong> to this app&apos;s virtual
                  controller (output below). The app pulses one ignition toggle per flip and keeps the car&apos;s
                  engine state matching the cover: cover ON ⇒ ignition ON, cover OFF ⇒ ignition OFF. Engine state
                  is read from telemetry (RPM &gt; threshold proxy).
                </p>
                <div className="form-grid compact-grid">
                  <label>
                    <span>Engine RPM threshold</span>
                    <input className="text-field" min={0} step={50} type="number" value={draft.flipEngineRpmThreshold} onChange={(event) => setDraft((current) => ({ ...current, flipEngineRpmThreshold: Number(event.target.value) }))} />
                  </label>
                  <label>
                    <span>Reconcile debounce (ms)</span>
                    <input className="text-field" min={0} step={100} type="number" value={draft.flipReconcileDebounceMs} onChange={(event) => setDraft((current) => ({ ...current, flipReconcileDebounceMs: Number(event.target.value) }))} />
                  </label>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={draft.flipInvertCover} onChange={(event) => setDraft((current) => ({ ...current, flipInvertCover: event.target.checked }))} />
                    <span>Invert cover (pressed = OFF)</span>
                  </label>
                </div>
                <small className="helper-text">
                  This app must stay running and iRacing&apos;s ignition must be mapped to the app&apos;s virtual
                  controller for the pulse to land; if that iRacing mapping doesn&apos;t crank the starter, a
                  cover-ON / engine-off mismatch can&apos;t fully reconcile.
                </small>
              </div>
            )}
          </div>

          <div className="divider" />

          {draft.outputType === 'keyboard' && (
            <div className="macro-editor">
              <div className="keyboard-capture-field">
                <label>
                  <span className="field-label">Keys</span>
                  <input className="text-field" value={draft.keyboardKeys} onChange={(event) => setDraft((current) => ({ ...current, keyboardKeys: event.target.value }))} placeholder="ctrl+shift+p" />
                </label>
                <button className="primary-action compact" type="button" onClick={() => setCaptureTarget('keyboard')}>{captureTarget === 'keyboard' ? 'Listening…' : 'Capture keys'}</button>
              </div>
              <div className="mode-grid">
                {(['press', 'chord', 'sequence', 'hold', 'toggle', 'repeat'] as KeyboardMode[]).map((mode) => (
                  <button className={`mode-card ${draft.keyboardMode === mode ? 'active' : ''}`} key={mode} type="button" onClick={() => setDraft((current) => ({ ...current, keyboardMode: mode }))}>
                    <strong>{KEYBOARD_MODE_LABELS[mode]}</strong>
                  </button>
                ))}
              </div>
              <div className="form-grid compact-grid">
                <label>
                  <span>Press delay (ms)</span>
                  <input className="text-field" min={0} type="number" value={draft.keyboardPressDelayMs} onChange={(event) => setDraft((current) => ({ ...current, keyboardPressDelayMs: Number(event.target.value) }))} />
                </label>
                <label>
                  <span>{draft.keyboardMode === 'hold' ? 'Hold duration (ms)' : 'Release delay (ms)'}</span>
                  <input className="text-field" min={0} type="number" value={draft.keyboardReleaseDelayMs} onChange={(event) => setDraft((current) => ({ ...current, keyboardReleaseDelayMs: Number(event.target.value) }))} />
                </label>
                <label>
                  <span>{draft.keyboardMode === 'sequence' ? 'Sequence gap (ms)' : 'Tap/chord dwell (ms)'}</span>
                  <input className="text-field" min={0} type="number" value={draft.keyboardDelayMs} onChange={(event) => setDraft((current) => ({ ...current, keyboardDelayMs: Number(event.target.value) }))} />
                </label>
                {draft.keyboardMode === 'repeat' && (
                  <>
                    <label>
                      <span>Repeat rate (ms)</span>
                      <input className="text-field" min={25} type="number" value={draft.keyboardRepeatMs} onChange={(event) => setDraft((current) => ({ ...current, keyboardRepeatMs: Number(event.target.value) }))} />
                    </label>
                    <label>
                      <span>Repeat count</span>
                      <input className="text-field" min={1} type="number" value={draft.keyboardRepeatCount} onChange={(event) => setDraft((current) => ({ ...current, keyboardRepeatCount: Number(event.target.value) }))} />
                    </label>
                  </>
                )}
              </div>
            </div>
          )}

          {draft.outputType === 'gamepad' && (
            <div className="form-grid compact-grid">
              <label>
                <span>Virtual button</span>
                <input className="text-field" value={draft.gamepadButton} onChange={(event) => setDraft((current) => ({ ...current, gamepadButton: event.target.value }))} placeholder="0 or A" />
              </label>
              <label>
                <span>Mode</span>
                <select className="select-field" value={draft.gamepadMode} onChange={(event) => setDraft((current) => ({ ...current, gamepadMode: event.target.value as GamepadMode }))}>
                  <option value="press">Press and release</option>
                  <option value="hold">Timed hold</option>
                  <option value="toggle">Toggle</option>
                </select>
              </label>
              <label>
                <span>Value</span>
                <input className="text-field" max={1} min={0} step={0.1} type="number" value={draft.gamepadValue} onChange={(event) => setDraft((current) => ({ ...current, gamepadValue: Number(event.target.value) }))} />
              </label>
            </div>
          )}

          {draft.outputType === 'iracing' && (
            <div className="form-grid">
              <label>
                <span>Command</span>
                <select className="select-field" value={draft.iracingCommand} onChange={(event) => setDraft((current) => ({ ...current, iracingCommand: event.target.value as IracingCommandName }))}>
                  {IRACING_COMMANDS.map((command) => <option key={command.name} value={command.name}>{command.label}</option>)}
                </select>
              </label>
              {draft.iracingCommand === 'pit:addFuel' && (
                <label>
                  <span>Liters</span>
                  <input className="text-field" min={0} step={1} type="number" value={draft.fuelLiters} onChange={(event) => setDraft((current) => ({ ...current, fuelLiters: Number(event.target.value) }))} />
                </label>
              )}
            </div>
          )}

          {draft.outputType === 'app' && (
            <div className="form-grid">
              <label>
                <span>Action</span>
                <select className="select-field" value={draft.appAction} onChange={(event) => setDraft((current) => ({ ...current, appAction: event.target.value as AppActionName }))}>
                  {APP_ACTIONS.map((action) => <option key={action.name} value={action.name}>{action.label}</option>)}
                </select>
              </label>
              {draft.appAction === 'oled:setActivePage' ? (
                <label>
                  <span>OLED page index</span>
                  <input className="text-field" min={0} type="number" value={draft.oledPage} onChange={(event) => setDraft((current) => ({ ...current, oledPage: Number(event.target.value) }))} />
                </label>
              ) : draft.appAction === 'overlays:toggle' ? (
                <label>
                  <span>Overlay</span>
                  <select className="select-field" value={draft.overlayId} onChange={(event) => setDraft((current) => ({ ...current, overlayId: event.target.value }))}>
                    {OVERLAY_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
                  </select>
                </label>
              ) : (
                <p className="helper-text">The dashboard playlist is configured in Dashboards. This action cycles the open race window while the sim has focus.</p>
              )}
            </div>
          )}

          {needsEmulation && !(draft.outputType === 'keyboard' ? status.keyboard.available : status.gamepad.available) && (
            <p className="helper-text">Current status: {draft.outputType === 'keyboard' ? status.keyboard.message : status.gamepad.message}</p>
          )}
          <code className="payload-preview">{JSON.stringify(buildAction(draft), null, 2)}</code>

          <div className="action-row">
            <button className="primary-action compact" type="button" onClick={() => void saveDraft()}>Save binding</button>
            <button className="ghost-action compact" type="button" onClick={() => void testDraft()}>Test output</button>
            <button className="ghost-action compact" type="button" onClick={() => setDraft(EMPTY_DRAFT)}>Clear</button>
          </div>

          <div className="divider" />
          <p className="helper-text">Last result: {lastResult}</p>
        </aside>
      </div>
    </section>
  )
}

export default ControlsView
