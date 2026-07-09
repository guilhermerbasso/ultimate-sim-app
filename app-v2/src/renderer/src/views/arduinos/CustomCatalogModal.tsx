// Modal used in the Arduinos screen to create/edit user-defined ("custom")
// pinout components and Arduino boards. Custom entries are persisted in the main
// process (pinout:saveCustomComponent / pinout:saveCustomBoard) and become
// first-class members of the merged catalog used by the Pinout Designer and the
// firmware generator.

import { type CSSProperties, type ReactElement, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CUSTOM_BOARD_VOLTAGES,
  CUSTOM_COMPONENT_CATEGORIES,
  CUSTOM_PIN_POWER_CODES,
  CUSTOM_POWER_RAILS,
  CUSTOM_ROLE_DIRECTIONS,
  CUSTOM_ROLE_KINDS,
  type BoardCatalogEntry,
  type BoardPinCapability,
  type CustomCatalog,
  type PinoutComponentCategory,
  type PinoutComponentDefinition,
  type PinoutComponentRole,
  type PinoutPinKind,
  type PowerRail
} from '../../../../shared/board-catalog'
import { PINOUT_CUSTOM_CHANNELS } from '../../../../shared/pinout'
import { Field, SelectField, TextField, Toggle, type SelectOption } from '../hub/controls'
import { ACCENT, buttonStyle, card, getErrorMessage, helper, input, label as labelStyle, panel } from '../hub/styles'

type ModalTab = 'component' | 'board'
type RoleKind = Exclude<PinoutPinKind, 'channel'>
type RoleDirection = NonNullable<PinoutComponentRole['direction']>
type BoardLapge = BoardCatalogEntry['lapge']
type PinPower = 'none' | NonNullable<BoardPinCapability['power']>
type PinI2c = 'none' | 'sda' | 'scl'
type PinSpi = 'none' | 'mosi' | 'miso' | 'sck' | 'ss'
type PinUart = 'none' | 'rx' | 'tx'

export type CustomCatalogEditTarget =
  | { kind: 'component'; entry: PinoutComponentDefinition }
  | { kind: 'board'; entry: BoardCatalogEntry }

interface CustomCatalogModalProps {
  defaultTab: ModalTab
  editing?: CustomCatalogEditTarget | null
  onClose: () => void
  onSaved: (catalog: CustomCatalog) => void
  showToast: (message: string, tone?: 'success' | 'error' | 'info') => void
}

interface RoleRow {
  key: string
  label: string
  kind: RoleKind
  direction: RoleDirection
  optional: boolean
}

interface PinRow {
  key: string
  pin: string
  digital: boolean
  analogIn: boolean
  pwm: boolean
  i2c: PinI2c
  spi: PinSpi
  uart: PinUart
  interrupt: boolean
  power: PinPower
}

let uidCounter = 0
function uid(): string {
  uidCounter += 1
  return `row-${Date.now().toString(36)}-${uidCounter}`
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function toOptions<T extends string>(values: ReadonlyArray<T>, format: (value: T) => string = titleCase): Array<SelectOption<T>> {
  return values.map((value) => ({ value, label: format(value) }))
}

const ROLE_KIND_OPTIONS = toOptions<RoleKind>(CUSTOM_ROLE_KINDS, (kind) => (kind === 'i2c' || kind === 'spi' || kind === 'uart' || kind === 'pwm' ? kind.toUpperCase() : titleCase(kind)))
const ROLE_DIRECTION_OPTIONS = toOptions<RoleDirection>(CUSTOM_ROLE_DIRECTIONS, (direction) => (direction === 'bidir' ? 'Bidirectional' : titleCase(direction)))
const CATEGORY_OPTIONS = toOptions<PinoutComponentCategory>(CUSTOM_COMPONENT_CATEGORIES, (category) => category)
const VOLTAGE_OPTIONS = toOptions<BoardLapge>(CUSTOM_BOARD_VOLTAGES, (voltage) => voltage)
const PIN_POWER_OPTIONS = toOptions<PinPower>(['none', ...CUSTOM_PIN_POWER_CODES], (code) => (code === 'none' ? 'Signal pin' : code.toUpperCase()))
const PIN_I2C_OPTIONS = toOptions<PinI2c>(['none', 'sda', 'scl'], (value) => (value === 'none' ? '—' : value.toUpperCase()))
const PIN_SPI_OPTIONS = toOptions<PinSpi>(['none', 'mosi', 'miso', 'sck', 'ss'], (value) => (value === 'none' ? '—' : value.toUpperCase()))
const PIN_UART_OPTIONS = toOptions<PinUart>(['none', 'rx', 'tx'], (value) => (value === 'none' ? '—' : value.toUpperCase()))

function newRoleRow(): RoleRow {
  return { key: uid(), label: '', kind: 'digital', direction: 'bidir', optional: false }
}

function newPinRow(): PinRow {
  return { key: uid(), pin: '', digital: true, analogIn: false, pwm: false, i2c: 'none', spi: 'none', uart: 'none', interrupt: false, power: 'none' }
}

function rolesFromDefinition(definition: PinoutComponentDefinition): RoleRow[] {
  if (definition.roles.length === 0) return [newRoleRow()]
  return definition.roles.map((role) => ({
    key: uid(),
    label: role.label,
    kind: role.kind,
    direction: role.direction ?? 'bidir',
    optional: Boolean(role.optional)
  }))
}

function pinsFromBoard(board: BoardCatalogEntry): PinRow[] {
  if (board.pins.length === 0) return [newPinRow()]
  return board.pins.map((pin) => ({
    key: uid(),
    pin: pin.pin,
    digital: pin.digital,
    analogIn: pin.analogIn,
    pwm: pin.pwm,
    i2c: pin.i2c ?? 'none',
    spi: pin.spi ?? 'none',
    uart: pin.uart ?? 'none',
    interrupt: Boolean(pin.interrupt),
    power: pin.power ?? 'none'
  }))
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  // Rendered through a portal on document.body, so this sits above the whole
  // app shell (sidebar nav, toasts) regardless of any transformed/filtered
  // ancestor that would otherwise clip a position:fixed overlay.
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(2,6,12,0.62)',
  backdropFilter: 'blur(6px)',
  padding: 20
}

const modalStyle: CSSProperties = {
  ...panel,
  width: 'min(820px, 96vw)',
  maxHeight: '92vh',
  overflowY: 'auto',
  display: 'grid',
  gap: 14
}

const rowCardStyle: CSSProperties = {
  ...card,
  display: 'grid',
  gap: 10,
  padding: 12
}

const textareaStyle: CSSProperties = {
  ...input,
  minHeight: 70,
  resize: 'vertical',
  fontFamily: 'inherit'
}

export default function CustomCatalogModal({ defaultTab, editing, onClose, onSaved, showToast }: CustomCatalogModalProps): ReactElement {
  const lockedTab: ModalTab | null = editing ? editing.kind : null
  const [tab, setTab] = useState<ModalTab>(lockedTab ?? defaultTab)
  const [busy, setBusy] = useState(false)

  // Escape always closes this portal modal. Without it, a stuck-open dialog
  // (zIndex 1000, rendered on document.body) would block pointer input across
  // the entire app — including the nav used to switch away — until restart.
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape, true)
    return () => document.removeEventListener('keydown', closeOnEscape, true)
  }, [onClose])

  const editingComponent = editing?.kind === 'component' ? editing.entry : null
  const editingBoard = editing?.kind === 'board' ? editing.entry : null

  // ─── Component form state ──────────────────────────────────────────────────
  const [componentName, setComponentName] = useState(editingComponent?.name ?? '')
  const [componentCategory, setComponentCategory] = useState<PinoutComponentCategory>(editingComponent?.category ?? 'Custom')
  const [componentDescription, setComponentDescription] = useState(editingComponent?.description ?? '')
  const [roleRows, setRoleRows] = useState<RoleRow[]>(editingComponent ? rolesFromDefinition(editingComponent) : [newRoleRow()])
  const [powerRails, setPowerRails] = useState<PowerRail[]>(editingComponent?.power ?? [])
  const [componentNotes, setComponentNotes] = useState((editingComponent?.defaultWiringNotes ?? []).join('\n'))
  const [firmwareHint, setFirmwareHint] = useState(editingComponent?.tips?.[0] ?? '')
  const [componentUsbHid, setComponentUsbHid] = useState(Boolean(editingComponent?.requiresNativeUsbHid))

  // ─── Board form state ──────────────────────────────────────────────────────
  const [boardName, setBoardName] = useState(editingBoard?.name ?? '')
  const [boardMcu, setBoardMcu] = useState(editingBoard?.mcu ?? '')
  const [boardFqbn, setBoardFqbn] = useState(editingBoard?.fqbn ?? '')
  const [boardLapge, setBoardLapge] = useState<BoardLapge>(editingBoard?.lapge ?? '5V')
  const [boardUsbHid, setBoardUsbHid] = useState(Boolean(editingBoard?.usbHid))
  const [boardNotes, setBoardNotes] = useState(editingBoard?.notes ?? '')
  const [pinRows, setPinRows] = useState<PinRow[]>(editingBoard ? pinsFromBoard(editingBoard) : [newPinRow()])

  const title = useMemo(() => {
    if (editingComponent) return `Edit component · ${editingComponent.name}`
    if (editingBoard) return `Edit Arduino · ${editingBoard.name}`
    return 'Add component or Arduino'
  }, [editingComponent, editingBoard])

  const togglePowerRail = (rail: PowerRail, checked: boolean): void => {
    setPowerRails((prev) => (checked ? Array.from(new Set([...prev, rail])) : prev.filter((entry) => entry !== rail)))
  }

  const updateRole = (key: string, patch: Partial<RoleRow>): void => {
    setRoleRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const updatePin = (key: string, patch: Partial<PinRow>): void => {
    setPinRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const saveComponent = async (): Promise<void> => {
    const name = componentName.trim()
    if (!name) {
      showToast('Give the component a name before saving.', 'error')
      return
    }
    const roles = roleRows
      .filter((row) => row.label.trim())
      .map((row) => ({ label: row.label.trim(), kind: row.kind, direction: row.direction, optional: row.optional }))
    if (roles.length === 0) {
      showToast('Add at least one pin role so the firmware can be generated.', 'error')
      return
    }
    const payload = {
      id: editingComponent?.id,
      name,
      category: componentCategory,
      description: componentDescription.trim(),
      plainLanguageDescription: componentDescription.trim(),
      roles,
      power: powerRails,
      defaultWiringNotes: componentNotes,
      tips: firmwareHint.trim() ? [firmwareHint.trim()] : [],
      requiresNativeUsbHid: componentUsbHid
    }
    setBusy(true)
    try {
      const catalog = await window.ipc.invoke<CustomCatalog>(PINOUT_CUSTOM_CHANNELS.saveComponent, payload)
      onSaved(catalog)
      showToast(`Saved component "${name}".`, 'success')
      onClose()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveBoard = async (): Promise<void> => {
    const name = boardName.trim()
    if (!name) {
      showToast('Give the Arduino a name before saving.', 'error')
      return
    }
    const pins = pinRows
      .filter((row) => row.pin.trim())
      .map((row) => ({
        pin: row.pin.trim(),
        digital: row.digital,
        analogIn: row.analogIn,
        pwm: row.pwm,
        i2c: row.i2c === 'none' ? undefined : row.i2c,
        spi: row.spi === 'none' ? undefined : row.spi,
        uart: row.uart === 'none' ? undefined : row.uart,
        interrupt: row.interrupt,
        power: row.power === 'none' ? undefined : row.power
      }))
    if (pins.length === 0) {
      showToast('Add at least one pin (e.g. D2, A0 or GPIO5).', 'error')
      return
    }
    const payload = {
      id: editingBoard?.id,
      name,
      mcu: boardMcu.trim(),
      fqbn: boardFqbn.trim() || undefined,
      lapge: boardLapge,
      usbHid: boardUsbHid,
      notes: boardNotes.trim(),
      pins
    }
    setBusy(true)
    try {
      const catalog = await window.ipc.invoke<CustomCatalog>(PINOUT_CUSTOM_CHANNELS.saveBoard, payload)
      onSaved(catalog)
      showToast(`Saved Arduino "${name}".`, 'success')
      onClose()
    } catch (error) {
      showToast(getErrorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      style={overlayStyle}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div style={modalStyle} role="dialog" aria-modal="true" aria-label={title}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <span style={labelStyle}>Pinout · Custom catalog</span>
            <h2 style={{ margin: '4px 0 0', fontSize: 18 }}>{title}</h2>
          </div>
          <button type="button" style={buttonStyle('ghost')} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {!editing ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={buttonStyle('soft', tab === 'component')} onClick={() => setTab('component')}>
              ＋ Add component
            </button>
            <button type="button" style={buttonStyle('soft', tab === 'board')} onClick={() => setTab('board')}>
              ＋ Add Arduino
            </button>
          </div>
        ) : null}

        {tab === 'component' ? (
          <section style={{ display: 'grid', gap: 12 }}>
            <p style={{ ...helper, margin: 0 }}>
              Describe a component so the designer can place it and the firmware generator can emit the right pinMode() for every wire.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
              <Field caption="Name" hint="Shown in the component picker.">
                <TextField value={componentName} onChange={setComponentName} placeholder="e.g. 16-segment HUD bar" />
              </Field>
              <Field caption="Category">
                <SelectField value={componentCategory} options={CATEGORY_OPTIONS} onChange={setComponentCategory} />
              </Field>
            </div>
            <Field caption="Description" hint="One line explaining what it does.">
              <TextField value={componentDescription} onChange={setComponentDescription} placeholder="What is it and what does it drive?" />
            </Field>

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={labelStyle}>Required pin roles</span>
                <button type="button" style={buttonStyle('soft')} onClick={() => setRoleRows((prev) => [...prev, newRoleRow()])}>
                  ＋ Add role
                </button>
              </div>
              {roleRows.map((row, index) => (
                <div key={row.key} style={rowCardStyle}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 10 }}>
                    <Field caption={`Role ${index + 1} label`}>
                      <TextField value={row.label} onChange={(value) => updateRole(row.key, { label: value })} placeholder="e.g. Data / CLK / SDA" />
                    </Field>
                    <Field caption="Signal kind">
                      <SelectField value={row.kind} options={ROLE_KIND_OPTIONS} onChange={(value) => updateRole(row.key, { kind: value })} />
                    </Field>
                    <Field caption="Direction">
                      <SelectField value={row.direction} options={ROLE_DIRECTION_OPTIONS} onChange={(value) => updateRole(row.key, { direction: value })} />
                    </Field>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <Toggle caption="Optional pin" checked={row.optional} onChange={(checked) => updateRole(row.key, { optional: checked })} />
                    <button
                      type="button"
                      style={buttonStyle('danger')}
                      onClick={() => setRoleRows((prev) => (prev.length > 1 ? prev.filter((entry) => entry.key !== row.key) : prev))}
                      disabled={roleRows.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <span style={labelStyle}>Power needs</span>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {CUSTOM_POWER_RAILS.map((rail) => (
                  <Toggle key={rail} caption={rail} checked={powerRails.includes(rail)} onChange={(checked) => togglePowerRail(rail, checked)} />
                ))}
              </div>
            </div>

            <Field caption="Default firmware hint" hint="Optional: which library/driver to mention in the generated sketch.">
              <TextField value={firmwareHint} onChange={setFirmwareHint} placeholder="e.g. Use Adafruit_NeoPixel; 5V data level shift." />
            </Field>
            <Field caption="Wiring notes" hint="One note per line. Shown in the designer and generated sketch.">
              <textarea style={textareaStyle} value={componentNotes} onChange={(event) => setComponentNotes(event.target.value)} placeholder={'Confirm voltage and required libraries.\nShare GND with the Arduino.'} />
            </Field>
            <Toggle caption="Needs a native USB-HID board (Leonardo / Pro Micro / ESP32-S2/S3)" checked={componentUsbHid} onChange={setComponentUsbHid} />

            <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" style={buttonStyle('ghost')} onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" style={buttonStyle('primary')} onClick={() => void saveComponent()} disabled={busy}>
                {busy ? 'Saving…' : editingComponent ? 'Save changes' : 'Save component'}
              </button>
            </footer>
          </section>
        ) : (
          <section style={{ display: 'grid', gap: 12 }}>
            <p style={{ ...helper, margin: 0 }}>
              Define a custom board so it appears in the designer and the per-board compatibility filter. Add power pins (5V/3V3/GND) so components that need power validate correctly.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
              <Field caption="Name">
                <TextField value={boardName} onChange={setBoardName} placeholder="e.g. Custom RP2040 board" />
              </Field>
              <Field caption="MCU">
                <TextField value={boardMcu} onChange={setBoardMcu} placeholder="e.g. RP2040 / ATmega328P" />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12 }}>
              <Field caption="FQBN" hint="Optional. Needed for one-click compile/flash via arduino-cli.">
                <TextField value={boardFqbn} onChange={setBoardFqbn} placeholder="e.g. rp2040:rp2040:rpipico" />
              </Field>
              <Field caption="Logic voltage">
                <SelectField value={boardLapge} options={VOLTAGE_OPTIONS} onChange={setBoardLapge} />
              </Field>
            </div>
            <Toggle caption="Native USB HID (board can act as a USB game controller)" checked={boardUsbHid} onChange={setBoardUsbHid} />

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={labelStyle}>Pins &amp; capabilities</span>
                <button type="button" style={buttonStyle('soft')} onClick={() => setPinRows((prev) => [...prev, newPinRow()])}>
                  ＋ Add pin
                </button>
              </div>
              <p style={{ ...helper, margin: 0 }}>Use ids like D2, A0 or GPIO5 so the generator can map them to firmware pin numbers.</p>
              {pinRows.map((row) => (
                <div key={row.key} style={rowCardStyle}>
                  <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1fr 1fr 1fr', gap: 10, alignItems: 'end' }}>
                    <Field caption="Pin id">
                      <TextField value={row.pin} onChange={(value) => updatePin(row.key, { pin: value })} placeholder="D2 / A0 / GPIO5" />
                    </Field>
                    <Field caption="I2C">
                      <SelectField value={row.i2c} options={PIN_I2C_OPTIONS} onChange={(value) => updatePin(row.key, { i2c: value })} />
                    </Field>
                    <Field caption="SPI">
                      <SelectField value={row.spi} options={PIN_SPI_OPTIONS} onChange={(value) => updatePin(row.key, { spi: value })} />
                    </Field>
                    <Field caption="UART">
                      <SelectField value={row.uart} options={PIN_UART_OPTIONS} onChange={(value) => updatePin(row.key, { uart: value })} />
                    </Field>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Toggle caption="Digital" checked={row.digital} onChange={(checked) => updatePin(row.key, { digital: checked })} />
                    <Toggle caption="Analog in" checked={row.analogIn} onChange={(checked) => updatePin(row.key, { analogIn: checked })} />
                    <Toggle caption="PWM" checked={row.pwm} onChange={(checked) => updatePin(row.key, { pwm: checked })} />
                    <Toggle caption="Interrupt" checked={row.interrupt} onChange={(checked) => updatePin(row.key, { interrupt: checked })} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ ...helper, margin: 0 }}>Power rail</span>
                      <div style={{ minWidth: 120 }}>
                        <SelectField value={row.power} options={PIN_POWER_OPTIONS} onChange={(value) => updatePin(row.key, { power: value })} />
                      </div>
                    </div>
                    <button
                      type="button"
                      style={{ ...buttonStyle('danger'), marginLeft: 'auto' }}
                      onClick={() => setPinRows((prev) => (prev.length > 1 ? prev.filter((entry) => entry.key !== row.key) : prev))}
                      disabled={pinRows.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <Field caption="Notes" hint="Optional. Lapge, bootloader or wiring caveats.">
              <textarea style={textareaStyle} value={boardNotes} onChange={(event) => setBoardNotes(event.target.value)} placeholder="Anything special about this board." />
            </Field>

            <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" style={buttonStyle('ghost')} onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="button" style={{ ...buttonStyle('primary'), borderColor: ACCENT }} onClick={() => void saveBoard()} disabled={busy}>
                {busy ? 'Saving…' : editingBoard ? 'Save changes' : 'Save Arduino'}
              </button>
            </footer>
          </section>
        )}
      </div>
    </div>,
    document.body
  )
}
