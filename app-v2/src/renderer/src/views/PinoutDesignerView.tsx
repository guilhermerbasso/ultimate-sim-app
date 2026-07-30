import { type CSSProperties, type ChangeEvent, type ReactElement, useEffect, useMemo, useState } from 'react'
import { BOARD_CATALOG, PINOUT_COMPONENT_LIBRARY, emptyCustomCatalog, getCompatiblePinsForRole, getComponentBoardCompatibility, mergeCatalog, type BoardArchitecturePlan, type BoardCatalogEntry, type BoardPinCapability, type CustomCatalog, type MergedCatalog, type PinoutBoardId, type PinoutComponentCategory, type PinoutComponentDefinition, type PinoutComponentRole, type PinoutComponentCompatibility, type RecommendSelection } from '../../../shared/board-catalog'
import {
  PINOUT_CHANNELS,
  PINOUT_CUSTOM_CHANNELS,
  buildPinoutAssignmentUsage,
  buildPinoutConfigPayload,
  createEmptyPinoutDesign,
  getConnectionKey,
  normalizePinoutDesign,
  validatePinout,
  type Connection,
  type ConnectionTarget,
  type PinoutCompileResult,
  type PinoutDesign,
  type PinoutFlashResult,
  type PinoutValidationIssue,
  type PinoutValidationResult,
  type PlacedComponent,
  type PlacedMux
} from '../../../shared/pinout'
import { FLASH_BOARDS, SETUP_CHANNELS, findFlashBaud, type FlashBoardSpec, type FlashProgress } from '../../../shared/setup'
import type { PortInfo } from '../../../shared/ipc'
import type { AppViewProps } from '../App'
import { SectionExportImport } from '../components/SectionExportImport'
import { WiringDiagram } from './pinout/WiringDiagram'
import { RecommendPanel } from './pinout/RecommendPanel'
import { MuxConnectionTree, type MuxCandidate } from './pinout/MuxConnectionTree'
import CustomCatalogModal, { type CustomCatalogEditTarget } from './arduinos/CustomCatalogModal'

type WizardStep = 'recommend' | 'board' | 'components' | 'assign' | 'generate'
type Assignable = PlacedComponent | PlacedMux
type ComponentCategoryFilter = PinoutComponentCategory | 'All'

const categories: PinoutComponentCategory[] = ['Lights', 'Screens', 'Sound', 'Haptics', 'Inputs', 'Sensors', 'Motors', 'Power', 'Comms', 'Expanders / Mux', 'Custom']
const categoryFilters: ComponentCategoryFilter[] = ['All', ...categories]
const diagramElementId = 'pinout-wiring-diagram'
const generatedSketchSafetyNote = 'This generated sketch is a serial diagnostic/bench reporter — for a working HID button box use the companion-controls firmware.'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function downloadText(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function downloadJson(name: string, payload: unknown): void {
  downloadText(name, JSON.stringify(payload, null, 2), 'application/json')
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'))
    reader.readAsText(file)
  })
}

function safeFileName(value: string, fallback = 'pinout'): string {
  return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || fallback
}

// Active merged catalog (built-in + user-defined). The designer is a singleton
// view; the parent refreshes this synchronously during render so the module-level
// helpers and step components below resolve custom boards/components transparently.
let activeBoards: BoardCatalogEntry[] = Object.values(BOARD_CATALOG)
let activeBoardsById: Record<string, BoardCatalogEntry> = Object.fromEntries(activeBoards.map((board) => [board.id, board]))
let activeComponentLibrary: PinoutComponentDefinition[] = PINOUT_COMPONENT_LIBRARY
let activeComponentsById: Record<string, PinoutComponentDefinition> = Object.fromEntries(PINOUT_COMPONENT_LIBRARY.map((definition) => [definition.id, definition]))

function setActiveCatalog(merged: MergedCatalog): void {
  activeBoards = merged.boards
  activeBoardsById = merged.boardsById
  activeComponentLibrary = merged.components
  activeComponentsById = merged.componentsById
}

function resolveBoardEntry(boardId: PinoutBoardId): BoardCatalogEntry {
  return activeBoardsById[boardId] ?? BOARD_CATALOG.nano
}

export default function PinoutDesignerView({ showToast }: AppViewProps): ReactElement {
  const [step, setStep] = useState<WizardStep>('board')
  const [designs, setDesigns] = useState<PinoutDesign[]>([])
  const [design, setDesign] = useState<PinoutDesign>(() => createEmptyPinoutDesign('Guided ButtonBox', 'nano'))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [selectedPort, setSelectedPort] = useState('')
  const [baudId, setBaudId] = useState<string | undefined>()
  const [flashLog, setFlashLog] = useState<Array<{ message: string; tone: 'info' | 'success' | 'error' }>>([])
  const [flashPercent, setFlashPercent] = useState(0)
  const [generatedConfig, setGeneratedConfig] = useState<unknown | null>(null)
  const [generatedConfigUpdatedAt, setGeneratedConfigUpdatedAt] = useState<string | null>(null)
  const [customCatalog, setCustomCatalog] = useState<CustomCatalog>(emptyCustomCatalog)
  // Custom component/board creator modal, now hosted inside the Pinout Designer.
  const [catalogModal, setCatalogModal] = useState<{ defaultTab: 'component' | 'board'; editing: CustomCatalogEditTarget | null } | null>(null)

  // Merge built-in + user-defined entries and publish them to the module-level
  // registry so step components and helpers resolve custom parts transparently.
  const merged = useMemo(() => mergeCatalog(customCatalog), [customCatalog])
  setActiveCatalog(merged)

  const board = merged.boardsById[design.boardId] ?? BOARD_CATALOG.nano
  const validation = useMemo(() => validatePinout(design, board, merged.components), [design, board, merged])
  const connectionMap = useMemo(() => new Map(design.connections.map((connection) => [getConnectionKey(connection.componentId, connection.role), connection])), [design.connections])
  const assignables = useMemo<Assignable[]>(() => [...design.muxes, ...design.components], [design.muxes, design.components])
  const selectedComponents = design.components.length + design.muxes.length
  const assignedRoles = design.connections.length
  const requiredRoles = assignables.reduce((sum, item) => sum + (getDefinition(item.definitionId)?.roles.filter((role) => !role.optional).length ?? 0), 0)

  useEffect(() => {
    void window.ipc
      .invoke<CustomCatalog>(PINOUT_CUSTOM_CHANNELS.list)
      .then((catalog) => setCustomCatalog(catalog))
      .catch(() => undefined)
    const off = window.ipc.subscribe<CustomCatalog>(PINOUT_CUSTOM_CHANNELS.changed, (next) => setCustomCatalog(next))
    return off
  }, [])

  useEffect(() => {
    let active = true
    window.ipc.invoke<PinoutDesign[]>(PINOUT_CHANNELS.list)
      .then((list) => {
        if (!active) return
        setDesigns(list)
        if (list[0]) setDesign(list[0])
      })
      .catch((error) => setMessage(`Pinout storage is not connected yet: ${getErrorMessage(error)}`))
    return () => { active = false }
  }, [])

  useEffect(() => {
    const unsubscribe = window.ipc.subscribe<FlashProgress>(PINOUT_CHANNELS.flashProgress, (progress) => {
      setFlashLog((current) => [...current, { message: progress.line ?? progress.message, tone: progress.tone ?? 'info' }])
      if (typeof progress.percent === 'number') setFlashPercent(progress.percent)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (step === 'generate') void loadPorts()
  }, [step])

  useEffect(() => {
    const spec = flashSpecForBoard(board)
    setBaudId(spec?.defaultBaudId)
  }, [board])

  function updateDesign(patch: Partial<PinoutDesign>): void {
    setDesign((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))
  }

  function pickBoard(boardId: PinoutBoardId): void {
    updateDesign({ boardId, connections: [] })
    setStep('components')
  }

  function addComponent(definition: PinoutComponentDefinition): void {
    if (definition.type === 'multiplexer') {
      const mux: PlacedMux = { id: newId('mux'), definitionId: 'cd74hc4067', label: nextLabel(definition.defaultLabel, design.muxes.length), x: 70, y: 160 + design.muxes.length * 150, sigMode: 'digital' }
      updateDesign({ muxes: [...design.muxes, mux] })
      setStep('assign')
      showToast(`${definition.shortName} added. Assign board pins and channels.`, 'success')
      return
    }
    const component: PlacedComponent = { id: newId('cmp'), definitionId: definition.id, label: nextLabel(definition.defaultLabel, design.components.length), x: 680, y: 160 + design.components.length * 122, settings: definition.defaults }
    updateDesign({ components: [...design.components, component] })
    showToast(`${definition.shortName} added.`, 'success')
  }

  function applyRecommendation(plan: BoardArchitecturePlan, selections: RecommendSelection[]): void {
    const newComponents: PlacedComponent[] = []
    const newMuxes: PlacedMux[] = []
    let cmpIndex = design.components.length
    let muxIndex = design.muxes.length
    const place = (definitionId: string, qty: number, sigMode?: PlacedMux['sigMode']): void => {
      const definition = getDefinition(definitionId)
      if (!definition || qty <= 0) return
      for (let created = 0; created < qty; created += 1) {
        if (definition.type === 'multiplexer') {
          newMuxes.push({ id: newId('mux'), definitionId: 'cd74hc4067', label: nextLabel(definition.defaultLabel, muxIndex), x: 70, y: 160 + muxIndex * 150, sigMode: sigMode ?? 'digital' })
          muxIndex += 1
        } else {
          newComponents.push({ id: newId('cmp'), definitionId: definition.id, label: nextLabel(definition.defaultLabel, cmpIndex), x: 680, y: 160 + cmpIndex * 122, settings: definition.defaults })
          cmpIndex += 1
        }
      }
    }
    // The desired end-parts first, then the expander chips the planner added for them.
    selections.forEach((selection) => place(selection.componentId, selection.qty))
    plan.expanders.forEach((expander) => place(expander.definitionId, expander.count, expander.sigMode))
    const boardChanged = design.boardId !== plan.boardId
    updateDesign({
      boardId: plan.boardId,
      components: [...design.components, ...newComponents],
      muxes: [...design.muxes, ...newMuxes],
      connections: boardChanged ? [] : design.connections
    })
    setStep('assign')
    const added = newComponents.length + newMuxes.length
    showToast(`Applied ${plan.boardName} · ${added} part(s) added${plan.extraChips > 0 ? ` incl. ${plan.extraChips} expander chip(s)` : ''}.`, 'success')
  }

  function removeItem(id: string): void {
    updateDesign({
      components: design.components.filter((component) => component.id !== id),
      muxes: design.muxes.filter((mux) => mux.id !== id),
      connections: design.connections.filter((connection) => connection.componentId !== id && !(connection.target.kind === 'mux-channel' && connection.target.muxId === id))
    })
  }

  function renameItem(id: string, label: string): void {
    updateDesign({
      components: design.components.map((component) => component.id === id ? { ...component, label } : component),
      muxes: design.muxes.map((mux) => mux.id === id ? { ...mux, label } : mux)
    })
  }

  function setMuxMode(id: string, sigMode: PlacedMux['sigMode']): void {
    updateDesign({ muxes: design.muxes.map((mux) => mux.id === id ? { ...mux, sigMode } : mux) })
  }

  function setConnection(componentId: string, role: string, target: ConnectionTarget | null): void {
    const key = getConnectionKey(componentId, role)
    const rest = design.connections.filter((connection) => getConnectionKey(connection.componentId, connection.role) !== key)
    if (!target) {
      updateDesign({ connections: rest })
      return
    }
    const next: Connection = { id: newId('conn'), componentId, role, target }
    updateDesign({ connections: [...rest, next] })
  }

  async function saveDesign(source: PinoutDesign = design): Promise<PinoutDesign | null> {
    setBusy(true)
    try {
      const saved = await window.ipc.invoke<PinoutDesign>(PINOUT_CHANNELS.save, source)
      setDesign(saved)
      setDesigns((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current])
      showToast('Pinout saved.', 'success')
      return saved
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function refreshGeneratedConfig(source: PinoutDesign): Promise<unknown> {
    const payload = await window.ipc.invoke(PINOUT_CHANNELS.generateConfig, source).catch(() => ({ payload: buildPinoutConfigPayload(source, activeComponentLibrary) }))
    setGeneratedConfig(payload)
    setGeneratedConfigUpdatedAt(new Date().toISOString())
    return payload
  }

  async function reloadDesigns(): Promise<void> {
    try {
      const list = await window.ipc.invoke<PinoutDesign[]>(PINOUT_CHANNELS.list)
      setDesigns(list)
      if (list[0]) setDesign(list[0])
    } catch (error) {
      setMessage(`Pinout storage is not connected yet: ${getErrorMessage(error)}`)
    }
  }

  async function reloadCatalog(): Promise<void> {
    try {
      const catalog = await window.ipc.invoke<CustomCatalog>(PINOUT_CUSTOM_CHANNELS.list)
      setCustomCatalog(catalog)
    } catch {
      // The custom catalog falls back to built-ins; a reload failure is non-fatal.
    }
  }

  async function generateConfig(source: PinoutDesign = design): Promise<void> {
    setBusy(true)
    try {
      const payload = await refreshGeneratedConfig(source)
      downloadJson(`${safeFileName(source.name)}-firmware-config.json`, payload)
      showToast('Firmware config exported.', 'success')
    } finally {
      setBusy(false)
    }
  }

  async function saveDiagramDesign(source: PinoutDesign): Promise<void> {
    const nextValidation = validatePinout(source, resolveBoardEntry(source.boardId), activeComponentLibrary)
    if (nextValidation.issues.some((issue) => issue.severity === 'error')) {
      showToast('Fix wiring conflicts before saving the diagram.', 'error')
      return
    }
    const saved = await saveDesign(source)
    if (saved) {
      await refreshGeneratedConfig(saved)
      showToast('Diagram saved and firmware config refreshed.', 'success')
    }
  }

  async function exportIno(source: PinoutDesign = design): Promise<void> {
    setBusy(true)
    try {
      const ino = await window.ipc.invoke<string>(PINOUT_CHANNELS.exportIno, { design: source })
      downloadText(`${safeFileName(source.name, 'PinoutFirmware')}.ino`, ino, 'text/x-arduino')
      showToast('Arduino sketch .ino exported.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function compileFirmware(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.ipc.invoke<PinoutCompileResult>(PINOUT_CHANNELS.compile, { design, sketchName: safeFileName(design.name, 'PinoutFirmware') })
      setMessage(`${result.message}${result.sketchPath ? ` Sketch: ${result.sketchPath}` : ''}${result.hexPath ? ` HEX: ${result.hexPath}` : ''}`)
      showToast(result.ok ? 'Firmware generated and compiled.' : result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function loadPorts(): Promise<void> {
    try {
      const list = await window.ipc.invoke<PortInfo[]>(SETUP_CHANNELS.listPorts)
      const selectablePorts = list.filter((port) => !port.isSimX)
      setPorts(list)
      setSelectedPort((current) => current && selectablePorts.some((port) => port.path === current) ? current : selectablePorts[0]?.path ?? '')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  async function flashFirmware(): Promise<void> {
    if (!selectedPort) {
      showToast('Select a serial port before flashing.', 'error')
      return
    }
    setBusy(true)
    setFlashLog([{ message: `Starting generated firmware flash on ${selectedPort}…`, tone: 'info' }])
    setFlashPercent(2)
    try {
      const result = await window.ipc.invoke<PinoutFlashResult>(PINOUT_CHANNELS.flash, { design, port: selectedPort, baudId })
      setMessage(result.message)
      showToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      const text = getErrorMessage(error)
      setMessage(text)
      showToast(text, 'error')
    } finally {
      setBusy(false)
      setFlashPercent((current) => current < 100 ? 100 : current)
    }
  }

  async function importDesign(file: File): Promise<void> {
    try {
      const parsed = JSON.parse(await readFileAsText(file)) as Partial<PinoutDesign>
      const next = normalizePinoutDesign({ ...parsed, id: parsed.id ?? newId('pinout') })
      setDesign(next)
      setStep('assign')
      showToast('Design imported.', 'success')
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    }
  }

  function exportDiagram(): void {
    const svg = document.getElementById(diagramElementId)
    if (!svg) {
      showToast('Diagram is not rendered yet.', 'error')
      return
    }
    downloadText(`${safeFileName(design.name)}-wiring-diagram.svg`, svg.outerHTML, 'image/svg+xml')
    showToast('Wiring diagram SVG exported.', 'success')
  }

  return (
    <div style={{ display: 'grid', gap: 16, color: '#e5eefc' }}>
      <header style={heroStyle}>
        <div>
          <div style={{ fontSize: 12, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 1 }}>Pinout Designer</div>
          <h2 style={{ margin: '6px 0 4px' }}>Guided hardware flow: board → components → ports → diagram + firmware</h2>
          <p style={hintStyle}>Pick a board, add beginner-friendly components, assign every required role to a real pin or MUX channel, then export a ready SVG wiring diagram and firmware config/sketch.</p>
        </div>
        <div style={{ display: 'grid', gap: 8, minWidth: 260 }}>
          <input value={design.name} onChange={(event) => updateDesign({ name: event.target.value })} style={inputStyle} aria-label="Design name" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><button type="button" style={secondaryButton} onClick={() => { setDesign(createEmptyPinoutDesign('Guided ButtonBox', design.boardId)); setStep('board') }}>New</button><button type="button" style={primaryButton} disabled={busy} onClick={() => void saveDesign()}>Save</button></div>
        </div>
      </header>

      {/* P0-08/§24-14: generated wiring is a starting point, never a certified
          netlist. The repository's own WIRING.csv/BOM.csv are quarantined for
          conflicting with the reference firmware and duplicating physical mux
          pins, so the UI must say plainly that nothing here has been reviewed. */}
      <section style={{ ...panelStyle, borderColor: '#f59e0b', background: 'rgba(245, 158, 11, 0.08)' }} role="note">
        <strong style={{ color: '#fbbf24' }}>⚠ Not a certified wiring source — electrical review required</strong>
        <p style={{ ...hintStyle, marginBottom: 0 }}>
          Diagrams, BOMs and firmware generated here are unreviewed drafts. Before you wire, power or flash anything,
          check every pin against the manufacturer datasheet with someone qualified. The repository&apos;s
          <code> WIRING.csv</code>, <code>BOM.csv</code> and the legacy protocol docs are currently quarantined —
          they conflict with the reference firmware pinout and assign CD74HC4067 physical pins 6, 7, 8 and 16 twice.
          See <code>docs/HARDWARE-QUARANTINE.md</code>.
        </p>
      </section>

      <Stepper step={step} setStep={setStep} canAssign={selectedComponents > 0} canGenerate={requiredRoles > 0 && assignedRoles > 0} />

      {step === 'recommend' && <RecommendPanel catalog={merged} onApply={applyRecommendation} showToast={showToast} />}
      {step === 'board' && <BoardStep current={design.boardId} onPick={pickBoard} onAddCustom={(tab) => setCatalogModal({ defaultTab: tab, editing: null })} />}
      {step === 'components' && <ComponentStep design={design} onAdd={addComponent} onRemove={removeItem} onRename={renameItem} onNext={() => setStep('assign')} onAddCustom={(tab) => setCatalogModal({ defaultTab: tab, editing: null })} />}
      {step === 'assign' && <AssignStep design={design} board={board} connectionMap={connectionMap} validation={validation} onConnect={setConnection} onRename={renameItem} onRemove={removeItem} onMuxMode={setMuxMode} />}
      {step === 'generate' && <GenerateStep design={design} board={board} validation={validation} busy={busy} message={message} ports={ports} selectedPort={selectedPort} baudId={baudId} flashLog={flashLog} flashPercent={flashPercent} generatedConfigReady={Boolean(generatedConfig)} generatedConfigUpdatedAt={generatedConfigUpdatedAt} onDesignChange={setDesign} onDiagramSave={(next) => void saveDiagramDesign(next)} onPortChange={setSelectedPort} onBaudChange={setBaudId} onRefreshPorts={() => void loadPorts()} onSave={() => void saveDesign()} onExportDesign={() => downloadJson(`${safeFileName(design.name)}-design.json`, design)} onImport={importDesign} onExportConfig={() => void generateConfig()} onExportIno={() => void exportIno()} onCompile={() => void compileFirmware()} onFlash={() => void flashFirmware()} onExportDiagram={exportDiagram} />}

      <section style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <strong>Saved designs</strong>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <SectionExportImport sectionId="pinout-designs" label="Firmware pinouts" onImported={() => void reloadDesigns()} />
            <SectionExportImport sectionId="custom-catalog" label="Custom board catalog" onImported={() => void reloadCatalog()} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {designs.length === 0 ? <span style={hintStyle}>No saved pinouts yet.</span> : designs.map((item) => <button key={item.id} type="button" style={miniButton} onClick={() => { setDesign(item); setStep('assign') }}>{item.name}</button>)}
        </div>
      </section>

      {catalogModal && (
        <CustomCatalogModal
          defaultTab={catalogModal.defaultTab}
          editing={catalogModal.editing}
          onClose={() => setCatalogModal(null)}
          onSaved={(catalog) => setCustomCatalog(catalog)}
          showToast={showToast}
        />
      )}
    </div>
  )
}

function Stepper({ step, setStep, canAssign, canGenerate }: { step: WizardStep; setStep(step: WizardStep): void; canAssign: boolean; canGenerate: boolean }): ReactElement {
  const steps: Array<{ id: WizardStep; label: string; enabled: boolean }> = [
    { id: 'recommend', label: '★ Recommend', enabled: true },
    { id: 'board', label: '1. Board', enabled: true },
    { id: 'components', label: '2. Components', enabled: true },
    { id: 'assign', label: '3. Assign ports', enabled: canAssign },
    { id: 'generate', label: '4. Generate', enabled: canGenerate }
  ]
  return <nav style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>{steps.map((item) => <button key={item.id} type="button" disabled={!item.enabled} onClick={() => setStep(item.id)} style={{ ...stepButton, borderColor: item.id === step ? 'var(--accent-primary)' : 'rgba(148,163,184,.24)', opacity: item.enabled ? 1 : 0.45 }}>{item.label}</button>)}</nav>
}

function BoardStep({ current, onPick, onAddCustom }: { current: PinoutBoardId; onPick(boardId: PinoutBoardId): void; onAddCustom(tab: 'component' | 'board'): void }): ReactElement {
  return <section style={gridPanelStyle}>
    {activeBoards.map((board) => {
      const digital = board.pins.filter((pin) => pin.digital).length
      const analog = board.pins.filter((pin) => pin.analogIn).length
      const pwm = board.pins.filter((pin) => pin.pwm).length
      const i2c = board.pins.filter((pin) => pin.i2c).map((pin) => `${pin.pin} ${pin.i2c?.toUpperCase()}`).join(' · ')
      return <button key={board.id} type="button" onClick={() => onPick(board.id)} style={{ ...cardButton, borderColor: current === board.id ? 'var(--accent-primary)' : 'rgba(148,163,184,.24)' }}>
        <b>{board.name}</b><small>{board.mcu} · {board.lapge} logic · {board.usbHid ? 'USB HID capable' : 'serial/USB companion'}</small>
        <div style={badgeRow}><Badge color="#60a5fa" label={`${digital} digital`} /><Badge color="#34d399" label={`${analog} analog`} /><Badge color="#f59e0b" label={`${pwm} PWM`} /><Badge color="#a78bfa" label={i2c || 'no fixed I2C'} /></div>
        <p style={hintStyle}>{board.notes}</p>
      </button>
    })}
    <button type="button" onClick={() => onAddCustom('board')} style={{ ...cardButton, borderStyle: 'dashed', borderColor: 'rgba(56,189,248,.5)', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <b>＋ Add custom board / Arduino</b>
      <small style={hintStyle}>Define your own board (pins + voltage) so it appears here and in the compatibility checks.</small>
    </button>
  </section>
}

function ComponentStep(props: { design: PinoutDesign; onAdd(definition: PinoutComponentDefinition): void; onRemove(id: string): void; onRename(id: string, label: string): void; onNext(): void; onAddCustom(tab: 'component' | 'board'): void }): ReactElement {
  const [categoryFilter, setCategoryFilter] = useState<ComponentCategoryFilter>('All')
  const [searchText, setSearchText] = useState('')
  const board = activeBoardsById[props.design.boardId] ?? BOARD_CATALOG.nano
  const normalizedSearch = searchText.trim().toLowerCase()
  const filteredComponents = activeComponentLibrary.filter((definition) => {
    const categoryMatches = categoryFilter === 'All' || definition.category === categoryFilter
    const textMatches = !normalizedSearch || [
      definition.name,
      definition.shortName,
      definition.description,
      definition.plainLanguageDescription,
      definition.category,
      definition.type,
      definition.protocolKey,
      ...definition.roles.map((role) => `${role.label} ${role.kind}`)
    ].join(' ').toLowerCase().includes(normalizedSearch)
    return categoryMatches && textMatches
  })
  const filteredRows = filteredComponents.map((definition) => ({ definition, compatibility: getComponentBoardCompatibility(definition, board) }))
  const usableCount = filteredRows.filter((row) => row.compatibility.compatible).length
  const warningCount = filteredRows.filter((row) => row.compatibility.status === 'warning').length
  const visibleCategories = categories.filter((category) => filteredRows.some((row) => row.definition.category === category))

  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(580px, 1fr) 360px', gap: 16 }}>
    <section style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={sectionTitle}>Component catalog for non-technical builders</h3>
        <button type="button" style={{ ...secondaryButton, marginTop: 0, width: 'auto' }} onClick={() => props.onAddCustom('component')}>＋ Add custom component / board</button>
      </div>
      <p style={hintStyle}>Use categories like “Lights” and “Inputs” instead of chip names. Each card explains what the component does, its power needs and the pins it will ask for.</p>
      <div style={filterPanelStyle}>
        <label style={fieldLabel}>Search by component, function or role<input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Try “LED”, “analog”, “screen”, “mux”…" style={inputStyle} /></label>
        <div style={badgeRow} aria-label="Component category filters">{categoryFilters.map((category) => {
          const active = categoryFilter === category
          const count = category === 'All' ? activeComponentLibrary.length : activeComponentLibrary.filter((definition) => definition.category === category).length
          return <button key={category} type="button" onClick={() => setCategoryFilter(category)} style={{ ...filterChipButton, borderColor: active ? 'var(--accent-primary)' : 'rgba(148,163,184,.24)', color: active ? '#e0f2fe' : '#bfdbfe', background: active ? 'rgba(14,165,233,.22)' : 'rgba(15,23,42,.78)' }}>{category} <small>{count}</small></button>
        })}</div>
        <p style={hintStyle}>{filteredComponents.length} of {activeComponentLibrary.length} components shown · {usableCount} usable with {board.name}{warningCount > 0 ? ` (${warningCount} with wiring notes)` : ''}. Incompatible items are greyed with the reason.</p>
      </div>
      <div style={{ display: 'grid', gap: 16 }}>
        {visibleCategories.length === 0 ? <p style={hintStyle}>No components match this filter.</p> : visibleCategories.map((category) => {
          const items = filteredRows.filter((row) => row.definition.category === category)
          return <div key={category}><h4 style={{ margin: '10px 0' }}>{category}</h4><div style={catalogGrid}>{items.map(({ definition, compatibility }) => <ComponentCard key={definition.id} definition={definition} compatibility={compatibility} onAdd={() => props.onAdd(definition)} />)}</div></div>
        })}
      </div>
    </section>
    <SelectedList design={props.design} onRemove={props.onRemove} onRename={props.onRename} onNext={props.onNext} />
  </div>
}

function ComponentCard({ definition, compatibility, onAdd }: { definition: PinoutComponentDefinition; compatibility: PinoutComponentCompatibility; onAdd(): void }): ReactElement {
  const incompatibleReason = compatibility.reasons.join(' ')
  const warningReason = compatibility.warnings.join(' ')
  const cardStyle = !compatibility.compatible
    ? { ...componentCardButton, opacity: 0.48, cursor: 'not-allowed', borderColor: 'rgba(248,113,113,.42)' }
    : compatibility.status === 'warning'
      ? { ...componentCardButton, borderColor: 'rgba(251,191,36,.72)', background: 'var(--surface-base)' }
      : componentCardButton
  return <button type="button" style={cardStyle} disabled={!compatibility.compatible} onClick={onAdd} title={!compatibility.compatible ? incompatibleReason : warningReason || definition.description}>
    <span style={{ fontSize: 26 }}>{definition.icon}</span>
    <span><b>{definition.shortName}</b><small>{definition.plainLanguageDescription}</small><small>Power: {definition.power.join(' / ') || 'External / documented'}</small><small>Roles: {definition.roles.length === 0 ? 'Power/documentation only' : definition.roles.map((role) => `${role.label} (${role.kind})`).join(', ')}</small>{compatibility.status === 'warning' && <small style={{ color: '#fde68a' }}>⚠ {warningReason}</small>}{!compatibility.compatible && <small style={{ color: '#fca5a5' }}>Not compatible: {incompatibleReason}</small>}</span>
  </button>
}

function SelectedList({ design, onRemove, onRename, onNext }: { design: PinoutDesign; onRemove(id: string): void; onRename(id: string, label: string): void; onNext(): void }): ReactElement {
  const items: Assignable[] = [...design.muxes, ...design.components]
  return <aside style={panelStyle}>
    <h3 style={sectionTitle}>Selected components</h3>
    <p style={hintStyle}>Rename labels so the wiring diagram is clear: “Pit limiter”, “Left encoder”, “iFlag”.</p>
    <div style={{ display: 'grid', gap: 8 }}>{items.length === 0 ? <p style={hintStyle}>Add at least one component from the catalog.</p> : items.map((item) => <SelectedItem key={item.id} item={item} onRename={onRename} onRemove={onRemove} />)}</div>
    <button type="button" style={primaryButton} disabled={items.length === 0} onClick={onNext}>Assign ports</button>
  </aside>
}

function SelectedItem({ item, onRename, onRemove }: { item: Assignable; onRename(id: string, label: string): void; onRemove(id: string): void }): ReactElement {
  const definition = getDefinition(item.definitionId)
  return <div style={selectedItemStyle}><span style={{ fontSize: 22 }}>{definition?.icon ?? '□'}</span><input value={item.label} onChange={(event) => onRename(item.id, event.target.value)} style={inputStyle} /><button type="button" style={tinyButton} onClick={() => onRemove(item.id)}>Remove</button></div>
}

function AssignStep(props: { design: PinoutDesign; board: BoardCatalogEntry; connectionMap: Map<string, Connection>; validation: PinoutValidationResult; onConnect(componentId: string, role: string, target: ConnectionTarget | null): void; onRename(id: string, label: string): void; onRemove(id: string): void; onMuxMode(id: string, sigMode: PlacedMux['sigMode']): void }): ReactElement {
  const items: Assignable[] = [...props.design.muxes, ...props.design.components]
  const usage = useMemo(() => buildPinoutAssignmentUsage(props.design), [props.design])
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(680px, 1fr) 340px', gap: 16 }}>
    <section style={panelStyle}>
      <h3 style={sectionTitle}>Assign each role to a board pin or MUX channel</h3>
      <p style={hintStyle}>Digital = on/off signals, Analog = reads voltage, PWM = motor/LED dimming, I2C = shared SDA/SCL bus. The selector only offers compatible pins where possible.</p>
      <div style={{ display: 'grid', gap: 12 }}>{items.map((item) => <AssignmentCard key={item.id} item={item} design={props.design} board={props.board} connectionMap={props.connectionMap} validation={props.validation} usage={usage} onConnect={props.onConnect} onRename={props.onRename} onRemove={props.onRemove} onMuxMode={props.onMuxMode} />)}</div>
    </section>
    <aside style={panelStyle}>
      <h3 style={sectionTitle}>Live conflict check</h3>
      <div style={{ display: 'grid', gap: 6 }}>{props.validation.issues.length === 0 ? <p style={{ ...hintStyle, color: '#86efac' }}>No issues. You can generate the wiring diagram.</p> : props.validation.issues.map((issue, index) => <Issue key={`${issue.code}-${index}`} issue={issue} />)}</div>
      <PinCheatSheet board={props.board} />
      <button type="button" style={primaryButton} onClick={() => props.validation.issues.some((issue) => issue.severity === 'error') ? undefined : window.scrollTo({ top: 0, behavior: 'smooth' })}>Review warnings</button>
    </aside>
  </div>
}

function AssignmentCard(props: { item: Assignable; design: PinoutDesign; board: BoardCatalogEntry; connectionMap: Map<string, Connection>; validation: PinoutValidationResult; usage: ReturnType<typeof buildPinoutAssignmentUsage>; onConnect(componentId: string, role: string, target: ConnectionTarget | null): void; onRename(id: string, label: string): void; onRemove(id: string): void; onMuxMode(id: string, sigMode: PlacedMux['sigMode']): void }): ReactElement {
  const definition = getDefinition(props.item.definitionId)
  const isMux = definition?.type === 'multiplexer'
  return <div style={assignmentCardStyle}>
    <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 10, alignItems: 'center' }}>
      <span style={{ fontSize: 24 }}>{definition?.icon ?? '□'}</span><input value={props.item.label} onChange={(event) => props.onRename(props.item.id, event.target.value)} style={inputStyle} /><button type="button" style={tinyButton} onClick={() => props.onRemove(props.item.id)}>Remove</button>
    </div>
    {isMux && <label style={fieldLabel}>SIG mode<select value={(props.item as PlacedMux).sigMode} onChange={(event) => props.onMuxMode(props.item.id, event.target.value as PlacedMux['sigMode'])} style={inputStyle}><option value="digital">Digital buttons/switches</option><option value="analog">Analog potentiometers/sensors</option></select></label>}
    <p style={hintStyle}>{definition?.plainLanguageDescription}</p>
    <div style={{ display: 'grid', gap: 8 }}>{(definition?.roles ?? []).map((role) => <RoleAssignment key={role.role} role={role} item={props.item} design={props.design} board={props.board} validation={props.validation} connection={props.connectionMap.get(getConnectionKey(props.item.id, role.role))} onConnect={props.onConnect} />)}</div>
    {isMux && <MuxConnectionTree mux={props.item as PlacedMux} design={props.design} candidates={collectMuxCandidates(props.design)} validation={props.validation} connectionMap={props.connectionMap} onConnect={props.onConnect} />}
    <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', color: '#93c5fd' }}>Wiring notes</summary><ul style={hintStyle}>{definition?.defaultWiringNotes.map((note) => <li key={note}>{note}</li>)}</ul></details>
  </div>
}

function RoleAssignment({ role, item, design, board, validation, connection, onConnect }: { role: PinoutComponentRole; item: Assignable; design: PinoutDesign; board: BoardCatalogEntry; validation: PinoutValidationResult; connection?: Connection; onConnect(componentId: string, role: string, target: ConnectionTarget | null): void }): ReactElement {
  const value = connection ? targetToValue(connection.target) : ''
  function change(event: ChangeEvent<HTMLSelectElement>): void { onConnect(item.id, role.role, valueToTarget(event.target.value)) }
  const boardOptions = compatiblePins(board.pins, role)
  const muxValue = connection?.target.kind === 'mux-channel' ? value : ''
  return <label style={roleRowStyle}>
    <span><b>{role.label}</b><small>{role.kind.toUpperCase()}{role.optional ? ' · optional' : ''}</small></span>
    <select value={value} onChange={change} style={inputStyle}>
      <option value="">Not assigned</option>
      {muxValue && <option value={muxValue}>Assigned in MUX channel picker</option>}
      <optgroup label="Board pins">{boardOptions.map((pin) => {
        const optionValue = `board:${pin.pin}`
        const owners = validation.usedPins[pin.pin] ?? []
        const blockingOwners = boardPinBlockingOwners(design, item, role, pin)
        const unavailable = blockingOwners.length > 0 && value !== optionValue
        const sharedOwners = !unavailable && value !== optionValue ? owners : []
        const suffix = unavailable ? ` · unavailable: ${blockingOwners.join(', ')}` : sharedOwners.length > 0 ? ` · shared I2C bus: ${sharedOwners.join(', ')}` : ''
        return <option key={pin.pin} value={optionValue} disabled={unavailable}>{pin.pin} — {describePin(pin)}{suffix}</option>
      })}</optgroup>
    </select>
  </label>
}

function GenerateStep(props: {
  design: PinoutDesign
  board: BoardCatalogEntry
  validation: ReturnType<typeof validatePinout>
  busy: boolean
  message: string | null
  ports: PortInfo[]
  selectedPort: string
  baudId?: string
  flashLog: Array<{ message: string; tone: 'info' | 'success' | 'error' }>
  flashPercent: number
  generatedConfigReady: boolean
  generatedConfigUpdatedAt: string | null
  onDesignChange(design: PinoutDesign): void
  onDiagramSave(design: PinoutDesign): void
  onPortChange(port: string): void
  onBaudChange(baudId: string): void
  onRefreshPorts(): void
  onSave(): void
  onExportDesign(): void
  onImport(file: File): void
  onExportConfig(): void
  onExportIno(): void
  onCompile(): void
  onFlash(): void
  onExportDiagram(): void
}): ReactElement {
  const hasErrors = props.validation.issues.some((issue) => issue.severity === 'error')
  const flashSpec = flashSpecForBoard(props.board)
  const baud = flashSpec ? findFlashBaud(flashSpec, props.baudId) : null
  const selectedPortInfo = props.ports.find((port) => port.path === props.selectedPort)
  const selectedPortBlocked = selectedPortInfo?.isSimX === true
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(760px, 1fr) 340px', gap: 16 }}>
    <section style={panelStyle}><WiringDiagram id={diagramElementId} design={props.design} board={props.board} busy={props.busy} onChange={props.onDesignChange} onSave={props.onDiagramSave} /></section>
    <aside style={panelStyle}>
      <h3 style={sectionTitle}>Generated artifacts</h3>
      <p style={hintStyle}>The diagram is authoritative: rewiring updates the same design.connections used by firmware config. Compile remains on demand.</p>
      <p style={{ ...hintStyle, color: '#fde68a' }}>⚠ {generatedSketchSafetyNote}</p>
      {props.generatedConfigReady && <p style={{ ...hintStyle, color: '#86efac' }}>In-memory firmware config refreshed{props.generatedConfigUpdatedAt ? ` at ${new Date(props.generatedConfigUpdatedAt).toLocaleTimeString()}` : ''}. Export only when you want a file.</p>}
      <button type="button" style={primaryButton} disabled={hasErrors} onClick={props.onExportDiagram}>Export wiring diagram SVG</button>
      <button type="button" style={secondaryButton} onClick={props.onExportDesign}>Export editable design JSON</button>
      <button type="button" style={secondaryButton} disabled={hasErrors || props.busy} onClick={props.onExportConfig}>Export firmware config</button>
      <button type="button" style={secondaryButton} disabled={hasErrors || props.busy} onClick={props.onExportIno}>Export .ino</button>
      <button type="button" style={secondaryButton} disabled={hasErrors || props.busy} onClick={props.onCompile}>Generate .ino + compile</button>
      <div style={{ marginTop: 12, borderTop: '1px solid rgba(148,163,184,.18)', paddingTop: 12 }}>
        <h4 style={{ margin: '0 0 8px' }}>Flash generated firmware</h4>
        <p style={hintStyle}>Bench step: ALR flashing uses the bundled Windows avrdude; ESP32/ESP32-S3 uses arduino-cli plus the esp32 core. Validate wiring before powering external loads.</p>
        <p style={{ ...hintStyle, color: '#fde68a' }}>⚠ {generatedSketchSafetyNote}</p>
        <label style={fieldLabel}>Serial port<select value={props.selectedPort} onChange={(event) => props.onPortChange(event.target.value)} style={inputStyle}>
          <option value="">Select port…</option>
          {props.ports.map((port) => <option key={port.path} value={port.path} disabled={port.isSimX}>{port.path}{port.friendlyName ? ` — ${port.friendlyName}` : ''}{port.manufacturer ? ` (${port.manufacturer})` : ''}{port.isSimX ? ' — SIM-X protected (disabled)' : ''}</option>)}
        </select></label>
        {selectedPortBlocked && <p style={{ ...hintStyle, color: '#fca5a5' }}>SIM-X ports are protected. Select an Arduino secondary board before flashing.</p>}
        <button type="button" style={secondaryButton} onClick={props.onRefreshPorts}>Refresh ports</button>
        {flashSpec && <label style={fieldLabel}>Bootloader / baud<select value={props.baudId ?? flashSpec.defaultBaudId} onChange={(event) => props.onBaudChange(event.target.value)} style={inputStyle}>
          {flashSpec.baudOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select></label>}
        {!flashSpec && <p style={{ ...hintStyle, color: '#fde68a' }}>Automatic flashing is not supported for this board yet. Export the firmware and flash it with Arduino IDE.</p>}
        {baud && <p style={hintStyle}>Selected: {flashSpec?.name} · {baud.baud} baud.</p>}
        <button type="button" style={primaryButton} disabled={hasErrors || props.busy || !flashSpec || !props.selectedPort || selectedPortBlocked} onClick={props.onFlash}>Flash generated firmware</button>
        <div style={progressTrack}><div style={{ ...progressFill, width: `${Math.max(0, Math.min(100, props.flashPercent))}%` }} /></div>
        <div style={logBox}>{props.flashLog.length === 0 ? <span style={hintStyle}>Flash progress will appear here.</span> : props.flashLog.map((entry, index) => <div key={`${entry.message}-${index}`} style={{ color: entry.tone === 'error' ? '#fca5a5' : entry.tone === 'success' ? '#86efac' : '#bfdbfe' }}>{entry.message}</div>)}</div>
      </div>
      <input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void props.onImport(file) }} style={{ marginTop: 8 }} />
      <button type="button" style={secondaryButton} disabled={props.busy} onClick={props.onSave}>Save design</button>
      <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>{props.validation.issues.map((issue, index) => <Issue key={`${issue.code}-${index}`} issue={issue} />)}</div>
      {props.message && <p style={hintStyle}>{props.message}</p>}
    </aside>
  </div>
}

function PinCheatSheet({ board }: { board: BoardCatalogEntry }): ReactElement {
  return <div style={{ marginTop: 16 }}><h4>Pin cheat sheet</h4><div style={{ display: 'grid', gap: 6, maxHeight: 300, overflow: 'auto' }}>{board.pins.filter((pin) => pin.digital || pin.analogIn || pin.pwm || pin.i2c).map((pin) => <span key={pin.pin} style={{ ...chipStyle, borderColor: pinColor(pin) }}><b>{pin.pin}</b><small>{describePin(pin)}</small></span>)}</div></div>
}

function Badge({ color, label }: { color: string; label: string }): ReactElement { return <span style={{ ...chipStyle, borderColor: color, color }}>{label}</span> }
function Issue({ issue }: { issue: PinoutValidationIssue }): ReactElement { const color = issue.severity === 'error' ? '#fca5a5' : issue.severity === 'warning' ? '#fde68a' : '#bfdbfe'; return <div style={{ ...chipStyle, borderColor: color, color }}>{issue.message}</div> }
function getDefinition(id: string): PinoutComponentDefinition | undefined { return activeComponentsById[id] }
function collectMuxCandidates(design: PinoutDesign): MuxCandidate[] {
  return design.components.flatMap((component) => {
    const definition = getDefinition(component.definitionId)
    return (definition?.roles ?? []).filter((role) => role.muxCapable).map((role) => ({ component, role, definition }))
  })
}
function nextLabel(base: string, index: number): string { return index === 0 ? base : `${base} ${index + 1}` }
function targetToValue(target: ConnectionTarget): string { return target.kind === 'board' ? `board:${target.pin}` : `mux:${target.muxId}:${target.channel}` }
function valueToTarget(value: string): ConnectionTarget | null { const [kind, one, two] = value.split(':'); if (kind === 'board' && one) return { kind: 'board', pin: one }; if (kind === 'mux' && one && two !== undefined) return { kind: 'mux-channel', muxId: one, channel: Number(two) }; return null }
function compatiblePins(pins: BoardPinCapability[], role: PinoutComponentRole): BoardPinCapability[] { return getCompatiblePinsForRole(pins, role) }
function describePin(pin: BoardPinCapability): string { return [pin.power ? `power ${pin.power.toUpperCase()}` : '', pin.digital ? 'digital' : '', pin.analogIn ? 'analog' : '', pin.pwm ? 'PWM' : '', pin.i2c ? `I2C ${pin.i2c.toUpperCase()}` : '', pin.spi ? `SPI ${pin.spi.toUpperCase()}` : '', pin.uart ? `UART ${pin.uart.toUpperCase()}` : '', pin.interrupt ? 'interrupt' : '', pin.notes ?? ''].filter(Boolean).join(' · ') }
function boardPinBlockingOwners(design: PinoutDesign, item: Assignable, role: PinoutComponentRole, pin: BoardPinCapability): string[] {
  const key = getConnectionKey(item.id, role.role)
  const owners = design.connections.filter((connection) => getConnectionKey(connection.componentId, connection.role) !== key && connection.target.kind === 'board' && connection.target.pin === pin.pin)
  if (role.kind === 'i2c' && pin.i2c) {
    return owners.filter((connection) => getConnectionRoleKind(design, connection) !== 'i2c').map((connection) => ownerLabel(design, connection))
  }
  if (role.kind === 'power' && pin.power) {
    return owners.filter((connection) => getConnectionRoleKind(design, connection) !== 'power').map((connection) => ownerLabel(design, connection))
  }
  return owners.map((connection) => ownerLabel(design, connection))
}
function getConnectionRoleKind(design: PinoutDesign, connection: Connection): string | undefined {
  const owner = [...design.components, ...design.muxes].find((item) => item.id === connection.componentId)
  return getDefinition(owner?.definitionId ?? '')?.roles.find((role) => role.role === connection.role)?.kind
}
function ownerLabel(design: PinoutDesign, connection: Connection): string {
  const owner = [...design.components, ...design.muxes].find((item) => item.id === connection.componentId)
  const role = getDefinition(owner?.definitionId ?? '')?.roles.find((entry) => entry.role === connection.role)
  return `${owner?.label ?? connection.componentId} / ${role?.label ?? connection.role}`
}
function pinColor(pin: BoardPinCapability): string { if (pin.i2c) return '#a78bfa'; if (pin.analogIn) return '#34d399'; if (pin.pwm) return '#f59e0b'; return pin.digital ? '#60a5fa' : '#94a3b8' }
function flashSpecForBoard(board: BoardCatalogEntry): FlashBoardSpec | null {
  if (board.mcu === 'ATmega2560' || board.mcu === 'ATmega4809') return null
  if (board.id === 'uno') return FLASH_BOARDS.find((spec) => spec.id === 'uno') ?? null
  if (board.id === 'nano') return FLASH_BOARDS.find((spec) => spec.id === 'nano') ?? null
  if (board.mcu === 'ATmega328P') return FLASH_BOARDS.find((spec) => spec.mcu === 'atmega328p') ?? null
  if (board.mcu === 'ATmega32U4') return FLASH_BOARDS.find((spec) => spec.mcu === 'atmega32u4') ?? null
  if (board.mcu === 'ESP32') return FLASH_BOARDS.find((spec) => spec.mcu === 'esp32') ?? null
  if (board.mcu === 'ESP32-S3') return FLASH_BOARDS.find((spec) => spec.mcu === 'esp32s3') ?? null
  return null
}

const inputStyle: CSSProperties = { width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(148,163,184,.35)', background: 'var(--surface-sunken)', color: '#e5eefc', padding: '10px 12px' }
const hintStyle: CSSProperties = { color: '#9ca3af', fontSize: 12, lineHeight: 1.45 }
const heroStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, border: '1px solid rgba(148,163,184,.22)', borderRadius: 'var(--radius-sm)', padding: 18, background: 'var(--surface-base)' }
const panelStyle: CSSProperties = { border: '1px solid rgba(148,163,184,.22)', borderRadius: 'var(--radius-sm)', background: 'rgba(15, 23, 42, 0.72)', padding: 14 }
const gridPanelStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 12 }
const sectionTitle: CSSProperties = { margin: '0 0 8px' }
const primaryButton: CSSProperties = { ...inputStyle, marginTop: 8, background: 'var(--accent-primary)', borderColor: 'var(--border-strong)', cursor: 'pointer', fontWeight: 700 }
const secondaryButton: CSSProperties = { ...inputStyle, marginTop: 8, background: 'rgba(30,41,59,.78)', cursor: 'pointer' }
const miniButton: CSSProperties = { border: '1px solid rgba(148,163,184,.25)', background: '#111827', color: '#e5eefc', borderRadius: 'var(--radius-sm)', padding: '8px 10px', cursor: 'pointer' }
const tinyButton: CSSProperties = { ...miniButton, whiteSpace: 'nowrap' }
const stepButton: CSSProperties = { padding: 12, borderRadius: 'var(--radius-sm)', border: '1px solid', background: 'rgba(15,23,42,.82)', color: '#e5eefc', cursor: 'pointer', fontWeight: 700 }
const cardButton: CSSProperties = { ...panelStyle, display: 'grid', gap: 8, color: '#e5eefc', textAlign: 'left', cursor: 'pointer' }
const badgeRow: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' }
const chipStyle: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', border: '1px solid rgba(148,163,184,.24)', borderRadius: 'var(--radius-sm)', padding: '6px 9px', fontSize: 12 }
const filterPanelStyle: CSSProperties = { display: 'grid', gap: 10, border: '1px solid rgba(56,189,248,.24)', borderRadius: 'var(--radius-sm)', padding: 12, background: 'var(--surface-base)', margin: '12px 0 16px' }
const filterChipButton: CSSProperties = { border: '1px solid', borderRadius: 'var(--radius-sm)', padding: '7px 10px', cursor: 'pointer', fontWeight: 700 }
const catalogGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))', gap: 8 }
const componentCardButton: CSSProperties = { display: 'grid', gridTemplateColumns: '36px 1fr', gap: 9, textAlign: 'left', color: '#e5eefc', border: '1px solid rgba(148,163,184,.24)', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)', padding: 10, cursor: 'pointer' }
const selectedItemStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 8, alignItems: 'center', border: '1px solid rgba(148,163,184,.18)', borderRadius: 'var(--radius-sm)', padding: 8 }
const assignmentCardStyle: CSSProperties = { border: '1px solid rgba(148,163,184,.18)', borderRadius: 'var(--radius-sm)', padding: 12, background: 'rgba(2,6,23,.42)' }
const roleRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '210px 1fr', gap: 10, alignItems: 'center' }
const muxPanelStyle: CSSProperties = { display: 'grid', gap: 10, marginTop: 12, padding: 12, border: '1px solid rgba(20,184,166,.28)', borderRadius: 'var(--radius-sm)', background: 'rgba(13,148,136,.08)' }
const muxRoleRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 180px', gap: 10, alignItems: 'center' }
const fieldLabel: CSSProperties = { display: 'grid', gap: 6, color: '#bfdbfe', fontSize: 12, marginTop: 8 }
const progressTrack: CSSProperties = { height: 8, borderRadius: 'var(--radius-sm)', background: 'rgba(15,23,42,.95)', border: '1px solid rgba(148,163,184,.22)', overflow: 'hidden', marginTop: 10 }
const progressFill: CSSProperties = { height: '100%', background: 'var(--accent-primary)', transition: 'width .2s ease' }
const logBox: CSSProperties = { marginTop: 10, minHeight: 90, maxHeight: 180, overflow: 'auto', border: '1px solid rgba(148,163,184,.18)', borderRadius: 'var(--radius-sm)', padding: 8, background: 'rgba(2,6,23,.52)', fontSize: 11, lineHeight: 1.45 }
