// Arduino Setup Wizard — the in-app, SimHub-style "pick a module → flash
// prebuilt firmware → it just works" flow, but friendlier: every step explains
// the wiring, shows the exact avrdude command, and gives targeted
// troubleshooting when a flash fails.
//
// Steps: modulo → placa → porta → gravar (log ao vivo) → pronto.
// The heavy lifting (avrdude, the 1200bps touch, the capability handshake and
// the auto-created Hardware Hub profile) all happen in main; this component
// only drives the SETUP_CHANNELS IPC contract and renders progress.

import { useFocusTrap } from '../../lib/useFocusTrap'
import { type CSSProperties, type ReactElement, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import {
  FLASH_BOARDS,
  SETUP_CHANNELS,
  SETUP_MODULES,
  buildAvrdudeCommandPreview,
  findFlashBaud,
  findFlashBoard,
  findModuleFirmware,
  findSetupModule,
  moduleSupportsBoard,
  type FlashBoardGuess,
  type FlashBoardId,
  type FlashBoardSpec,
  type FlashProgress,
  type FlashRequest,
  type FlashResult,
  type SetupModule
} from '../../../../shared/setup'
import type { PortInfo } from '../../../../shared/ipc'
import type { SerialDeviceSummary } from '../../../../shared/arduino'
import {
  BOARDS,
  COMPONENT_TYPES,
  DEVICES_CHANNELS,
  type BoardId,
  type ComponentType,
  type DeviceComponent,
  type DeviceProfile,
  createComponent,
  findBoard
} from '../../../../shared/devices'
import { ComponentEditor } from './ComponentEditor'
import { Field, NumberField, SelectField, TextField } from './controls'
import type { SelectOption } from './controls'
import type { ResolvedLanguage } from '../../i18n'
import { tt } from '../../i18n'
import {
  ACCENT,
  ACCENT_BORDER,
  ACCENT_SOFT,
  buttonStyle,
  card,
  getErrorMessage,
  helper,
  label,
  panel
} from './styles'

type WizardStep = 'module' | 'board' | 'port' | 'flash'
const CANCEL_FLASH_CHANNEL = 'arduinosetup:cancelFlash'
const DUMP_HEX_CHANNEL = 'arduinosetup:dumpHex'

interface DumpHexResult {
  ok: boolean
  message: string
  path?: string
}

type IdentifiedPortInfo = PortInfo & {
  identify?: {
    status: 'identified' | 'unknown' | 'busy' | 'error'
    label: string
    detail?: string
    capabilities?: Array<{ key: string; detail: string }>
    // Additive identify fields surfaced by the main-process identify (no new IPC):
    // true when the device answered the companion `?` handshake / the iFlag
    // RGB-matrix protocol, plus a USB-descriptor board guess for preselection.
    speaksCompanion?: boolean
    speaksMatrix?: boolean
    boardGuess?: FlashBoardGuess
  }
}

interface LogLine {
  message: string
  tone: 'info' | 'success' | 'error'
}

interface SetupWizardProps {
  onClose: () => void
  onComplete: (profileId: string, navigateType?: ComponentType) => void | Promise<void>
  onFlashSettled?: () => void | Promise<void>
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void
  onboardingDevice?: SerialDeviceSummary
  language?: ResolvedLanguage
}

const STEP_LABELS: Array<{ id: WizardStep; label: string }> = [
  { id: 'module', label: 'Module' },
  { id: 'board', label: 'Board' },
  { id: 'port', label: 'Port' },
  { id: 'flash', label: 'Flash' }
]

// Preselect the module's recommended bootloader baud when the chosen board is
// the module's recommended board and actually offers that option; otherwise fall
// back to the board's generic default. The flasher still auto-retries the other
// Optiboot speed, so this only improves the first-attempt UX (e.g. the iFlag
// Nano ships on the old/57600 bootloader).
function preselectBaudId(module: SetupModule | null, board: FlashBoardSpec | null | undefined): string | undefined {
  if (!board) return undefined
  if (
    module?.recommendedBaudId &&
    board.id === module.recommendedBoard &&
    board.baudOptions.some((option) => option.id === module.recommendedBaudId)
  ) {
    return module.recommendedBaudId
  }
  return board.defaultBaudId
}

export function SetupWizard({ onClose, onComplete, onFlashSettled, showToast, onboardingDevice, language }: SetupWizardProps): ReactElement {
  const [step, setStep] = useState<WizardStep>('module')
  const [moduleId, setModuleId] = useState<string | null>(null)
  const [boardId, setBoardId] = useState<FlashBoardId | null>(null)
  const [baudId, setBaudId] = useState<string | undefined>(undefined)
  const [port, setPort] = useState<string | null>(null)
  const [ports, setPorts] = useState<IdentifiedPortInfo[]>([])
  const [loadingPorts, setLoadingPorts] = useState(false)
  const [flashing, setFlashing] = useState(false)
  const [dumping, setDumping] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const [percent, setPercent] = useState(0)
  const [result, setResult] = useState<FlashResult | null>(null)
  const [showCommand, setShowCommand] = useState(false)
  const [replaceSerialIdentity, setReplaceSerialIdentity] = useState(false)
  const [replacementReason, setReplacementReason] = useState('')

  const logEndRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(true)

  const selectedModule = useMemo(() => (moduleId ? findSetupModule(moduleId) : null), [moduleId])
  const selectedBoard = useMemo(() => (boardId ? findFlashBoard(boardId) : null), [boardId])
  const availableBoards = useMemo(
    () => (selectedModule ? FLASH_BOARDS.filter((b) => moduleSupportsBoard(selectedModule, b.id)) : []),
    [selectedModule]
  )
  const baud = useMemo(
    () => (selectedBoard ? findFlashBaud(selectedBoard, baudId) : null),
    [selectedBoard, baudId]
  )
  // USB board guess from identify, preferring the selected port — surfaced so the
  // board/baud preselection stays transparent.
  const detectedGuess = useMemo<FlashBoardGuess | undefined>(() => {
    const selected = ports.find((info) => info.path === port)?.identify?.boardGuess
    return selected ?? ports.find((info) => info.identify?.boardGuess)?.identify?.boardGuess
  }, [ports, port])

  // Live flash progress (broadcast from main during a flash).
  useEffect(() => {
    const unsubscribe = window.ipc.subscribe<FlashProgress>(SETUP_CHANNELS.progress, (progress) => {
      setLog((prev) => [...prev, { message: progress.message, tone: progress.tone ?? 'info' }])
      if (typeof progress.percent === 'number') setPercent(progress.percent)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [log])

  async function loadPorts(): Promise<void> {
    setLoadingPorts(true)
    try {
      const list = await window.ipc.invoke<IdentifiedPortInfo[]>(SETUP_CHANNELS.listPorts)
      if (!mountedRef.current) return
      setPorts(list)
    } catch (error) {
      if (!mountedRef.current) return
      showToast(getErrorMessage(error), 'error')
    } finally {
      if (mountedRef.current) setLoadingPorts(false)
    }
  }

  function pickModule(module: SetupModule): void {
    if (module.status !== 'available') return
    setModuleId(module.id)
    const recommended = findFlashBoard(module.recommendedBoard)
    setBoardId(recommended ? recommended.id : null)
    setBaudId(preselectBaudId(module, recommended))
    setStep('board')
  }

  function pickBoard(board: FlashBoardSpec): void {
    setBoardId(board.id)
    setBaudId(preselectBaudId(selectedModule, board))
    setStep('port')
    void loadPorts()
  }

  // Picking a port also preselects the flash board + baud from the USB board
  // guess (when the chosen module offers that board). This is the fix for the
  // classic stk500 not-in-sync error: a 32U4 iFlag flashed with the 328P
  // 'arduino' programmer. We only auto-switch to a board the module supports.
  function pickPort(path: string): void {
    setPort(path)
    setReplaceSerialIdentity(false)
    setReplacementReason('')
    const guess = ports.find((info) => info.path === path)?.identify?.boardGuess
    if (!guess) return
    const guessedBoard = availableBoards.find((board) => board.id === guess.boardId)
    if (guessedBoard && guessedBoard.id !== boardId) {
      setBoardId(guessedBoard.id)
      setBaudId(preselectBaudId(selectedModule, guessedBoard))
      showToast(`Board set to ${guessedBoard.name} via USB detection. ${guess.reason}`, 'info')
    }
  }

  function goToFlash(): void {
    setStep('flash')
    setResult(null)
    setLog([])
    setPercent(0)
  }

  async function startFlash(): Promise<void> {
    if (!selectedModule || !selectedBoard || !port) return
    setFlashing(true)
    setResult(null)
    setLog([{ message: `Starting flash for ${selectedModule.name}…`, tone: 'info' }])
    setPercent(2)
    const request: FlashRequest = {
      moduleId: selectedModule.id,
      board: selectedBoard.id,
      port,
      baudId,
      replaceSerialIdentity,
      replacementReason: replaceSerialIdentity ? replacementReason.trim() : undefined
    }
    try {
      const res = await window.ipc.invoke<FlashResult>(SETUP_CHANNELS.flash, request)
      if (!mountedRef.current) return
      setResult(res)
      if (res.ok && res.verified) {
        showToast(res.message, 'success')
      } else {
        showToast(res.message || 'Could not finish flashing.', 'error')
      }
    } catch (error) {
      if (!mountedRef.current) return
      const message = getErrorMessage(error)
      setResult({ ok: false, verified: false, message, port: port ?? '', board: selectedBoard.id, capabilities: [] })
      showToast(message, 'error')
    } finally {
      if (mountedRef.current) {
        setFlashing(false)
        setPercent((prev) => (prev < 100 ? 100 : prev))
      }
      // Re-enumerate serial after the post-flash board reset so "My Hardware" shows
      // the device as connected — without auto-closing the wizard, so the user can
      // still reach the success screen (Dump hex / "Go to device").
      try {
        await onFlashSettled?.()
      } catch (error) {
        if (mountedRef.current) showToast(getErrorMessage(error), 'error')
      }
    }
  }

  async function startDumpHex(): Promise<void> {
    if (!selectedBoard || !port) return
    setDumping(true)
    setResult(null)
    setLog([
      {
        message:
          'Starting .hex backup. This saves the board compiled firmware; it does not reverse-engineer or identify functions automatically.',
        tone: 'info'
      }
    ])
    setPercent(2)
    try {
      const res = await window.ipc.invoke<DumpHexResult>(DUMP_HEX_CHANNEL, {
        board: selectedBoard.id,
        port,
        baudId
      })
      if (!mountedRef.current) return
      showToast(res.message, res.ok ? 'success' : 'error')
    } catch (error) {
      if (!mountedRef.current) return
      showToast(getErrorMessage(error), 'error')
    } finally {
      if (mountedRef.current) {
        setDumping(false)
        setPercent((prev) => (prev < 100 ? 100 : prev))
      }
    }
  }

  async function cancelActiveOperation(): Promise<void> {
    if (!flashing && !dumping) return
    try {
      await window.ipc.invoke(CANCEL_FLASH_CHANNEL)
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      if (mountedRef.current) {
        setFlashing(false)
        setDumping(false)
      }
    }
  }

  function closeWizard(): void {
    void cancelActiveOperation()
    onClose()
  }

  async function handleComplete(): Promise<void> {
    if (result?.profileId) await onComplete(result.profileId)
    onClose()
  }

  const canFlash = Boolean(selectedModule && selectedBoard && port && !flashing && !dumping)

  if (onboardingDevice) {
    return <OnboardingWizard device={onboardingDevice} onClose={onClose} onComplete={onComplete} showToast={showToast} language={language} />
  }

  const focusTrap = useFocusTrap<HTMLDivElement>({ onEscape: onClose })

  return (
    <div style={overlay} ref={focusTrap.containerRef} onKeyDown={focusTrap.onKeyDown} role="dialog" aria-modal="true" aria-label="Arduino setup">
      <div style={modal}>
        {/* Header + stepper */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <span style={label}>Setup / Flash firmware</span>
            <h2 style={{ margin: '6px 0 0', fontSize: 22 }}>Firmware flash assistant</h2>
            <p style={{ ...helper, marginTop: 4 }}>
              Choose a module, connect the board, and flash the ready firmware. No Arduino IDE, no code.
            </p>
          </div>
          <button style={buttonStyle('ghost')} onClick={closeWizard} type="button" aria-label="Close">
            ✕
          </button>
        </div>

        <Stepper current={step} />

        <div style={{ marginTop: 16 }}>
          {step === 'module' && <ModuleStep onPick={pickModule} selectedId={moduleId} />}

          {step === 'board' && selectedModule && (
            <BoardStep
              module={selectedModule}
              boards={availableBoards}
              selectedBoardId={boardId}
              baudId={baudId}
              detectedGuess={detectedGuess}
              onPickBoard={pickBoard}
              onPickBaud={setBaudId}
              onBack={() => setStep('module')}
            />
          )}

          {step === 'port' && selectedModule && selectedBoard && (
            <PortStep
              module={selectedModule}
              board={selectedBoard}
              ports={ports}
              loading={loadingPorts}
              selectedPort={port}
              onPick={pickPort}
              onRefresh={() => void loadPorts()}
              onBack={() => setStep('board')}
              onNext={goToFlash}
            />
          )}

          {step === 'flash' && selectedModule && selectedBoard && baud && (
            <FlashStep
              module={selectedModule}
              board={selectedBoard}
              port={port}
              baudLabel={baud.label}
              command={buildAvrdudeCommandPreview(
                selectedBoard,
                port ?? '',
                baud.baud,
                findModuleFirmware(selectedModule, selectedBoard.id)?.hex ?? `${selectedModule.id}.hex`
              )}
              showCommand={showCommand}
              onToggleCommand={() => setShowCommand((v) => !v)}
              flashing={flashing}
              dumping={dumping}
              log={log}
              percent={percent}
              result={result}
              canFlash={canFlash && (!replaceSerialIdentity || replacementReason.trim().length >= 10)}
              replaceSerialIdentity={replaceSerialIdentity}
              replacementReason={replacementReason}
              onReplaceSerialIdentity={setReplaceSerialIdentity}
              onReplacementReason={setReplacementReason}
              logEndRef={logEndRef}
              onFlash={() => void startFlash()}
              onDumpHex={() => void startDumpHex()}
              onCancel={() => void cancelActiveOperation()}
              onBack={() => setStep('port')}
              onComplete={handleComplete}
              onClose={closeWizard}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Stepper ──────────────────────────────────────────────────────────────────


type OnboardingStep = 'connected' | 'identity' | 'components' | 'route'
const ONBOARDING_STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: 'connected', label: 'Connected' }, { id: 'identity', label: 'Identity' }, { id: 'components', label: 'Components' }, { id: 'route', label: 'Open editor' }
]
const BOARD_OPTIONS: ReadonlyArray<SelectOption<BoardId>> = BOARDS.map((board) => ({ value: board.id, label: board.name }))
const COMPONENT_OPTIONS: ReadonlyArray<SelectOption<ComponentType>> = COMPONENT_TYPES.map((info) => ({ value: info.type, label: info.name }))

function OnboardingWizard({ device, onClose, onComplete, showToast, language }: { device: SerialDeviceSummary; onClose: () => void; onComplete: (profileId: string, navigateType?: ComponentType) => void | Promise<void>; showToast: (message: string, tone?: 'success' | 'error' | 'info') => void; language?: ResolvedLanguage }): ReactElement {
  const [step, setStep] = useState<OnboardingStep>('connected')
  const [name, setName] = useState(device.label || device.path || 'Arduino')
  const [board, setBoard] = useState<BoardId>('generic')
  const [baud, setBaud] = useState(device.baud || findBoard('generic').defaultBaud)
  const [componentType, setComponentType] = useState<ComponentType>('rgbMatrix')
  const [component, setComponent] = useState<DeviceComponent>(() => createComponent('rgbMatrix'))
  const [savedProfile, setSavedProfile] = useState<DeviceProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const conflicts = useMemo(() => new Set<string>(), [])
  function pickComponentType(type: ComponentType): void { setComponentType(type); setComponent(createComponent(type)) }
  async function saveProfile(): Promise<void> {
    setSaving(true)
    try {
      const saved = await window.ipc.invoke<DeviceProfile>(DEVICES_CHANNELS.save, { label: name.trim() || device.label || device.path || 'Arduino', board, baud: Number.isFinite(baud) && baud > 0 ? baud : findBoard(board).defaultBaud, deviceId: device.id, port: device.path, components: [component] })
      setSavedProfile(saved); showToast(tt(language, 'arduinos.onboarding.savedToast', { name: saved.label }), 'success'); setStep('route')
    } catch (error) { showToast(getErrorMessage(error), 'error') } finally { setSaving(false) }
  }
  async function finish(navigate = true): Promise<void> { if (!savedProfile) return; await onComplete(savedProfile.id, navigate ? componentType : undefined); onClose() }
  const focusTrap = useFocusTrap<HTMLDivElement>({ onEscape: onClose })
  return (
    <div style={overlay} ref={focusTrap.containerRef} onKeyDown={focusTrap.onKeyDown} role="dialog" aria-modal="true" aria-label={tt(language, 'arduinos.onboarding.title')}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}><div><span style={label}>{tt(language, 'arduinos.onboarding.eyebrow')}</span><h2 style={{ margin: '6px 0 0', fontSize: 22 }}>{tt(language, 'arduinos.onboarding.title')}</h2><p style={{ ...helper, marginTop: 4 }}>{tt(language, 'arduinos.onboarding.subtitle')}</p></div><button style={buttonStyle('ghost')} onClick={onClose} type="button" aria-label="Close">x</button></div>
        <OnboardingStepper current={step} />
        <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
          {step === 'connected' && <><div style={card}><span style={label}>{tt(language, 'arduinos.onboarding.connected')}</span><h3 style={{ margin: '6px 0 4px' }}>{device.label}</h3><p style={helper}>{device.path} - {device.kind} - {device.baud} baud - {device.connected ? tt(language, 'arduinos.status.online') : tt(language, 'arduinos.status.offline')}</p></div><div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={buttonStyle('primary')} type="button" onClick={() => setStep('identity')}>{tt(language, 'arduinos.onboarding.setupIdentity')}</button></div></>}
          {step === 'identity' && <><div style={{ display: 'grid', gap: 12 }}><Field caption="Name"><TextField value={name} onChange={setName} /></Field><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><Field caption="Board"><SelectField value={board} options={BOARD_OPTIONS} onChange={(next) => { setBoard(next); setBaud(findBoard(next).defaultBaud) }} /></Field><Field caption="Baud"><NumberField value={baud} min={300} max={2000000} onChange={setBaud} /></Field></div><Field caption="Linked serial port"><code style={{ ...card, display: 'block' }}>{device.label} - {device.path}</code></Field></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><button style={buttonStyle('ghost')} type="button" onClick={() => setStep('connected')}>Back</button><button style={buttonStyle('primary')} type="button" onClick={() => setStep('components')}>{tt(language, 'arduinos.onboarding.setupComponents')}</button></div></>}
          {step === 'components' && <><Field caption={tt(language, 'arduinos.onboarding.componentType')}><SelectField value={componentType} options={COMPONENT_OPTIONS} onChange={pickComponentType} /></Field><div style={card}><Field caption="Component name"><TextField value={component.label} onChange={(labelText) => setComponent({ ...component, label: labelText })} /></Field></div><ComponentEditor component={component} board={findBoard(board)} conflicts={conflicts} onChange={setComponent} language={language} /><div style={{ display: 'flex', justifyContent: 'space-between' }}><button style={buttonStyle('ghost')} type="button" onClick={() => setStep('identity')}>Back</button><button style={buttonStyle('primary')} type="button" disabled={saving} onClick={() => void saveProfile()}>{saving ? 'Saving...' : tt(language, 'arduinos.onboarding.saveAndContinue')}</button></div></>}
          {step === 'route' && savedProfile && <><div style={{ ...card, borderColor: ACCENT_BORDER }}><span style={label}>{tt(language, 'arduinos.onboarding.ready')}</span><h3 style={{ margin: '6px 0 4px' }}>{savedProfile.label}</h3><p style={helper}>{tt(language, 'arduinos.onboarding.routeHelp')}</p></div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><button style={buttonStyle('ghost')} type="button" onClick={() => void finish(false)}>{tt(language, 'arduinos.onboarding.stayHere')}</button><button style={buttonStyle('primary')} type="button" onClick={() => void finish(true)}>{tt(language, 'arduinos.onboarding.openEditor')}</button></div></>}
        </div>
      </div>
    </div>
  )
}

function OnboardingStepper({ current }: { current: OnboardingStep }): ReactElement {
  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.id === current)
  return <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>{ONBOARDING_STEPS.map((entry, index) => { const done = index < currentIndex; const active = index === currentIndex; return <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}><div style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, background: active || done ? ACCENT : 'rgba(255,255,255,0.08)', color: active || done ? '#06121f' : 'rgba(255,255,255,0.6)', flexShrink: 0 }}>{done ? 'ok' : index + 1}</div><span style={{ fontSize: 12.5, fontWeight: active ? 800 : 600, color: active ? '#fff' : 'rgba(255,255,255,0.55)' }}>{entry.label}</span>{index < ONBOARDING_STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />}</div> })}</div>
}

function Stepper({ current }: { current: WizardStep }): ReactElement {
  const currentIndex = STEP_LABELS.findIndex((s) => s.id === current)
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
      {STEP_LABELS.map((entry, index) => {
        const done = index < currentIndex
        const active = index === currentIndex
        return (
          <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontSize: 12,
                fontWeight: 800,
                background: active || done ? ACCENT : 'rgba(255,255,255,0.08)',
                color: active || done ? '#06121f' : 'rgba(255,255,255,0.6)',
                flexShrink: 0
              }}
            >
              {done ? '✓' : index + 1}
            </div>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: active ? 800 : 600,
                color: active ? '#fff' : 'rgba(255,255,255,0.55)'
              }}
            >
              {entry.label}
            </span>
            {index < STEP_LABELS.length - 1 && (
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: module ─────────────────────────────────────────────────────────

function ModuleStep({
  onPick,
  selectedId
}: {
  onPick: (module: SetupModule) => void
  selectedId: string | null
}): ReactElement {
  return (
    <div>
      <p style={helper}>What do you want to build? Start with the iFlag matrix — it is the easiest module.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        {SETUP_MODULES.map((module) => {
          const available = module.status === 'available'
          const isSelected = module.id === selectedId
          return (
            <button
              key={module.id}
              type="button"
              disabled={!available}
              onClick={() => onPick(module)}
              style={{
                ...card,
                textAlign: 'left',
                cursor: available ? 'pointer' : 'not-allowed',
                opacity: available ? 1 : 0.55,
                borderColor: isSelected ? ACCENT : 'rgba(255,255,255,0.1)',
                background: isSelected ? ACCENT_SOFT : card.background
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{module.name}</strong>
                {available ? (
                  <span style={difficultyBadge}>{module.difficulty}</span>
                ) : (
                  <span style={{ ...difficultyBadge, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', borderColor: 'transparent' }}>
                    coming soon
                  </span>
                )}
              </div>
              <p style={{ ...helper, marginTop: 6 }}>{module.tagline}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Step 2: board ────────────────────────────────────────────────────────────

function BoardStep({
  module,
  boards,
  selectedBoardId,
  baudId,
  detectedGuess,
  onPickBoard,
  onPickBaud,
  onBack
}: {
  module: SetupModule
  boards: FlashBoardSpec[]
  selectedBoardId: FlashBoardId | null
  baudId: string | undefined
  detectedGuess?: FlashBoardGuess
  onPickBoard: (board: FlashBoardSpec) => void
  onPickBaud: (baudId: string) => void
  onBack: () => void
}): ReactElement {
  const selected = boards.find((b) => b.id === selectedBoardId) ?? null
  return (
    <div>
      <p style={helper}>
        Which board will you use for the <strong>{module.name}</strong>? The recommended one is the cheapest and simplest.
      </p>
      {detectedGuess && (
        <div style={guessBanner}>
          <strong style={{ fontSize: 12.5 }}>🔌 Detected pela USB: {detectedGuess.label}</strong>
          <p style={{ ...helper, marginTop: 4 }}>{detectedGuess.reason}</p>
          {detectedGuess.needsAvr109 && (
            <p style={{ ...helper, marginTop: 4, color: '#ffd37a' }}>
              Bootloader Caterina (avr109 + reset 1200 bps) — not use o programmer “arduino”/stk500.
            </p>
          )}
        </div>
      )}
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {boards.map((board) => {
          const isRecommended = board.id === module.recommendedBoard
          const isSelected = board.id === selectedBoardId
          return (
            <button
              key={board.id}
              type="button"
              onClick={() => onPickBoard(board)}
              style={{
                ...card,
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: isSelected ? ACCENT : 'rgba(255,255,255,0.1)',
                background: isSelected ? ACCENT_SOFT : card.background
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{board.name}</strong>
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {detectedGuess?.boardId === board.id && <span style={detectedBadge}>detected by USB</span>}
                  {isRecommended && <span style={difficultyBadge}>recomendada</span>}
                </span>
              </div>
              {board.hint && <p style={{ ...helper, marginTop: 6 }}>{board.hint}</p>}
            </button>
          )
        })}
      </div>

      {selected && selected.baudOptions.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <span style={label}>Bootloader / speed</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {selected.baudOptions.map((option) => {
              const active = (baudId ?? selected.defaultBaudId) === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onPickBaud(option.id)}
                  style={buttonStyle('soft', active)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <p style={{ ...helper, marginTop: 6 }}>
            Clones with a CH340 chip (Nano/Uno) usually need the <strong>old bootloader (57600)</strong> if flashing fails right at the start.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        <button style={buttonStyle('ghost')} onClick={onBack} type="button">
          ← Back
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: port ─────────────────────────────────────────────────────────────

function PortStep({
  module,
  board,
  ports,
  loading,
  selectedPort,
  onPick,
  onRefresh,
  onBack,
  onNext
}: {
  module: SetupModule
  board: FlashBoardSpec
  ports: IdentifiedPortInfo[]
  loading: boolean
  selectedPort: string | null
  onPick: (port: string) => void
  onRefresh: () => void
  onBack: () => void
  onNext: () => void
}): ReactElement {
  return (
    <div>
      <WiringPanel module={module} board={board} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <span style={label}>Serial port</span>
        <button style={buttonStyle('ghost')} onClick={onRefresh} type="button" disabled={loading}>
          {loading ? 'Procurando…' : 'Refresh'}
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {ports.length === 0 && (
          <p style={helper}>
            {loading
              ? 'Procurando portas…'
              : 'No port found. Connect the board over USB (data cable) and click Refresh.'}
          </p>
        )}
        {ports.map((info) => {
          const isSelected = info.path === selectedPort
          return (
            <button
              key={info.path}
              type="button"
              onClick={() => onPick(info.path)}
              style={{
                ...card,
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: isSelected ? ACCENT : 'rgba(255,255,255,0.1)',
                background: isSelected ? ACCENT_SOFT : card.background
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{info.path}</strong>
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {info.identify?.speaksMatrix && <span style={matrixBadge}>iFlag / RGB Matrix</span>}
                  {info.isSimX && <span style={{ ...difficultyBadge, background: 'rgba(209,52,56,0.16)', color: '#ff9a9c', borderColor: 'rgba(209,52,56,0.5)' }}>SIM-X — not use</span>}
                </span>
              </div>
              {(info.friendlyName || info.manufacturer) && (
                <p style={{ ...helper, marginTop: 4 }}>{info.friendlyName ?? info.manufacturer}</p>
              )}
              {info.identify && (
                <p
                  style={{
                    ...helper,
                    marginTop: 4,
                    color:
                      info.identify.status === 'identified'
                        ? '#7ee2b8'
                        : info.identify.status === 'busy'
                          ? '#ffd37a'
                          : 'rgba(255,255,255,0.55)'
                  }}
                >
                  Identify: {info.identify.label}
                  {info.identify.detail ? ` — ${info.identify.detail}` : ''}
                </p>
              )}
              {info.identify?.boardGuess && info.identify.status !== 'unknown' && (
                <p style={{ ...helper, marginTop: 4 }}>
                  Placa (USB): {info.identify.boardGuess.label} — {info.identify.boardGuess.reason}
                </p>
              )}
              {info.identify &&
                info.identify.status !== 'busy' &&
                info.identify.speaksMatrix !== true &&
                info.identify.speaksCompanion !== true &&
                info.identify.boardGuess && (
                  <p style={companionPrompt}>
                    ⚠ Firmware not‑companion (ex.: SimHub/WLED) — flash the module companion firmware so the board lights up and is recognized.
                  </p>
                )}
            </button>
          )
        })}
      </div>

      {selectedPort && ports.find((p) => p.path === selectedPort)?.isSimX && (
        <p style={{ ...helper, color: '#ff9a9c', marginTop: 8 }}>
          ⚠ Essa porta parece ser o SIM-X principal. Nao grave firmware nele por aqui — escolha um Arduino secondary.
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        <button style={buttonStyle('ghost')} onClick={onBack} type="button">
          ← Back
        </button>
        <button style={buttonStyle('primary')} onClick={onNext} type="button" disabled={!selectedPort}>
          Continue →
        </button>
      </div>
    </div>
  )
}

// ─── Step 4: flash ────────────────────────────────────────────────────────────

function FlashStep({
  module,
  board,
  port,
  baudLabel,
  command,
  showCommand,
  onToggleCommand,
  flashing,
  dumping,
  log,
  percent,
  result,
  canFlash,
  replaceSerialIdentity,
  replacementReason,
  onReplaceSerialIdentity,
  onReplacementReason,
  logEndRef,
  onFlash,
  onDumpHex,
  onCancel,
  onBack,
  onComplete,
  onClose
}: {
  module: SetupModule
  board: FlashBoardSpec
  port: string | null
  baudLabel: string
  command: string[]
  showCommand: boolean
  onToggleCommand: () => void
  flashing: boolean
  dumping: boolean
  log: LogLine[]
  percent: number
  result: FlashResult | null
  canFlash: boolean
  replaceSerialIdentity: boolean
  replacementReason: string
  onReplaceSerialIdentity: (value: boolean) => void
  onReplacementReason: (value: string) => void
  logEndRef: RefObject<HTMLDivElement | null>
  onFlash: () => void
  onDumpHex: () => void
  onCancel: () => void
  onBack: () => void
  onComplete: () => void | Promise<void>
  onClose: () => void
}): ReactElement {
  const done = result?.ok && result.verified
  const failed = result !== null && !done
  const busy = flashing || dumping

  return (
    <div>
      <div style={{ ...card, background: ACCENT_SOFT, borderColor: ACCENT_BORDER }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span>
            <strong>{module.name}</strong> · {board.name}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.7)' }}>
            {port ?? '—'} · {baudLabel}
          </span>
        </div>
      </div>

      <WiringPanel module={module} board={board} compact />

      <div style={{ ...card, marginTop: 12, borderColor: replaceSerialIdentity ? 'rgba(209,52,56,0.65)' : 'rgba(255,255,255,0.14)' }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <input
            type="checkbox"
            checked={replaceSerialIdentity}
            disabled={busy}
            onChange={(event) => onReplaceSerialIdentity(event.target.checked)}
          />
          <span>
            <strong>Explicitly replace an existing saved hardware identity</strong>
            <small style={{ ...helper, display: 'block', marginTop: 4 }}>
              Normal Setup never overwrites known VID/PID/serial descriptors. Enable this only for an intentional board replacement; Rig Preflight certification will be invalidated and the reason audited.
            </small>
          </span>
        </label>
        {replaceSerialIdentity && (
          <input
            type="text"
            value={replacementReason}
            disabled={busy}
            onChange={(event) => onReplacementReason(event.target.value)}
            placeholder="Required audit reason (minimum 10 characters)"
            style={{
              width: '100%',
              marginTop: 10,
              boxSizing: 'border-box',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.16)',
              background: 'rgba(0,0,0,0.24)',
              color: 'inherit',
              padding: '9px 10px'
            }}
          />
        )}
      </div>

      <div style={{ ...card, marginTop: 12, background: 'rgba(255,255,255,0.04)' }}>
        <strong>Current firmware backup</strong>
        <p style={{ ...helper, marginTop: 6 }}>
          ?Dump hex firmware from Arduino? saves a .hex copy of the current flash. It does not reverse-engineer the binary
          nem descobre automaticamente quais funcoes o firmware implementa.
        </p>
        <button style={{ ...buttonStyle('soft'), marginTop: 8 }} onClick={onDumpHex} type="button" disabled={!port || busy}>
          {dumping ? 'Lendo .hex…' : 'Dump hex firmware from Arduino'}
        </button>
      </div>

      <button style={{ ...buttonStyle('ghost'), marginTop: 12 }} onClick={onToggleCommand} type="button">
        {showCommand ? 'Hide avrdude command' : 'Show avrdude command (advanced)'}
      </button>
      {showCommand && (
        <pre style={commandBox}>
          {command.join('\n')}
        </pre>
      )}

      {(busy || log.length > 0) && (
        <div style={{ marginTop: 14 }}>
          <div style={progressTrack}>
            <div
              style={{
                ...progressFill,
                width: `${Math.max(0, Math.min(100, percent))}%`,
                background: failed ? 'var(--accent-danger)' : ACCENT
              }}
            />
          </div>
          <div style={logBox}>
            {log.map((line, index) => (
              <div
                key={index}
                style={{
                  color: line.tone === 'error' ? '#ff9a9c' : line.tone === 'success' ? '#7ee2b8' : 'rgba(255,255,255,0.78)'
                }}
              >
                {line.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {done && result && (
        <div style={{ ...card, marginTop: 14, borderColor: 'rgba(var(--accent-rgb),0.5)', background: 'rgba(var(--accent-rgb),0.12)' }}>
          <strong style={{ color: '#7ee2b8' }}>✓ Ready! Componente criado.</strong>
          <p style={{ ...helper, marginTop: 6 }}>
            Capabilities confirmed: {result.capabilities.map((c) => `K:${c.key}=${c.detail}`).join(', ') || '—'}.
            The device has been created in Hardware Hub and linked to port {result.port}.
          </p>
        </div>
      )}

      {failed && result && (
        <div style={{ ...card, marginTop: 14, borderColor: 'rgba(209,52,56,0.5)', background: 'rgba(209,52,56,0.12)' }}>
          <strong style={{ color: '#ff9a9c' }}>It did not work</strong>
          <p style={{ ...helper, marginTop: 6 }}>{result.message}</p>
          <ul style={{ ...helper, marginTop: 8, paddingLeft: 18 }}>
            <li>Confirme a fiacao: DIN no pino certo, 5L e GND comuns.</li>
            <li>Use a USB <strong>data</strong> cable (some cables only charge).</li>
            <li>Close SimHub/Arduino IDE (they may be holding the port).</li>
            <li>Nano clone? Go back and switch to the old bootloader (57600).</li>
          </ul>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, gap: 8 }}>
        <button style={buttonStyle('ghost')} onClick={busy ? onCancel : onBack} type="button">
          {busy ? 'Cancel operation' : '← Back'}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {busy && (
            <button style={buttonStyle('ghost')} onClick={onClose} type="button">
              Close agora
            </button>
          )}
          {!busy && !done && (
            <button style={buttonStyle('primary')} onClick={onFlash} type="button" disabled={!canFlash}>
              {failed ? 'Try again' : '⚡ Gravar firmware'}
            </button>
          )}
          {done ? (
            <button style={buttonStyle('primary')} onClick={() => void onComplete()} type="button">
              Go to device ?
            </button>
          ) : (
            !busy && (
              <button style={buttonStyle('ghost')} onClick={onClose} type="button">
                Close
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Shared: wiring panel ─────────────────────────────────────────────────────

function WiringPanel({
  module,
  board,
  compact
}: {
  module: SetupModule
  board: FlashBoardSpec
  compact?: boolean
}): ReactElement {
  return (
    <div style={{ ...card, marginTop: compact ? 12 : 0 }}>
      <span style={label}>How to wire ({board.name})</span>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {module.wiring.map((step) => (
          <div key={step.signal} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <code style={pinChip}>{step.signal}</code>
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>→</span>
            <code style={{ ...pinChip, background: ACCENT_SOFT, borderColor: ACCENT_BORDER, color: 'var(--accent-primary)' }}>
              {step.pin}
            </code>
            {step.detail && <span style={{ ...helper, margin: 0 }}>{step.detail}</span>}
          </div>
        ))}
      </div>
      {!compact && module.powerNote && (
        <p style={{ ...helper, marginTop: 10 }}>💡 {module.powerNote}</p>
      )}
      {!compact && module.parts.length > 0 && (
        <p style={{ ...helper, marginTop: 8 }}>
          <strong>Pecas:</strong> {module.parts.join(' · ')}
        </p>
      )}
    </div>
  )
}

// ─── Inline style tokens local to the wizard ──────────────────────────────────

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 40,
  background: 'rgba(2,5,9,0.72)',
  backdropFilter: 'blur(4px)',
  display: 'grid',
  placeItems: 'center',
  padding: 20
}

const modal: CSSProperties = {
  ...panel,
  width: 'min(720px, 96vw)',
  maxHeight: '92vh',
  overflowY: 'auto'
}

const difficultyBadge: CSSProperties = {
  alignItems: 'center',
  background: ACCENT_SOFT,
  border: `1px solid ${ACCENT_BORDER}`,
  borderRadius: 'var(--radius-sm)',
  color: 'var(--accent-primary)',
  display: 'inline-flex',
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 0.4,
  padding: '2px 9px',
  textTransform: 'uppercase'
}

const matrixBadge: CSSProperties = {
  ...difficultyBadge,
  background: 'rgba(0,180,120,0.16)',
  color: '#7ee2b8',
  borderColor: 'rgba(0,180,120,0.5)'
}

const detectedBadge: CSSProperties = {
  ...difficultyBadge,
  background: 'rgba(232,105,32,0.18)',
  color: 'var(--accent-primary)',
  borderColor: ACCENT_BORDER
}

const companionPrompt: CSSProperties = {
  ...helper,
  marginTop: 6,
  color: '#ffd37a'
}

const guessBanner: CSSProperties = {
  marginTop: 12,
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  background: ACCENT_SOFT,
  border: `1px solid ${ACCENT_BORDER}`
}

const pinChip: CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 12,
  fontWeight: 700,
  padding: '2px 8px'
}

const commandBox: CSSProperties = {
  background: 'rgba(0,0,0,0.42)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 'var(--radius-sm)',
  color: 'rgba(255,255,255,0.78)',
  fontSize: 11.5,
  lineHeight: 1.5,
  margin: '8px 0 0',
  padding: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all'
}

const progressTrack: CSSProperties = {
  height: 8,
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(255,255,255,0.1)',
  overflow: 'hidden'
}

const progressFill: CSSProperties = {
  height: '100%',
  borderRadius: 'var(--radius-sm)',
  transition: 'width 200ms ease'
}

const logBox: CSSProperties = {
  marginTop: 10,
  maxHeight: 200,
  overflowY: 'auto',
  background: 'rgba(0,0,0,0.42)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 'var(--radius-sm)',
  padding: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11.5,
  lineHeight: 1.55
}
