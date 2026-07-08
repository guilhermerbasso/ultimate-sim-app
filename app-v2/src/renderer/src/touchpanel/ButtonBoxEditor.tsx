import { useCallback, useMemo, type ChangeEvent, type CSSProperties, type ReactElement } from 'react'
import type {
  AppActionName,
  IracingCommandGroup,
  IracingCommandName,
  KeyboardMacroCommand
} from '../../../shared/actions'
import { OVERLAY_WIDGETS, overlayWidgetDisplayTitle } from '../../../shared/overlays'
import {
  BUTTON_MAX_BORDER,
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
  TYRE_CORNER_LABELS,
  clampBorderWidth,
  clampColumns,
  clampFontSize,
  clampGap,
  clampRows,
  createButtonBoxButton,
  describeButtonAction,
  isDataUrlWithinLimit,
  resizePanelButtons,
  type ButtonAction,
  type ButtonBoxButton,
  type ButtonBoxPanel,
  type KeyMaterial
} from '../../../shared/touch-panel'
import { ButtonBoxRenderer } from './ButtonBoxRenderer'
import { MATERIAL_OPTIONS } from './keyMaterials'
import { ICON_OPTIONS } from './icons'
import './buttonbox.css'

const PANEL_BORDER = '#1f2733'
const TEXT_DIM = '#9aa6b2'
const TEXT_FG = '#f6fbff'

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
    const next = createButtonBoxButton({}, panel.buttons.length)
    patchPanel({ buttons: [...panel.buttons, next] })
    onSelect(next.id)
  }, [onSelect, panel.buttons, patchPanel])

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
    patchPanel({ buttons: panel.buttons.filter((b) => b.id !== selected.id) })
    onSelect(null)
  }, [onSelect, panel.buttons, patchPanel, selected])

  const onImage = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!selected) return
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const id = selected.id
      void prepareButtonImage(file)
        .then((dataUrl) => {
          if (dataUrl) patchButton(id, { image: dataUrl })
        })
        .catch(() => undefined)
    },
    [patchButton, selected]
  )

  const setAction = useCallback(
    (action: ButtonAction) => {
      if (selected) patchButton(selected.id, { action })
    },
    [patchButton, selected]
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ color: TEXT_DIM, fontSize: 12 }}>Tap a key to edit.</span>
          <button type="button" style={field()} onClick={addButton} title="Add a new key">
            ＋ Adicionar tecla
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
          <ButtonBoxRenderer panel={panel} selectedId={selectedId} onSelect={(b) => onSelect(b.id)} />
        </div>

        <div style={{ ...row(), gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 14 }}>
          <div>
            <label style={label()}>Panel name</label>
            <input style={field()} value={panel.name} onChange={(e) => patchPanel({ name: e.target.value })} />
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
                <label style={label()}>Material</label>
                <select
                  style={field()}
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
                <label style={label()}>Press color</label>
                <input type="color" style={{ ...field(), height: 36, padding: 2 }} value={selected.activeColor ?? selected.bodyColor} onChange={(e) => patchButton(selected.id, { activeColor: e.target.value })} />
              </div>
              <div>
                <label style={label()}>Press text</label>
                <input type="color" style={{ ...field(), height: 36, padding: 2 }} value={selected.activeTextColor ?? selected.textColor} onChange={(e) => patchButton(selected.id, { activeTextColor: e.target.value })} />
              </div>
            </div>

            <div style={row()}>
              <label style={label()}>Key image</label>
              <input type="file" accept="image/*" style={{ ...field(), padding: 6 }} onChange={onImage} />
              <span style={{ color: TEXT_DIM, fontSize: 11 }}>
                Imagens grandes são reduzidas automaticamente (máx. ~{Math.round(IMAGE_MAX_BYTES / 1000)} KB).
              </span>
              {selected.image ? (
                <button type="button" style={field()} onClick={() => patchButton(selected.id, { image: undefined })}>Remove image</button>
              ) : null}
            </div>

            <ActionEditor action={selected.action} onChange={setAction} />

            <button
              type="button"
              style={{ ...field(), marginTop: 8, borderColor: '#7f1d1d', color: '#fca5a5' }}
              onClick={removeSelected}
            >
              Delete key
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ActionEditor({ action, onChange }: { action: ButtonAction; onChange: (action: ButtonAction) => void }): ReactElement {
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
      <label style={label()}>Action on press</label>
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
              style={field()}
              placeholder="Liters"
              value={action.command.fuelLiters ?? 0}
              onChange={(e) => onChange({ kind: 'iracing', command: { ...action.command, fuelLiters: Math.max(0, Number(e.target.value) || 0) } })}
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
