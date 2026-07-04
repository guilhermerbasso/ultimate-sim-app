export type ActionKind = 'iracing' | 'app' | 'keyboard' | 'gamepad'

export type IracingCommandGroup = 'pit' | 'camera' | 'blackBox'

export type IracingCommandName =
  | 'pit:addFuel'
  | 'pit:clearFuel'
  | 'pit:toggleTyreLf'
  | 'pit:toggleTyreRf'
  | 'pit:toggleTyreLr'
  | 'pit:toggleTyreRr'
  | 'pit:fastRepair'
  | 'pit:clearAll'
  | 'camera:next'
  | 'camera:previous'
  | 'blackBox:next'
  | 'blackBox:previous'

export interface IracingCommand {
  group: IracingCommandGroup
  name: IracingCommandName
  fuelLiters?: number
}

export type AppActionName = 'oled:setActivePage' | 'overlays:toggle' | 'dash:cycleNext' | 'dash:cyclePrev'

export interface AppActionCommand {
  name: AppActionName
  pageIndex?: number
  overlayId?: string
}

export interface KeyboardMacroCommand {
  mode: 'press' | 'chord' | 'sequence' | 'hold' | 'toggle' | 'repeat'
  keys: string[]
  delayMs?: number
  pressDelayMs?: number
  releaseDelayMs?: number
  repeatMs?: number
  repeatCount?: number
}

export interface GamepadEmulationCommand {
  button: number | string
  value?: number
  mode: 'press' | 'hold' | 'toggle'
}

export interface EmulationCapability {
  available: boolean
  message: string
}

export interface EmulationStatus {
  platform: string
  keyboard: EmulationCapability
  gamepad: EmulationCapability
}

export type EmulationTestRequest =
  | { type: 'keyboard'; command: KeyboardMacroCommand }
  | { type: 'gamepad'; command: GamepadEmulationCommand }

// How the physical contact behind a HID button is interpreted by the renderer
// action runtime:
//  - 'momentary'        push button — fire the action on the rising edge (press). Default.
//  - 'toggle'           maintained on/off switch — fire only when it is turned ON
//                       (rising edge). Matches iRacing toggles; leaves the classic
//                       "stuck off" issue for flip covers.
//  - 'pulse-both-edges' maintained switch — fire ONE pulse on EVERY position change
//                       (On→Off AND Off→On). One flip = one action.
//  - 'flip-cover'       maintained on/off cover wired to an iRacing toggle (ignition).
//                       Pulses on both edges AND keeps the sim state in sync by
//                       reconciling the cover position against the engine-running
//                       proxy (see FlipCoverConfig).
export type HidSwitchType = 'momentary' | 'toggle' | 'pulse-both-edges' | 'flip-cover'

// Physical button construction — informational descriptor surfaced in the UI so the
// runtime/user knows whether the input rests open (push) or latches (maintained).
export type HidButtonType = 'push' | 'maintained'

// Flip-cover ignition reconcile tuning. The renderer compares the cover position to
// the iRacing engine-running proxy and only pulses the virtual ignition button when
// they disagree, debounced so it never fights the user or telemetry lag.
export interface FlipCoverConfig {
  // RPM above which the engine counts as "running" (proxy for ignition on). Default 200.
  engineRpmThreshold?: number
  // Minimum gap between reconcile pulses, in ms. Default 1500.
  reconcileDebounceMs?: number
  // When true, a PRESSED contact means cover OFF (inverted wiring). Default false.
  invertCover?: boolean
}

export interface HidButtonControl {
  source: 'gamepad'
  gamepadId?: string
  gamepadIndex?: number
  buttonIndex: number
  // How the physical contact is read. Absent → 'momentary' (back-compat with
  // bindings saved before the read-config feature existed).
  switchType?: HidSwitchType
  // Construction descriptor (push vs maintained), informational only.
  buttonType?: HidButtonType
  // Encoder detent option: fire the action once per N rising edges. Absent/1 → every
  // edge. Useful for encoders that emit several pulses per physical detent.
  stepsPerDetent?: number
  // Reconcile tuning used only when switchType === 'flip-cover'.
  flipCover?: FlipCoverConfig
}

export type ActionDefinition =
  | { type: 'iracing'; command: IracingCommand }
  | { type: 'app'; command: AppActionCommand }
  | { type: 'keyboard'; command: KeyboardMacroCommand }
  | { type: 'gamepad'; command: GamepadEmulationCommand }

export interface ActionBinding {
  id: string
  label: string
  enabled: boolean
  control: HidButtonControl
  action: ActionDefinition
  createdAt: string
  updatedAt: string
}

export interface ActionBindingsStore {
  version: 1
  bindings: ActionBinding[]
  updatedAt: string
}

export interface ActionTriggerResult {
  ok: boolean
  bindingId: string
  actionType: ActionKind
  message: string
  executedAt: string
}
