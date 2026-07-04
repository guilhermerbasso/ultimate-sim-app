import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import {
  BOARDS,
  COMPONENT_TYPES,
  DEVICES_CHANNELS,
  type BoardId,
  type ComponentType,
  type DeviceComponent,
  type DeviceProfile,
  createComponent,
  findBoard,
  findComponentType
} from '../../../../shared/devices'
import { ARDUINO_CHANNELS, type ArduinoDevicesChangedPayload, type SerialDeviceSummary } from '../../../../shared/arduino'
import { SIMHUB_CHANNELS, type SimHubDetectResult, type SimHubImportResult } from '../../../../shared/simhub'
import { ComponentEditor } from '../hub/ComponentEditor'
import { Badge, Field, NumberField, SelectField, TextField } from '../hub/controls'
import type { SelectOption } from '../hub/controls'
import { SetupWizard } from '../hub/SetupWizard'
import { ACCENT, ACCENT_BORDER, badge, buttonStyle, card, getErrorMessage, helper, label, panel, shell } from '../hub/styles'

type ArduinoMode = 'disabled' | 'single' | 'multiple'

interface HardwareWorkspaceProps {
  showToast(message: string, variant?: 'success' | 'error' | 'info'): void
  mode: ArduinoMode
  focusTypes?: ComponentType[]
  layout?: 'guided' | 'legacy'
  title: string
  eyebrow: string
  description: string
  emptyText: string
  // Optional: navigate to the canonical "iFlag RGB Matrix" editor. Supplied by
  // ArduinosView for the My Hardware tab so an rgbMatrix component links straight
  // to its single source of truth (layout + customMap + effect stack) instead of
  // duplicating those fields here.
  onOpenRgbMatrix?: () => void
}

const BOARD_OPTIONS: ReadonlyArray<SelectOption<BoardId>> = BOARDS.map((board) => ({
  value: board.id,
  label: board.name
}))

const TYPE_BADGE: Record<ComponentType, string> = {
  rgbStrip: 'RGB LEDs',
  rgbMatrix: 'RGB Matrix',
  screen: 'Screen',
  segDisplay: 'TM1638 / 7-seg',
  gauge: 'Gauge',
  control: 'Controls',
  buzzer: 'Buzzer',
  startLed: 'Status LED'
}

function cloneProfile(profile: DeviceProfile): DeviceProfile {
  return JSON.parse(JSON.stringify(profile)) as DeviceProfile
}

function upsertProfile(list: DeviceProfile[], profile: DeviceProfile): DeviceProfile[] {
  const exists = list.some((item) => item.id === profile.id)
  return exists ? list.map((item) => (item.id === profile.id ? profile : item)) : [...list, profile]
}

function componentMatches(component: DeviceComponent, focusTypes?: ComponentType[]): boolean {
  return !focusTypes || focusTypes.includes(component.type)
}

export function HardwareWorkspace({
  showToast,
  mode,
  focusTypes,
  layout = 'guided',
  title,
  eyebrow,
  description,
  emptyText,
  onOpenRgbMatrix
}: HardwareWorkspaceProps): ReactElement {
  const [profiles, setProfiles] = useState<DeviceProfile[]>([])
  const [serialDevices, setSerialDevices] = useState<SerialDeviceSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DeviceProfile | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [expandedComponentId, setExpandedComponentId] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [simhubDialog, setSimhubDialog] = useState<SimHubDetectResult | null>(null)
  const [simhubDetectBusy, setSimhubDetectBusy] = useState(false)
  const [rightSection, setRightSection] = useState<'identity' | 'components'>('components')

  const selectedIdRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const serialRefreshTimersRef = useRef<number[]>([])
  selectedIdRef.current = selectedId
  dirtyRef.current = dirty

  async function refreshSerialDevices(): Promise<void> {
    try {
      const list = await window.ipc.invoke<SerialDeviceSummary[]>(ARDUINO_CHANNELS.listDevices)
      setSerialDevices(list)
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    }
  }

  function refreshSerialDevicesAfterFlash(): void {
    void refreshSerialDevices()
    for (const delayMs of [750, 1800]) {
      const timer = window.setTimeout(() => {
        serialRefreshTimersRef.current = serialRefreshTimersRef.current.filter((item) => item !== timer)
        void refreshSerialDevices()
      }, delayMs)
      serialRefreshTimersRef.current.push(timer)
    }
  }

  useEffect(() => {
    let active = true
    async function load(): Promise<void> {
      try {
        const list = await window.ipc.invoke<DeviceProfile[]>(DEVICES_CHANNELS.list)
        if (!active) return
        setProfiles(list)
        const first = list[0] ?? null
        setSelectedId(first?.id ?? null)
        setDraft(first ? cloneProfile(first) : null)
        setExpandedComponentId(first?.components.find((item) => componentMatches(item, focusTypes))?.id ?? null)
      } catch (loadError) {
        if (active) setError(getErrorMessage(loadError))
      }
    }
    void load()
    void refreshSerialDevices()

    const unsubscribeProfiles = window.ipc.subscribe<DeviceProfile[]>(DEVICES_CHANNELS.changed, (list) => {
      setProfiles(list)
      if (!dirtyRef.current) {
        const current = list.find((item) => item.id === selectedIdRef.current)
        if (current) setDraft(cloneProfile(current))
        else {
          const first = list[0] ?? null
          setSelectedId(first?.id ?? null)
          setDraft(first ? cloneProfile(first) : null)
        }
      }
    })
    const unsubscribeArduinoDevices = window.ipc.subscribe<ArduinoDevicesChangedPayload>(
      ARDUINO_CHANNELS.devicesChanged,
      (payload) => setSerialDevices(payload.devices)
    )

    return () => {
      active = false
      for (const timer of serialRefreshTimersRef.current) window.clearTimeout(timer)
      serialRefreshTimersRef.current = []
      unsubscribeProfiles()
      unsubscribeArduinoDevices()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const board = useMemo(() => findBoard(draft?.board ?? 'generic'), [draft?.board])
  const allowedComponentTypes = useMemo(
    () => COMPONENT_TYPES.filter((info) => !focusTypes || focusTypes.includes(info.type)),
    [focusTypes]
  )
  const visibleComponents = useMemo(
    () => draft?.components.filter((component) => componentMatches(component, focusTypes)) ?? [],
    [draft?.components, focusTypes]
  )

  useEffect(() => {
    if (!draft) return
    if (expandedComponentId && visibleComponents.some((component) => component.id === expandedComponentId)) return
    setExpandedComponentId(visibleComponents[0]?.id ?? null)
  }, [draft, expandedComponentId, visibleComponents])

  const conflicts = useMemo(() => {
    const usage = new Map<string, number>()
    if (draft) {
      for (const component of draft.components) {
        for (const pin of Object.values(component.pins)) {
          if (pin) usage.set(pin, (usage.get(pin) ?? 0) + 1)
        }
      }
    }
    return new Set([...usage.entries()].filter(([, count]) => count > 1).map(([pin]) => pin))
  }, [draft])

  const linkedSummary = useMemo(
    () => serialDevices.find((device) => device.id === draft?.deviceId) ?? null,
    [serialDevices, draft?.deviceId]
  )
  const isLegacyLayout = layout === 'legacy'
  const workspaceShell = isLegacyLayout
    ? shell
    : {
        display: 'grid',
        gridTemplateColumns: 'minmax(300px, 0.82fr) minmax(560px, 1.38fr)',
        gap: 22,
        alignItems: 'start'
      } as const
  const allComponentCount = draft?.components.length ?? 0
  const enabledComponentCount = draft?.components.filter((component) => component.enabled).length ?? 0
  const tabComponentSummary = `${visibleComponents.length} shown here · ${enabledComponentCount}/${allComponentCount} enabled`

  function selectDevice(id: string): void {
    if (id === selectedId) return
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return
    const profile = profiles.find((item) => item.id === id)
    setSelectedId(id)
    setDraft(profile ? cloneProfile(profile) : null)
    setExpandedComponentId(profile?.components.find((item) => componentMatches(item, focusTypes))?.id ?? null)
    setDirty(false)
    setError(null)
  }

  function updateDraft(patch: Partial<DeviceProfile>): void {
    if (!draft) return
    setDraft({ ...draft, ...patch })
    setDirty(true)
  }

  function replaceComponent(next: DeviceComponent): void {
    if (!draft) return
    updateDraft({ components: draft.components.map((item) => (item.id === next.id ? next : item)) })
  }

  function addComponent(type: ComponentType): void {
    if (!draft) return
    const component = createComponent(type)
    updateDraft({ components: [...draft.components, component] })
    setExpandedComponentId(component.id)
    setAddMenuOpen(false)
  }

  function removeComponent(id: string): void {
    if (!draft) return
    const target = draft.components.find((item) => item.id === id)
    if (target && !window.confirm(`Remove component “${target.label}”?`)) return
    updateDraft({ components: draft.components.filter((item) => item.id !== id) })
    if (expandedComponentId === id) setExpandedComponentId(null)
  }

  function toggleComponent(id: string, enabled: boolean): void {
    if (!draft) return
    updateDraft({ components: draft.components.map((item) => (item.id === id ? { ...item, enabled } : item)) })
  }

  async function persist(next: Partial<DeviceProfile>): Promise<DeviceProfile> {
    const saved = await window.ipc.invoke<DeviceProfile>(DEVICES_CHANNELS.save, next)
    setProfiles((prev) => upsertProfile(prev, saved))
    setSelectedId(saved.id)
    setDraft(cloneProfile(saved))
    setDirty(false)
    return saved
  }

  async function handleSave(): Promise<void> {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await persist(draft)
      showToast('Device saved.', 'success')
    } catch (saveError) {
      const message = getErrorMessage(saveError)
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleAddArduino(): Promise<void> {
    if (dirty && !window.confirm('Discard unsaved changes and create a new Arduino?')) return
    setBusy(true)
    setError(null)
    try {
      const baseBoard: BoardId = mode === 'single' ? 'pro-micro' : 'nano'
      const components = focusTypes?.length === 1 ? [createComponent(focusTypes[0])] : []
      const saved = await persist({
        label: mode === 'single' ? 'SIM-X Button Box' : `Arduino ${profiles.length + 1}`,
        board: baseBoard,
        baud: findBoard(baseBoard).defaultBaud,
        components
      })
      setExpandedComponentId(components[0]?.id ?? null)
      showToast(`“${saved.label}” created.`, 'success')
    } catch (addError) {
      const message = getErrorMessage(addError)
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleWizardComplete(profileId: string): Promise<void> {
    setWizardOpen(false)
    await refreshSerialDevices()
    try {
      const list = await window.ipc.invoke<DeviceProfile[]>(DEVICES_CHANNELS.list)
      setProfiles(list)
      const created = list.find((item) => item.id === profileId)
      if (created) {
        setSelectedId(profileId)
        setDraft(cloneProfile(created))
        setExpandedComponentId(created.components.find((item) => componentMatches(item, focusTypes))?.id ?? null)
        setDirty(false)
        setError(null)
        showToast(`“${created.label}” ready and selected.`, 'success')
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    }
  }

  async function handleSimHubDetect(): Promise<void> {
    setSimhubDetectBusy(true)
    setError(null)
    try {
      const detection = await window.ipc.invoke<{ found: boolean; reason?: string; configPath?: string; parsed?: SimHubDetectResult['parsed'] }>(SIMHUB_CHANNELS.detect)
      if (!detection.found) {
        setError(`SimHub não encontrado: ${detection.reason ?? 'motivo desconhecido'}`)
        return
      }
      setSimhubDialog(detection as SimHubDetectResult)
    } catch (detectError) {
      const message = getErrorMessage(detectError)
      setError(message)
      showToast(message, 'error')
    } finally {
      setSimhubDetectBusy(false)
    }
  }

  async function handleSimHubImport(): Promise<void> {
    setSimhubDialog(null)
    setBusy(true)
    setError(null)
    try {
      const result = await window.ipc.invoke<SimHubImportResult>(SIMHUB_CHANNELS.import)
      setProfiles((prev) => upsertProfile(prev, result.profile))
      setSelectedId(result.profile.id)
      setDraft(cloneProfile(result.profile))
      // Apply the wiring layout SimHub derived (serpentine + mirror) to the
      // rgb-matrix profile the iFlag renderer actually reads. Without this the
      // matrix store falls back to its default layout and a mirrored/reversed
      // SimHub config would render scrambled — exactly what the import avoids.
      const matrixComponent = result.profile.components.find((item) => item.type === 'rgbMatrix')
      if (matrixComponent) {
        await window.ipc.invoke('rgbmatrix:setLayout', `${result.profile.id}:${matrixComponent.id}`, result.layout)
      }
      setExpandedComponentId(result.profile.components.find((item) => componentMatches(item, focusTypes))?.id ?? null)
      setDirty(false)
      showToast(`"${result.profile.label}" importado do SimHub.`, 'success')
    } catch (importError) {
      const message = getErrorMessage(importError)
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteDevice(): Promise<void> {
    if (!draft) return
    if (!window.confirm(`Remove device “${draft.label}” and all its components?`)) return
    setBusy(true)
    setError(null)
    try {
      const list = await window.ipc.invoke<DeviceProfile[]>(DEVICES_CHANNELS.remove, draft.id)
      setProfiles(list)
      const first = list[0] ?? null
      setSelectedId(first?.id ?? null)
      setDraft(first ? cloneProfile(first) : null)
      setExpandedComponentId(first?.components.find((item) => componentMatches(item, focusTypes))?.id ?? null)
      setDirty(false)
      showToast('Device removed.', 'success')
    } catch (deleteError) {
      const message = getErrorMessage(deleteError)
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleTest(componentId: string): Promise<void> {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      let targetId = draft.id
      if (dirty) {
        const saved = await persist(draft)
        targetId = saved.id
      }
      const component = draft.components.find((item) => item.id === componentId)
      // SINGLE SOURCE OF TRUTH for the iFlag panel: an rgbMatrix component is
      // driven entirely by the rgb-matrix module (saved MatrixLayout + manual
      // customMap + effect stack), persisted in rgb-matrix-profiles.json under the
      // key `${deviceProfileId}:${componentId}`. Route its Test through the SAME
      // `rgbmatrix:testMapped` path the iFlag RGB Matrix editor uses so the frame
      // is rendered through that saved layout/customMap — this is what makes the
      // first AND last columns light correctly. The old generic row-by-row
      // `devices:test` branch ignored the layout and is no longer used for it.
      if (component?.type === 'rgbMatrix') {
        const sent = await window.ipc.invoke<boolean>('rgbmatrix:testMapped', `${targetId}:${componentId}`, 'all')
        if (!sent) {
          const message = 'Conecte o Arduino do iFlag e habilite o componente (modo iFlag) para testar.'
          setError(message)
          showToast(message, 'error')
          return
        }
        showToast('iFlag testado via layout salvo (RGB Matrix).', 'success')
        return
      }
      await window.ipc.invoke<void>(DEVICES_CHANNELS.test, targetId, componentId)
      showToast('Test frame sent to the device.', 'success')
    } catch (testError) {
      const message = getErrorMessage(testError)
      setError(message)
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const disabled = mode === 'disabled'

  // Keep the popover out of the native <select> open path. Closing on mousedown
  // capture re-renders before Chromium opens a dropdown, which makes every
  // picklist feel dead when the stale menu survives a flash/profile refresh.
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!addMenuOpen) return
    const closeFromOutside = (event: MouseEvent): void => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAddMenuOpen(false)
    }
    document.addEventListener('click', closeFromOutside)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('click', closeFromOutside)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [addMenuOpen])

  // Reset the open-state whenever the trigger can no longer be interacted with
  // or the active profile changes (e.g. a device hot-plug re-render), so a menu
  // can never linger open against a disabled/stale workspace.
  useEffect(() => {
    setAddMenuOpen(false)
  }, [disabled, selectedId, wizardOpen])

  return (
    <section style={workspaceShell}>
      <article style={{ ...panel, minHeight: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <span style={label}>{eyebrow}</span>
            <h3 style={{ margin: '8px 0 2px', fontSize: 22 }}>{title}</h3>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              style={buttonStyle('primary')}
              disabled={busy || disabled}
              onClick={() => setWizardOpen(true)}
              type="button"
              title="Flash a ready companion firmware and create the matching profile."
            >
              ⚡ Setup / Flash
            </button>
            <button style={buttonStyle('ghost')} disabled={busy || disabled} onClick={() => void handleAddArduino()} type="button">
              + Add Arduino
            </button>
            <button
              style={buttonStyle('ghost')}
              disabled={busy || disabled || simhubDetectBusy}
              onClick={() => void handleSimHubDetect()}
              type="button"
              title="Detectar SimHub instalado e importar as configurações de hardware (placa, matriz, pinos)."
            >
              {simhubDetectBusy ? '⏳ Detectando…' : '↓ Importar do SimHub'}
            </button>
          </div>
        </div>

        <p style={helper}>{description}</p>
        {!isLegacyLayout && (
          <div style={{ ...card, marginTop: 12, display: 'grid', gap: 8 }}>
            <span style={label}>Workflow</span>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                ['1', 'Create or select a profile'],
                ['2', 'Link it to an active serial device'],
                ['3', 'Add components, map pins, then Test']
              ].map(([step, text]) => (
                <div key={step} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <strong style={{ color: ACCENT, width: 20 }}>{step}</strong>
                  <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.72)' }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {disabled && (
          <div style={{ ...card, marginTop: 12, borderColor: 'rgba(255,187,51,0.4)', color: '#ffcf70' }}>
            Arduino management is disabled. Switch to Single or Multiple arduinos to edit profiles or send test frames.
          </div>
        )}

        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {!isLegacyLayout && <span style={label}>Hardware profiles</span>}
          {profiles.length === 0 && <p style={{ ...helper, marginTop: 4 }}>No hardware profiles yet. Click “Add Arduino”.</p>}
          {profiles.map((profile) => {
            const isActive = profile.id === selectedId
            const linked = serialDevices.find((device) => device.id === profile.deviceId) ?? null
            const visibleCount = profile.components.filter((item) => componentMatches(item, focusTypes)).length
            return (
              <button
                key={profile.id}
                onClick={() => selectDevice(profile.id)}
                type="button"
                style={{
                  ...card,
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderColor: isActive ? ACCENT : 'rgba(255,255,255,0.1)',
                  background: isActive ? 'rgba(232,105,32,0.12)' : card.background
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{profile.label}</strong>
                  <span
                    aria-hidden="true"
                    title={linked?.connected ? 'Linked and connected' : linked ? 'Linked offline' : 'Not linked'}
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      background: linked?.connected ? ACCENT : 'rgba(255,255,255,0.25)',
                    }}
                  />
                </div>
                <small style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {findBoard(profile.board).name} · {visibleCount}/{profile.components.length} in this tab
                  {profile.id === selectedId && dirty ? ' · unsaved' : ''}
                </small>
              </button>
            )
          })}
        </div>
      </article>

      <div style={{ display: 'grid', gap: 18 }}>
        {error && (
          <div role="alert" style={{ ...card, borderColor: 'rgba(209,52,56,0.5)', background: 'rgba(209,52,56,0.12)', color: '#ff9a9c' }}>
            {error}
          </div>
        )}

        {!draft ? (
          <article style={panel}>
            <span style={label}>Workspace</span>
            <h3 style={{ margin: '8px 0 4px', fontSize: 18 }}>Nenhum dispositivo selecionado</h3>
            <p style={{ ...helper, marginTop: 4 }}>Selecione um perfil na lista à esquerda ou crie um novo.</p>
            <div style={{ ...card, marginTop: 14 }}>
              <span style={label}>Primeiros passos</span>
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {([
                  ['⚡ Setup / Flash', 'Grava firmware e cria o perfil automaticamente — caminho recomendado.'],
                  ['+ Add Arduino', 'Cria um perfil vazio para configurar manualmente.'],
                  ['↓ Importar do SimHub', 'Importa placa e componentes já configurados no SimHub.']
                ] as [string, string][]).map(([action, desc]) => (
                  <div key={action} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <strong style={{ color: ACCENT, minWidth: 150, fontSize: 12 }}>{action}</strong>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ) : (
          <article style={panel}>
            {/* ── Device header: name + status badges + save/delete ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
              <div>
                <span style={label}>Perfil de hardware</span>
                <h3 style={{ margin: '6px 0 0', fontSize: 20 }}>{draft.label || 'Arduino'}</h3>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={badge}>{board.name}</span>
                  <span
                    style={{
                      ...badge,
                      borderColor: linkedSummary?.connected ? ACCENT_BORDER : 'rgba(255,255,255,0.18)',
                      color: linkedSummary?.connected ? 'var(--accent-primary)' : 'rgba(255,255,255,0.55)'
                    }}
                  >
                    {linkedSummary?.connected
                      ? `● ${linkedSummary.path}`
                      : linkedSummary
                        ? `○ ${linkedSummary.path} (offline)`
                        : '○ Sem link serial'}
                  </span>
                  <span style={{ ...badge, borderColor: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.55)' }}>
                    {allComponentCount} componente{allComponentCount !== 1 ? 's' : ''} · {enabledComponentCount} ativo{enabledComponentCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                {dirty && <Badge>não salvo</Badge>}
                <button style={buttonStyle('primary')} disabled={busy || disabled || !dirty} onClick={() => void handleSave()} type="button">
                  Salvar
                </button>
                <button style={buttonStyle('danger')} disabled={busy || disabled} onClick={() => void handleDeleteDevice()} type="button">
                  Excluir
                </button>
              </div>
            </div>

            {/* ── Inner section tabs ── */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                type="button"
                className={rightSection === 'components' ? 'chip-toggle active' : 'chip-toggle'}
                onClick={() => setRightSection('components')}
                title="Adicionar, configurar e testar componentes deste Arduino"
              >
                Componentes ({visibleComponents.length})
              </button>
              <button
                type="button"
                className={rightSection === 'identity' ? 'chip-toggle active' : 'chip-toggle'}
                onClick={() => setRightSection('identity')}
                title="Editar nome, placa, baud rate e porta serial vinculada"
              >
                Identidade
              </button>
            </div>

            {/* ── Identity section ── */}
            {rightSection === 'identity' && (
              <div style={{ display: 'grid', gap: 12, opacity: disabled ? 0.65 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
                <Field caption="Nome">
                  <TextField value={draft.label} onChange={(value) => updateDraft({ label: value })} placeholder="Ex.: iFlag Arduino" />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field caption="Placa (board)">
                    <SelectField value={draft.board} options={BOARD_OPTIONS} onChange={(value) => updateDraft({ board: value })} />
                  </Field>
                  <Field caption="Baud rate">
                    <NumberField value={draft.baud} min={300} max={2000000} onChange={(value) => updateDraft({ baud: value })} />
                  </Field>
                </div>
                <Field
                  caption="Porta serial vinculada"
                  hint={linkedSummary ? `${linkedSummary.path} · ${linkedSummary.connected ? 'conectado' : 'offline'}` : 'Opcional — escolha a porta aberta em Conexões & Firmware.'}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      value={draft.deviceId ?? ''}
                      onChange={(event) => updateDraft({ deviceId: event.target.value || undefined })}
                      style={{
                        flex: 1,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.14)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'inherit',
                        fontSize: 13,
                        padding: '8px 10px'
                      }}
                    >
                      <option value="">(não vinculado)</option>
                      {serialDevices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label} · {device.kind} {device.connected ? '●' : '○'}
                        </option>
                      ))}
                    </select>
                    <button style={buttonStyle('ghost')} disabled={busy} onClick={() => void refreshSerialDevices()} type="button">
                      Atualizar
                    </button>
                  </div>
                </Field>
              </div>
            )}

            {/* ── Components section ── */}
            {rightSection === 'components' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <p style={{ ...helper, margin: 0 }}>
                    {visibleComponents.length === 0
                      ? 'Nenhum componente neste perfil. Adicione um.'
                      : `${enabledComponentCount}/${allComponentCount} habilitado${allComponentCount !== 1 ? 's' : ''}`}
                  </p>
                  <div ref={addMenuRef} style={{ position: 'relative' }}>
                    <button
                      style={buttonStyle('soft', addMenuOpen)}
                      disabled={disabled}
                      onClick={() => setAddMenuOpen((open) => !open)}
                      type="button"
                      aria-expanded={addMenuOpen}
                      aria-haspopup="menu"
                      title="Adicionar componente (LED strip, screen, encoder, etc.)"
                    >
                      + Adicionar componente
                    </button>
                    {addMenuOpen && !disabled && (
                      <div
                        role="menu"
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 'calc(100% + 6px)',
                          zIndex: 21,
                          width: 320,
                          maxHeight: 360,
                          overflowY: 'auto',
                          background: 'rgba(16,20,26,0.98)',
                          border: '1px solid rgba(255,255,255,0.14)',
                          borderRadius: 'var(--radius-sm)',
                          boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
                          padding: 8
                        }}
                      >
                        {allowedComponentTypes.map((info) => (
                          <button
                            key={info.type}
                            onClick={() => addComponent(info.type)}
                            type="button"
                            style={{ ...buttonStyle('ghost'), display: 'block', width: '100%', textAlign: 'left', border: 'none', padding: '9px 10px' }}
                          >
                            <strong style={{ display: 'block', fontSize: 13 }}>{info.name}</strong>
                            <small style={{ color: 'rgba(255,255,255,0.55)' }}>SimHub: {info.simhubEquivalent}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 10 }}>
                  {visibleComponents.length === 0 && <p style={helper}>{emptyText}</p>}
                  {visibleComponents.map((component) => {
                    const isExpanded = component.id === expandedComponentId
                    const typeInfo = findComponentType(component.type)
                    return (
                      <div key={component.id} style={card}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <input
                            type="checkbox"
                            checked={component.enabled}
                            disabled={disabled}
                            onChange={(event) => toggleComponent(component.id, event.target.checked)}
                            title={component.enabled ? 'Habilitado' : 'Desabilitado'}
                            style={{ accentColor: ACCENT, width: 16, height: 16 }}
                          />
                          <input
                            type="text"
                            value={component.label}
                            disabled={disabled}
                            onChange={(event) => replaceComponent({ ...component, label: event.target.value })}
                            style={{
                              flex: 1,
                              minWidth: 120,
                              background: 'transparent',
                              border: '1px solid transparent',
                              borderBottom: '1px solid rgba(255,255,255,0.14)',
                              color: 'inherit',
                              fontSize: 14,
                              fontWeight: 600,
                              padding: '4px 2px'
                            }}
                          />
                          <Badge>{TYPE_BADGE[component.type]}</Badge>
                          <Badge>{typeInfo.simhubEquivalent}</Badge>
                          <button style={buttonStyle('ghost')} disabled={busy || disabled} onClick={() => void handleTest(component.id)} type="button" title="Envia frame de teste ao hardware">
                            Testar
                          </button>
                          <button style={buttonStyle('soft', isExpanded)} onClick={() => setExpandedComponentId(isExpanded ? null : component.id)} type="button" aria-expanded={isExpanded}>
                            {isExpanded ? 'Fechar' : 'Editar'}
                          </button>
                          <button style={buttonStyle('danger')} disabled={disabled} onClick={() => removeComponent(component.id)} type="button">
                            Remover
                          </button>
                        </div>
                        {isExpanded && (
                          <div style={{ marginTop: 12, opacity: disabled ? 0.65 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
                            {component.type === 'rgbMatrix' && onOpenRgbMatrix ? (
                              <div
                                style={{
                                  ...card,
                                  marginBottom: 12,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 12,
                                  flexWrap: 'wrap',
                                  borderColor: ACCENT_BORDER,
                                  background: 'rgba(232,105,32,0.06)'
                                }}
                              >
                                <div>
                                  <strong style={{ display: 'block', fontSize: 13 }}>Editor do iFlag (RGB Matrix)</strong>
                                  <small style={{ color: 'rgba(255,255,255,0.65)' }}>
                                    Layout, mapa de pixels e pilha de efeitos — fonte única de configuração do iFlag.
                                    O botão Testar usa exatamente este layout salvo.
                                  </small>
                                </div>
                                <button
                                  type="button"
                                  style={buttonStyle('primary')}
                                  disabled={disabled}
                                  onClick={() => onOpenRgbMatrix()}
                                >
                                  Abrir editor do iFlag →
                                </button>
                              </div>
                            ) : null}
                            <ComponentEditor component={component} board={board} conflicts={conflicts} onChange={replaceComponent} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </article>
        )}
      </div>

      {wizardOpen && (
        <SetupWizard
          onClose={() => setWizardOpen(false)}
          onComplete={(profileId) => void handleWizardComplete(profileId)}
          onFlashSettled={refreshSerialDevicesAfterFlash}
          showToast={showToast}
        />
      )}

      {simhubDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Importar do SimHub"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <article style={{ ...panel, width: 460, maxWidth: '90vw' }}>
            <span style={label}>Importar do SimHub</span>
            <h3 style={{ margin: '8px 0 14px', fontSize: 18 }}>Configuração detectada</h3>

            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              <div style={card}>
                <span style={label}>Arquivo</span>
                <small style={{ display: 'block', marginTop: 4, color: 'rgba(255,255,255,0.65)', wordBreak: 'break-all' }}>
                  {simhubDialog.configPath}
                </small>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={card}>
                  <span style={label}>Placa (SimHub)</span>
                  <strong style={{ display: 'block', marginTop: 4 }}>{simhubDialog.parsed.simhubBoardId}</strong>
                  <small style={{ color: 'rgba(255,255,255,0.55)' }}>→ {simhubDialog.parsed.board}</small>
                </div>
                <div style={card}>
                  <span style={label}>Porta serial</span>
                  <strong style={{ display: 'block', marginTop: 4 }}>{simhubDialog.parsed.serialPort || '—'}</strong>
                </div>
              </div>
              <div style={card}>
                <span style={label}>Matriz WS2812B (iFlag)</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                  {[
                    ['Habilitada', simhubDialog.parsed.matrix.enabled ? 'Sim ✓' : 'Não'],
                    ['Data pin', `D${simhubDialog.parsed.matrix.dataPin}`],
                    ['Serpentine', simhubDialog.parsed.matrix.serpentine ? 'Sim' : 'Não'],
                    ['Serpentine rev', simhubDialog.parsed.matrix.serpentineRev ? 'Sim' : 'Não'],
                    ['Mirror H', simhubDialog.parsed.matrix.leftRightMirror ? 'Sim' : 'Não']
                  ].map(([k, v]) => (
                    <div key={k as string}>
                      <small style={{ color: 'rgba(255,255,255,0.5)' }}>{k}</small>
                      <strong style={{ display: 'block', fontSize: 13 }}>{v}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <p style={{ ...helper, marginBottom: 14 }}>
              Um novo perfil de hardware será criado com a placa e o componente iFlag configurados conforme o SimHub.
              Você poderá ajustar pinos e componentes adicionais depois.
            </p>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={buttonStyle('ghost')} onClick={() => setSimhubDialog(null)} type="button">
                Cancelar
              </button>
              <button style={buttonStyle('primary')} disabled={busy} onClick={() => void handleSimHubImport()} type="button">
                Importar
              </button>
            </div>
          </article>
        </div>
      )}
    </section>
  )
}
