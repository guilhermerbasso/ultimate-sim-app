import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type CSSProperties, type ReactElement } from 'react'
import { EXPR_CHANNELS, type ExpressionDef } from '../../../shared/expr'
import type {
  AppActionName,
  IracingCommandGroup,
  IracingCommandName,
  KeyboardMacroCommand
} from '../../../shared/actions'
import { OVERLAY_WIDGETS, overlayWidgetDisplayTitle } from '../../../shared/overlays'
import {
  BUTTON_MAX_BORDER,
  BUTTON_SHAPES,
  BUTTON_MAX_FONT,
  BUTTON_MIN_BORDER,
  BUTTON_MIN_FONT,
  IMAGE_MAX_BYTES,
  PANEL_MAX_COLUMNS,
  PANEL_MAX_GAP,
  PANEL_MAX_ROWS,
  PANEL_MIN_COLUMNS,
  PANEL_MIN_GAP,
  PANEL_MIN_ROWS,
  TOUCH_CONTROL_KINDS,
  TOUCH_CONTROL_STATE_DESTINATIONS,
  TYRE_CORNER_LABELS,
  clampBorderWidth,
  clampColumns,
  clampFontSize,
  clampGap,
  clampRows,
  createButtonBoxButton,
  createTouchControl,
  describeButtonAction,
  isDataUrlWithinLimit,
  primaryButtonAction,
  safeImage,
  resizePanelButtons,
  type ButtonAction,
  type ButtonBoxButton,
  type ButtonBoxPanel,
  type ButtonShape,
  type KeyMaterial,
  type TouchControl,
  type TouchControlKind,
  type TouchControlStateBindings,
  type TouchControlStateDefaults,
  type TouchRepeatConfig
} from '../../../shared/touch-panel'
import { ButtonBoxRenderer } from './ButtonBoxRenderer'
import { MATERIAL_OPTIONS } from './keyMaterials'
import { ICON_OPTIONS } from './icons'
import { useTouchExpressionValues } from './useTouchExpressionValues'
import { useUnitSystem } from '../lib/units'
import { litersToUsGallons, usGallonsToLiters } from '../../../shared/units'
import './buttonbox.css'

const PANEL_BORDER = '#1f2733'
const TEXT_DIM = '#9aa6b2'
const TEXT_FG = '#f6fbff'

const CONTROL_KIND_LABELS: Record<TouchControlKind, string> = {
  momentary: 'Momentary push / hold',
  'latching-toggle': 'Latching toggle (ON / OFF)',
  'two-position-rocker': 'Two-position rocker',
  'guarded-two-step': 'Guarded two-step',
  rotary: 'Rotary encoder (− / + zones)',
  selector: 'Selector with choices',
  'status-led': 'Status / LED display (no action)',
  'value-tile': 'Safe value tile (no action)'
}

const SHAPE_LABELS: Record<ButtonShape, string> = {
  round: 'Round',
  square: 'Square',
  wide: 'Wide',
  pill: 'Pill',
  guarded: 'Guarded',
  rotary: 'Rotary',
  rocker: 'Rocker',
  'led-ring': 'LED ring',
  status: 'LED / status'
}
// Icon picker options grouped into <optgroup>s.
const ICON_GROUPS = ICON_OPTIONS.reduce<Array<{ group: string; items: Array<{ id: string; label: string; group: string }> }>>(
  (acc, o) => {
    const g = acc.find((x) => x.group === o.group)
    if (g) g.items.push(o)
    else acc.push({ group: o.group, items: [o] })
    return acc
  },
  []
)

const IRACING_COMMANDS: Array<{ value: IracingCommandName; group: IracingCommandGroup; label: string }> = [
  { value: 'pit:addFuel', group: 'pit', label: 'Pit ? Add fuel' },
  { value: 'pit:clearFuel', group: 'pit', label: 'Pit ? Cancel fuel' },
  { value: 'pit:toggleTyreLf', group: 'pit', label: `Pit · Tire ${TYRE_CORNER_LABELS['pit:toggleTyreLf']}` },
  { value: 'pit:toggleTyreRf', group: 'pit', label: `Pit · Tire ${TYRE_CORNER_LABELS['pit:toggleTyreRf']}` },
  { value: 'pit:toggleTyreLr', group: 'pit', label: `Pit · Tire ${TYRE_CORNER_LABELS['pit:toggleTyreLr']}` },
  { value: 'pit:toggleTyreRr', group: 'pit', label: `Pit · Tire ${TYRE_CORNER_LABELS['pit:toggleTyreRr']}` },
  { value: 'pit:fastRepair', group: 'pit', label: 'Pit · Fast Repair' },
  { value: 'pit:clearAll', group: 'pit', label: 'Pit · Limpar tudo' },
  { value: 'camera:next', group: 'camera', label: 'Camera ? Next' },
  { value: 'camera:previous', group: 'camera', label: 'Camera ? Previous' },
  { value: 'blackBox:next', group: 'blackBox', label: 'Black Box ? Next' },
  { value: 'blackBox:previous', group: 'blackBox', label: 'Black Box ? Previous' }
]

const KEYBOARD_MODE_HINTS: Record<KeyboardMacroCommand['mode'], string> = {
  press: 'One key or combination, fired once. Example: p',
  chord: 'All keys together (shortcut). Example: ctrl, shift, r',
  sequence: 'Keys in order, one after another. Example: g, g, 1',
  hold: 'Keeps key(s) pressed while active. Example: shift',
  toggle: 'Toggles on/off on each tap. Example: h',
  repeat: 'Repeats key(s) while pressed. Example: arrow up'
}

// Longest edge (px) an uploaded key face is downscaled to before encoding. Keeps a
// crisp face at 7" panel density while shrinking multi-MB photos toward the byte cap.
const IMAGE_MAX_DIM = 512

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })
}

/**
 * Read an uploaded image file into a data URL, downscaling (canvas resize + JPEG
 * re-encode) when it exceeds {@link IMAGE_MAX_BYTES}. Prevents bloated panel JSON /
 * laggy IPC from a 5 MB phone photo dropped onto a single key. Falls back to the
 * original data URL if canvas/decoding is unavailable.
 */
async function prepareButtonImage(file: File): Promise<string> {
  const original = await readFileAsDataUrl(file)
  if (!original) return ''
  if (isDataUrlWithinLimit(original)) return original
  try {
    if (typeof document === 'undefined') return original
    const img = await loadImage(original)
    let width = img.naturalWidth || img.width
    let height = img.naturalHeight || img.height
    if (!width || !height) return original
    const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(width, height))
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
    let lastOut = original
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return lastOut
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      const quality = Math.max(0.4, 0.85 - attempt * 0.1)
      lastOut = canvas.toDataURL('image/jpeg', quality)
      if (isDataUrlWithinLimit(lastOut)) return lastOut
      width = Math.max(1, Math.round(width * 0.8))
      height = Math.max(1, Math.round(height * 0.8))
    }
    return lastOut
  } catch {
    return original
  }
}

const APP_ACTIONS: Array<{ value: AppActionName; label: string }> = [
  { value: 'dash:cycleNext', label: 'Dashboard ? next (playlist)' },
  { value: 'dash:cyclePrev', label: 'Dashboard ? previous (playlist)' },
  { value: 'overlays:toggle', label: 'Overlays · alternar' },
  { value: 'oled:setActivePage', label: 'OLED ? active page' }
]

function field(): CSSProperties {
  return {
    width: '100%',
    background: '#0b0e13',
    color: TEXT_FG,
    border: `1px solid ${PANEL_BORDER}`,
    borderRadius: 8,
    padding: '8px 10px',
    minHeight: 44,
    fontSize: 13
  }
}

function label(): CSSProperties {
  return { display: 'block', color: TEXT_DIM, fontSize: 12, marginBottom: 4, fontWeight: 600 }
}

function row(): CSSProperties {
  return { display: 'grid', gap: 10, marginBottom: 12 }
}

export interface ButtonBoxEditorProps {
  panel: ButtonBoxPanel
  selectedId: string | null
  onChange: (panel: ButtonBoxPanel) => void
  onSelect: (id: string | null) => void
}

export function ButtonBoxEditor({ panel, selectedId, onChange, onSelect }: ButtonBoxEditorProps): ReactElement {
  const selected = useMemo(
    () => panel.buttons.find((b) => b.id === selectedId) ?? null,
    [panel.buttons, selectedId]
  )
  const [previewInteractive, setPreviewInteractive] = useState(false)
  const [previewMessage, setPreviewMessage] = useState('')
  const [expressions, setExpressions] = useState<ExpressionDef[]>([])
  const expressionValues = useTouchExpressionValues(panel.buttons)

  useEffect(() => {
    let alive = true
    void window.ipc
      .invoke<ExpressionDef[]>(EXPR_CHANNELS.getExpressions)
      .then((items) => {
        if (alive && Array.isArray(items)) setExpressions(items)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const patchPanel = useCallback(
    (patch: Partial<ButtonBoxPanel>) => onChange({ ...panel, ...patch, updatedAt: Date.now() }),
    [onChange, panel]
  )

  const patchButton = useCallback(
    (id: string, patch: Partial<ButtonBoxButton>) => {
      patchPanel({
        buttons: panel.buttons.map((b) => (b.id === id ? { ...b, ...patch } : b))
      })
    },
    [panel.buttons, patchPanel]
  )

  const addButton = useCallback(() => {
    if (panel.rows >= PANEL_MAX_ROWS) return
    const previousLength = panel.buttons.length
    const rows = panel.rows + 1
    const buttons = resizePanelButtons(panel.buttons, panel.columns * rows)
    const next = buttons[previousLength]
    patchPanel({ rows, buttons })
    onSelect(next?.id ?? null)
  }, [onSelect, panel.buttons, panel.columns, panel.rows, patchPanel])

  // Changing columns/rows must grow/shrink the actual button cells so the grid
  // stays a full columns*rows matrix (empty cells seed as editable placeholders).
  const setColumns = useCallback(
    (value: number) => {
      const columns = clampColumns(value)
      patchPanel({ columns, buttons: resizePanelButtons(panel.buttons, columns * panel.rows) })
    },
    [panel.buttons, panel.rows, patchPanel]
  )

  const setRows = useCallback(
    (value: number) => {
      const rows = clampRows(value)
      patchPanel({ rows, buttons: resizePanelButtons(panel.buttons, panel.columns * rows) })
    },
    [panel.buttons, panel.columns, patchPanel]
  )

  const removeSelected = useCallback(() => {
    if (!selected) return
    const index = panel.buttons.findIndex((button) => button.id === selected.id)
    if (index < 0) return
    const replacement = createButtonBoxButton({ label: '', control: { kind: 'value-tile', value: '' }, shape: 'square' }, index)
    patchPanel({ buttons: panel.buttons.map((button, buttonIndex) => (buttonIndex === index ? replacement : button)) })
    onSelect(replacement.id)
  }, [onSelect, panel.buttons, patchPanel, selected])

  const onImage = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selected) return
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
        setPreviewMessage('Only PNG, JPEG, WebP, and GIF button images are allowed.')
        return
      }
      const id = selected.id
      void prepareButtonImage(file)
        .then((dataUrl) => {
          const safe = safeImage(dataUrl)
          if (safe) patchButton(id, { image: safe })
          else setPreviewMessage('Image could not be reduced to the safe inline size.')
        })
        .catch(() => undefined)
    },
    [patchButton, selected]
  )


  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ color: TEXT_DIM, fontSize: 12 }}>
            {previewInteractive ? 'Preview mode: controls behave normally but actions are not sent.' : 'Select a control to edit.'}
          </span>
          <button
            type="button"
            style={{ ...field(), width: 'auto' }}
            aria-pressed={previewInteractive}
            onClick={() => {
              setPreviewInteractive((current) => !current)
              setPreviewMessage('')
            }}
          >
            {previewInteractive ? 'Exit preview' : 'Interact with preview'}
          </button>
          <button
            type="button"
            style={{ ...field(), width: 'auto' }}
            onClick={addButton}
            disabled={panel.rows >= PANEL_MAX_ROWS}
            title="Add one complete grid row"
          >
            ＋ Add row
          </button>
        </div>
        <div
          style={{
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 14,
            overflow: 'hidden',
            height: 360,
            background: panel.background
          }}
        >
          <ButtonBoxRenderer
            panel={panel}
            selectedId={selectedId}
            expressionValues={expressionValues}
            onSelect={previewInteractive ? undefined : (button) => onSelect(button.id)}
            onAction={
              previewInteractive
                ? (event) => {
                    const message = `${event.button.label || 'Control'} · ${event.zone} · ${event.phase} · ${describeButtonAction(event.action)}`
                    setPreviewMessage(message)
                    return { ok: true, message }
                  }
                : undefined
            }
            onFeedback={(next) => setPreviewMessage(next.message ?? (next.pending ? 'Preview action pending…' : ''))}
          />
        </div>
        <div role="status" aria-live="polite" style={{ minHeight: 22, color: TEXT_DIM, fontSize: 12, marginTop: 6 }}>
          {previewMessage}
        </div>

        <div style={{ ...row(), gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 14 }}>
          <div>
            <label style={label()}>Panel name</label>
            <input aria-label="Panel name" style={field()} value={panel.name} onChange={(e) => patchPanel({ name: e.target.value })} />
          </div>
          <div>
            <label style={label()}>Background color</label>
            <input
              type="color"
              style={{ ...field(), height: 36, padding: 2 }}
              value={panel.background}
              onChange={(e) => patchPanel({ background: e.target.value })}
            />
          </div>
          <div>
            <label style={label()}>Columns ({PANEL_MIN_COLUMNS}–{PANEL_MAX_COLUMNS})</label>
            <input
              type="number"
              min={PANEL_MIN_COLUMNS}
              max={PANEL_MAX_COLUMNS}
              style={field()}
              value={panel.columns}
              onChange={(e) => setColumns(Number(e.target.value))}
            />
          </div>
          <div>
            <label style={label()}>Rows ({PANEL_MIN_ROWS}–{PANEL_MAX_ROWS})</label>
            <input
              type="number"
              min={PANEL_MIN_ROWS}
              max={PANEL_MAX_ROWS}
              style={field()}
              value={panel.rows}
              onChange={(e) => setRows(Number(e.target.value))}
            />
          </div>
          <div>
            <label style={label()}>Spacing ({PANEL_MIN_GAP}–{PANEL_MAX_GAP}px)</label>
            <input
              type="number"
              min={PANEL_MIN_GAP}
              max={PANEL_MAX_GAP}
              style={field()}
              value={panel.gap}
              onChange={(e) => patchPanel({ gap: clampGap(Number(e.target.value)) })}
            />
          </div>          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label()}>Tags (comma separated)</label>
            <input
              style={field()}
              aria-label="Panel tags"
              value={(panel.tags ?? []).join(', ')}
              onChange={(event) =>
                patchPanel({
                  tags: event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                    .slice(0, 24)
                })
              }
              placeholder="race, pit, endurance"
            />
          </div>
        </div>
      </div>

      <div style={{ border: `1px solid ${PANEL_BORDER}`, borderRadius: 14, padding: 14, background: '#0e1116' }}>
        <strong style={{ color: TEXT_FG, fontSize: 14 }}>Key inspector</strong>
        {!selected ? (
          <p style={{ color: TEXT_DIM, fontSize: 13, marginTop: 12 }}>Select a key in the grid to edit color, text, image, and action.</p>
        ) : (
          <div style={{ marginTop: 12 }}>
            <div style={row()}>
              <div>
                <label style={label()}>Text</label>
                <input style={field()} value={selected.label} onChange={(e) => patchButton(selected.id, { label: e.target.value })} />
              </div>
            </div>
            <div style={{ ...row(), gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <div>
                <label style={label()}>Control semantics</label>
                <select
                  style={field()}
                  aria-label="Control semantics"
                  value={selected.control.kind}
                  onChange={(event) =>
                    patchButton(selected.id, {
                      control: createTouchControl(
                        event.target.value as TouchControlKind,
                        primaryButtonAction(selected.control)
                      )
                    })
                  }
                >
                  {TOUCH_CONTROL_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{CONTROL_KIND_LABELS[kind]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={label()}>Button shape</label>
                <select
                  style={field()}
                  aria-label="Button shape"
                  value={selected.shape}
                  onChange={(event) => patchButton(selected.id, { shape: event.target.value as ButtonShape })}
                >
                  {BUTTON_SHAPES.map((shape) => (
                    <option key={shape} value={shape}>{SHAPE_LABELS[shape]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ ...row(), gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <div>
                <label style={label()}>Visual family</label>
                <select
                  style={field()}
                  aria-label="Visual family"
                  value={selected.material}
                  onChange={(e) => patchButton(selected.id, { material: e.target.value as KeyMaterial })}
                >
                  {MATERIAL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={label()}>Icon</label>
                <select
                  style={field()}
                  aria-label="Control icon"
                  value={selected.icon ?? ''}
                  onChange={(e) => patchButton(selected.id, { icon: e.target.value || undefined })}
                >
                  <option value="">No icon</option>
                  {ICON_GROUPS.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((it) => (
                        <option key={it.id} value={it.id}>{it.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ ...row(), gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <div>
                <label style={label()}>Body color</label>
                <input type="color" style={{ ...field(), height: 36, padding: 2 }} value={selected.bodyColor} onChange={(e) => patchButton(selected.id, { bodyColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Text color</label>
                <input type="color" style={{ ...field(), height: 36, padding: 2 }} value={selected.textColor} onChange={(e) => patchButton(selected.id, { textColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Border color</label>
                <input type="color" style={{ ...field(), height: 36, padding: 2 }} value={selected.borderColor} onChange={(e) => patchButton(selected.id, { borderColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Border ({BUTTON_MIN_BORDER}–{BUTTON_MAX_BORDER}px)</label>
                <input type="number" min={BUTTON_MIN_BORDER} max={BUTTON_MAX_BORDER} style={field()} value={selected.borderWidth} onChange={(e) => patchButton(selected.id, { borderWidth: clampBorderWidth(Number(e.target.value)) })} />
              </div>
              <div>
                <label style={label()}>Font ({BUTTON_MIN_FONT}–{BUTTON_MAX_FONT}px)</label>
                <input type="number" min={BUTTON_MIN_FONT} max={BUTTON_MAX_FONT} style={field()} value={selected.fontSize} onChange={(e) => patchButton(selected.id, { fontSize: clampFontSize(Number(e.target.value)) })} />
              </div>
              <div>
                <label style={label()}>Active body</label>
                <input type="color" style={{ ...field(), height: 44, padding: 2 }} value={selected.activeColor ?? selected.bodyColor} onChange={(e) => patchButton(selected.id, { activeColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Active text</label>
                <input type="color" style={{ ...field(), height: 44, padding: 2 }} value={selected.activeTextColor ?? selected.textColor} onChange={(e) => patchButton(selected.id, { activeTextColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Pressed body</label>
                <input type="color" style={{ ...field(), height: 44, padding: 2 }} value={selected.pressedColor ?? selected.activeColor ?? selected.bodyColor} onChange={(e) => patchButton(selected.id, { pressedColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Pressed text</label>
                <input type="color" style={{ ...field(), height: 44, padding: 2 }} value={selected.pressedTextColor ?? selected.activeTextColor ?? selected.textColor} onChange={(e) => patchButton(selected.id, { pressedTextColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Disabled body</label>
                <input type="color" style={{ ...field(), height: 44, padding: 2 }} value={selected.disabledColor ?? '#252b34'} onChange={(e) => patchButton(selected.id, { disabledColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Disabled text</label>
                <input type="color" style={{ ...field(), height: 44, padding: 2 }} value={selected.disabledTextColor ?? '#9ca3af'} onChange={(e) => patchButton(selected.id, { disabledTextColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Warning body</label>
                <input type="color" style={{ ...field(), height: 44, padding: 2 }} value={selected.warningColor ?? '#7f1d1d'} onChange={(e) => patchButton(selected.id, { warningColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Warning text</label>
                <input type="color" style={{ ...field(), height: 44, padding: 2 }} value={selected.warningTextColor ?? '#ffffff'} onChange={(e) => patchButton(selected.id, { warningTextColor: e.target.value })} />
              </div>
            </div>

            <div style={row()}>
              <label style={label()}>Key image</label>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ ...field(), padding: 6 }} onChange={onImage} />
              <span style={{ color: TEXT_DIM, fontSize: 11 }}>
                Large images are reduced automatically (máx. ~{Math.round(IMAGE_MAX_BYTES / 1000)} KB).
              </span>
              {selected.image ? (
                <button type="button" style={field()} onClick={() => patchButton(selected.id, { image: undefined })}>Remove image</button>
              ) : null}
            </div>

            <ControlEditor
              control={selected.control}
              onChange={(control) => patchButton(selected.id, { control })}
            />
            <StateBindingEditor
              state={selected.state}
              bindings={selected.stateBindings}
              expressions={expressions}
              onStateChange={(state) => patchButton(selected.id, { state })}
              onBindingsChange={(stateBindings) => patchButton(selected.id, { stateBindings })}
            />

            <button
              type="button"
              style={{ ...field(), marginTop: 8, borderColor: '#7f1d1d', color: '#fca5a5' }}
              onClick={removeSelected}
            >
              Clear control cell
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function RepeatEditor({
  repeat,
  onChange
}: {
  repeat: TouchRepeatConfig | undefined
  onChange: (repeat: TouchRepeatConfig | undefined) => void
}): ReactElement {
  return (
    <div style={{ ...row(), gridTemplateColumns: '1fr 1fr' }}>
      <label style={{ ...label(), gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={Boolean(repeat)}
          onChange={(event) => onChange(event.target.checked ? { delayMs: 420, intervalMs: 120 } : undefined)}
        />
        Repeat while held
      </label>
      {repeat ? (
        <>
          <label style={label()}>
            Delay ms
            <input
              type="number"
              min={50}
              max={2000}
              style={field()}
              value={repeat.delayMs}
              onChange={(event) => onChange({ ...repeat, delayMs: Math.max(50, Math.min(2000, Number(event.target.value) || 420)) })}
            />
          </label>
          <label style={label()}>
            Interval ms
            <input
              type="number"
              min={50}
              max={2000}
              style={field()}
              value={repeat.intervalMs}
              onChange={(event) => onChange({ ...repeat, intervalMs: Math.max(50, Math.min(2000, Number(event.target.value) || 120)) })}
            />
          </label>
        </>
      ) : null}
    </div>
  )
}

function ControlEditor({ control, onChange }: { control: TouchControl; onChange: (control: TouchControl) => void }): ReactElement {
  return (
    <div style={{ borderTop: `1px solid ${PANEL_BORDER}`, paddingTop: 12, marginTop: 8 }}>
      <strong style={{ color: TEXT_FG, fontSize: 13 }}>Behavior · {CONTROL_KIND_LABELS[control.kind]}</strong>
      {control.kind === 'momentary' ? (
        <>
          <ActionEditor title="Action on press" action={control.action} onChange={(action) => onChange({ ...control, action })} />
          <RepeatEditor repeat={control.repeat} onChange={(repeat) => onChange({ ...control, repeat })} />
        </>
      ) : null}
      {control.kind === 'latching-toggle' ? (
        <>
          <ActionEditor title="Action when switched ON" action={control.onAction} onChange={(onAction) => onChange({ ...control, onAction })} />
          <ActionEditor title="Action when switched OFF" action={control.offAction} onChange={(offAction) => onChange({ ...control, offAction })} />
        </>
      ) : null}
      {control.kind === 'two-position-rocker' ? (
        <>
          <div style={{ ...row(), gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
            <label style={label()}>
              Negative label
              <input style={field()} value={control.negativeLabel} onChange={(event) => onChange({ ...control, negativeLabel: event.target.value })} />
            </label>
            <label style={label()}>
              Positive label
              <input style={field()} value={control.positiveLabel} onChange={(event) => onChange({ ...control, positiveLabel: event.target.value })} />
            </label>
          </div>
          <ActionEditor title="Negative / left action" action={control.negativeAction} onChange={(negativeAction) => onChange({ ...control, negativeAction })} />
          <ActionEditor title="Positive / right action" action={control.positiveAction} onChange={(positiveAction) => onChange({ ...control, positiveAction })} />
          <RepeatEditor repeat={control.repeat} onChange={(repeat) => onChange({ ...control, repeat })} />
        </>
      ) : null}
      {control.kind === 'guarded-two-step' ? (
        <>
          <label style={{ ...label(), marginTop: 10 }}>
            Guard auto-close (ms)
            <input
              type="number"
              min={1000}
              max={15000}
              style={field()}
              value={control.armTimeoutMs}
              onChange={(event) => onChange({ ...control, armTimeoutMs: Math.max(1000, Math.min(15000, Number(event.target.value) || 4000)) })}
            />
          </label>
          <p style={{ color: TEXT_DIM, fontSize: 11 }}>First activation only opens the guard. The action can run only on a second activation.</p>
          <ActionEditor title="Guarded action" action={control.action} onChange={(action) => onChange({ ...control, action })} />
        </>
      ) : null}
      {control.kind === 'rotary' ? (
        <>
          <div style={{ ...row(), gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
            <label style={label()}>
              Decrement label
              <input style={field()} value={control.decrementLabel} onChange={(event) => onChange({ ...control, decrementLabel: event.target.value })} />
            </label>
            <label style={label()}>
              Increment label
              <input style={field()} value={control.incrementLabel} onChange={(event) => onChange({ ...control, incrementLabel: event.target.value })} />
            </label>
          </div>
          <ActionEditor title="Decrement action" action={control.decrementAction} onChange={(decrementAction) => onChange({ ...control, decrementAction })} />
          <ActionEditor title="Increment action" action={control.incrementAction} onChange={(incrementAction) => onChange({ ...control, incrementAction })} />
          <RepeatEditor repeat={control.repeat} onChange={(repeat) => onChange({ ...control, repeat: repeat ?? { delayMs: 420, intervalMs: 120 } })} />
        </>
      ) : null}
      {control.kind === 'selector' ? (
        <div style={{ marginTop: 10 }}>
          <label style={label()}>
            Initial choice
            <select style={field()} value={control.initialChoiceId} onChange={(event) => onChange({ ...control, initialChoiceId: event.target.value })}>
              {control.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
          </label>
          {control.choices.map((choice, index) => (
            <div key={choice.id} style={{ border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: 8, marginTop: 8 }}>
              <div style={{ ...row(), gridTemplateColumns: '1fr 1fr' }}>
                <label style={label()}>
                  Choice label
                  <input
                    style={field()}
                    value={choice.label}
                    onChange={(event) => onChange({ ...control, choices: control.choices.map((item) => item.id === choice.id ? { ...item, label: event.target.value } : item) })}
                  />
                </label>
                <label style={label()}>
                  Value
                  <input
                    style={field()}
                    value={choice.value}
                    onChange={(event) => onChange({ ...control, choices: control.choices.map((item) => item.id === choice.id ? { ...item, value: event.target.value } : item) })}
                  />
                </label>
              </div>
              <ActionEditor
                title={`Choice ${index + 1} action`}
                action={choice.action}
                onChange={(action) => onChange({ ...control, choices: control.choices.map((item) => item.id === choice.id ? { ...item, action } : item) })}
              />
              <button
                type="button"
                style={{ ...field(), borderColor: '#7f1d1d', color: '#fca5a5' }}
                disabled={control.choices.length <= 2}
                onClick={() => {
                  const choices = control.choices.filter((item) => item.id !== choice.id)
                  onChange({ ...control, choices, initialChoiceId: choices.some((item) => item.id === control.initialChoiceId) ? control.initialChoiceId : choices[0].id })
                }}
              >
                Remove choice
              </button>
            </div>
          ))}
          <button
            type="button"
            style={{ ...field(), marginTop: 8 }}
            disabled={control.choices.length >= 12}
            onClick={() => {
              let suffix = control.choices.length + 1
              while (control.choices.some((choice) => choice.id === `choice-${suffix}`)) suffix += 1
              onChange({
                ...control,
                choices: [
                  ...control.choices,
                  { id: `choice-${suffix}`, label: `${suffix}`, value: `${suffix}`, action: { kind: 'none' } }
                ]
              })
            }}
          >
            Add selector choice
          </button>
        </div>
      ) : null}
      {control.kind === 'status-led' ? (
        <label style={{ ...label(), marginTop: 10 }}>
          Fallback status text
          <input style={field()} value={control.value} onChange={(event) => onChange({ ...control, value: event.target.value })} />
        </label>
      ) : null}
      {control.kind === 'value-tile' ? (
        <div style={{ ...row(), gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
          <label style={label()}>
            Fallback value
            <input style={field()} value={control.value} onChange={(event) => onChange({ ...control, value: event.target.value })} />
          </label>
          <label style={label()}>
            Unit
            <input style={field()} value={control.unit ?? ''} onChange={(event) => onChange({ ...control, unit: event.target.value || undefined })} />
          </label>
        </div>
      ) : null}
    </div>
  )
}

const STATE_DESTINATION_LABELS = {
  active: 'Active',
  pressed: 'Pressed',
  disabled: 'Disabled',
  warning: 'Warning',
  value: 'Value'
} as const

function StateBindingEditor({
  state,
  bindings,
  expressions,
  onStateChange,
  onBindingsChange
}: {
  state: TouchControlStateDefaults | undefined
  bindings: TouchControlStateBindings | undefined
  expressions: ExpressionDef[]
  onStateChange: (state: TouchControlStateDefaults | undefined) => void
  onBindingsChange: (bindings: TouchControlStateBindings | undefined) => void
}): ReactElement {
  const setBoolean = (key: 'active' | 'pressed' | 'disabled' | 'warning', value: boolean): void => {
    onStateChange({ ...(state ?? {}), [key]: value })
  }
  return (
    <div style={{ borderTop: `1px solid ${PANEL_BORDER}`, paddingTop: 12, marginTop: 12 }}>
      <strong style={{ color: TEXT_FG, fontSize: 13 }}>State defaults and expression hooks</strong>
      <p style={{ color: TEXT_DIM, fontSize: 11 }}>
        Bindings reference the existing expression engine by id; this panel does not store or evaluate formulas.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        {(['active', 'pressed', 'disabled', 'warning'] as const).map((destination) => (
          <label key={destination} style={{ color: TEXT_DIM, minHeight: 44, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={Boolean(state?.[destination])} onChange={(event) => setBoolean(destination, event.target.checked)} />
            {STATE_DESTINATION_LABELS[destination]}
          </label>
        ))}
      </div>
      <label style={label()}>
        Fallback value
        <input style={field()} value={state?.value === null || state?.value === undefined ? '' : String(state.value)} onChange={(event) => onStateChange({ ...(state ?? {}), value: event.target.value })} />
      </label>
      {TOUCH_CONTROL_STATE_DESTINATIONS.map((destination) => {
        const current = bindings?.[destination]?.expressionId ?? ''
        const hasCurrent = current && !expressions.some((expression) => expression.id === current)
        return (
          <label key={destination} style={{ ...label(), marginTop: 8 }}>
            {STATE_DESTINATION_LABELS[destination]} expression
            <select
              style={field()}
              value={current}
              onChange={(event) => {
                const next: TouchControlStateBindings = { ...(bindings ?? {}) }
                if (event.target.value) next[destination] = { source: 'expression', expressionId: event.target.value }
                else delete next[destination]
                onBindingsChange(Object.keys(next).length > 0 ? next : undefined)
              }}
            >
              <option value="">No binding</option>
              {hasCurrent ? <option value={current}>{current} (unavailable)</option> : null}
              {expressions.map((expression) => <option key={expression.id} value={expression.id}>{expression.name}</option>)}
            </select>
          </label>
        )
      })}
    </div>
  )
}
function ActionEditor({ action, onChange, title = 'Action' }: { action: ButtonAction; onChange: (action: ButtonAction) => void; title?: string }): ReactElement {
  const unitSystem = useUnitSystem()
  const setKind = (kind: ButtonAction['kind']): void => {
    switch (kind) {
      case 'none':
        onChange({ kind: 'none' })
        return
      case 'iracing':
        onChange({ kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 0 } })
        return
      case 'keyboard':
        onChange({ kind: 'keyboard', command: { mode: 'press', keys: [] } })
        return
      case 'app':
        onChange({ kind: 'app', command: { name: 'dash:cycleNext' } })
        return
    }
  }

  return (
    <div style={{ ...row(), borderTop: `1px solid ${PANEL_BORDER}`, paddingTop: 12 }}>
      <label style={label()}>{title}</label>
      <select style={field()} value={action.kind} onChange={(e) => setKind(e.target.value as ButtonAction['kind'])}>
        <option value="none">No action</option>
        <option value="iracing">iRacing command</option>
        <option value="keyboard">Keyboard shortcut</option>
        <option value="app">App action</option>
      </select>

      {action.kind === 'iracing' ? (
        <>
          <select
            style={field()}
            value={action.command.name}
            onChange={(e) => {
              const found = IRACING_COMMANDS.find((c) => c.value === (e.target.value as IracingCommandName))
              if (found) onChange({ kind: 'iracing', command: { group: found.group, name: found.value, fuelLiters: action.command.fuelLiters } })
            }}
          >
            {IRACING_COMMANDS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          {action.command.name === 'pit:addFuel' ? (
            <input
              type="number"
              min={0}
              step={unitSystem === 'imperial' ? 0.1 : 1}
              style={field()}
              placeholder={unitSystem === 'imperial' ? 'US gal' : 'Liters'}
              value={unitSystem === 'imperial' ? Number((litersToUsGallons(action.command.fuelLiters ?? 0) ?? 0).toFixed(2)) : action.command.fuelLiters ?? 0}
              onChange={(e) => {
                const displayValue = Math.max(0, Number(e.target.value) || 0)
                const fuelLiters = unitSystem === 'imperial' ? usGallonsToLiters(displayValue) ?? 0 : displayValue
                onChange({ kind: 'iracing', command: { ...action.command, fuelLiters } })
              }}
            />
          ) : null}
        </>
      ) : null}

      {action.kind === 'keyboard' ? (
        <KeyboardEditor command={action.command} onChange={(command) => onChange({ kind: 'keyboard', command })} />
      ) : null}

      {action.kind === 'app' ? (
        <>
          <select
            style={field()}
            value={action.command.name}
            onChange={(e) => onChange({ kind: 'app', command: { ...action.command, name: e.target.value as AppActionName } })}
          >
            {APP_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          {action.command.name === 'oled:setActivePage' ? (
            <input
              type="number"
              min={0}
              style={field()}
              placeholder="Page index (0 = first)"
              value={action.command.pageIndex ?? 0}
              onChange={(e) =>
                onChange({
                  kind: 'app',
                  command: { ...action.command, pageIndex: Math.max(0, Math.round(Number(e.target.value) || 0)) }
                })
              }
            />
          ) : null}
          {action.command.name === 'overlays:toggle' ? (
            <select
              style={field()}
              value={action.command.overlayId ?? 'relative'}
              onChange={(e) => onChange({ kind: 'app', command: { ...action.command, overlayId: e.target.value } })}
            >
              {OVERLAY_WIDGETS.map((w) => (
                <option key={w.id} value={w.id}>{overlayWidgetDisplayTitle(w)}</option>
              ))}
            </select>
          ) : null}
        </>
      ) : null}

      <span style={{ color: TEXT_DIM, fontSize: 12 }}>{describeButtonAction(action)}</span>
    </div>
  )
}

function KeyboardEditor({ command, onChange }: { command: KeyboardMacroCommand; onChange: (command: KeyboardMacroCommand) => void }): ReactElement {
  return (
    <>
      <select style={field()} value={command.mode} onChange={(e) => onChange({ ...command, mode: e.target.value as KeyboardMacroCommand['mode'] })}>
        <option value="press">Press</option>
        <option value="chord">Combination (chord)</option>
        <option value="sequence">Sequence</option>
        <option value="hold">Hold</option>
        <option value="toggle">Toggle</option>
        <option value="repeat">Repeat</option>
      </select>
      <input
        style={field()}
        placeholder="Ex.: ctrl, shift, p"
        value={command.keys.join(', ')}
        onChange={(e) => onChange({ ...command, keys: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })}
      />
      <span style={{ color: TEXT_DIM, fontSize: 12 }}>{KEYBOARD_MODE_HINTS[command.mode]}</span>
    </>
  )
}
