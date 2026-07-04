import { type ReactElement, useEffect, useMemo, useState } from 'react'
import type { EncoderEvent } from '../../../shared/ipc'
import type { AppViewProps } from '../App'

const TOTAL_HID_BUTTONS = 32
const ENCODER_COUNT = 4

interface GamepadSnapshot {
  index: number
  id: string
}

interface EncoderTrace {
  index: number
  direction: 1 | -1
  at: number
}

const HAT_DIRECTIONS = ['↑', '→', '↓', '←'] as const
const POV_AXIS_DETENTS = [-1, -5 / 7, -3 / 7, -1 / 7, 1 / 7, 3 / 7, 5 / 7, 1] as const
const POV_AXIS_DETENT_TOLERANCE = 0.09

function listConnectedGamepads(): GamepadSnapshot[] {
  return navigator.getGamepads()
    .filter((gamepad): gamepad is Gamepad => Boolean(gamepad))
    .map((gamepad) => ({ index: gamepad.index, id: gamepad.id }))
}

/**
 * The POV hat lands either on buttons 12..15 (Chromium "standard" mapping)
 * or on axis 9 with values like -1, -0.71, -0.43… 0.71 (Windows DirectInput).
 * We support both so the SIM-X box works no matter which mapping Chromium
 * picks for the Arduino HID device.
 */
function readHat(gamepad: Gamepad | null): boolean[] {
  if (!gamepad) return [false, false, false, false]
  const direct = [
    Boolean(gamepad.buttons[12]?.pressed),
    Boolean(gamepad.buttons[15]?.pressed),
    Boolean(gamepad.buttons[13]?.pressed),
    Boolean(gamepad.buttons[14]?.pressed)
  ]
  if (direct.some(Boolean)) return direct
  const axis = gamepad.axes[9]
  if (typeof axis !== 'number' || axis < -1.1 || axis > 1.1) return [false, false, false, false]
  const normalized = POV_AXIS_DETENTS.findIndex((detent) => Math.abs(axis - detent) <= POV_AXIS_DETENT_TOLERANCE)
  switch (normalized) {
    case 0: return [true, false, false, false]
    case 1: return [true, true, false, false]
    case 2: return [false, true, false, false]
    case 3: return [false, true, true, false]
    case 4: return [false, false, true, false]
    case 5: return [false, false, true, true]
    case 6: return [false, false, false, true]
    case 7: return [true, false, false, true]
    default: return [false, false, false, false]
  }
}

function InputMonitorView(_props: AppViewProps): ReactElement {
  const [gamepads, setGamepads] = useState<GamepadSnapshot[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [buttons, setButtons] = useState<boolean[]>(() => Array.from({ length: TOTAL_HID_BUTTONS }, () => false))
  const [hat, setHat] = useState<boolean[]>([false, false, false, false])
  const [encoderTraces, setEncoderTraces] = useState<EncoderTrace[]>([])

  useEffect(() => {
    let frame = 0
    const refresh = (): void => {
      const connected = listConnectedGamepads()
      setGamepads(connected)
      setSelectedIndex((current) => {
        if (current !== null && connected.some((gamepad) => gamepad.index === current)) return current
        return connected[0]?.index ?? null
      })
      const selected = selectedIndex === null ? null : navigator.getGamepads()[selectedIndex]
      setButtons(Array.from({ length: TOTAL_HID_BUTTONS }, (_, index) => Boolean(selected?.buttons[index]?.pressed)))
      setHat(readHat(selected))
      frame = window.requestAnimationFrame(refresh)
    }
    frame = window.requestAnimationFrame(refresh)
    return () => window.cancelAnimationFrame(frame)
  }, [selectedIndex])

  useEffect(() => {
    const unsubscribe = window.api.onEncoder((event: EncoderEvent) => {
      setEncoderTraces((current) => {
        const next = [{ index: event.index, direction: event.direction, at: Date.now() }, ...current]
        return next.slice(0, 12)
      })
    })
    return unsubscribe
  }, [])

  const selectedGamepad = useMemo(
    () => gamepads.find((gamepad) => gamepad.index === selectedIndex) ?? null,
    [gamepads, selectedIndex]
  )

  return (
    <section className="panel-card full-height scroll-card">
      <div className="panel-heading-row">
        <div>
          <span className="panel-label">Web Gamepad API + serial</span>
          <h3>Monitor de entradas SIM-X</h3>
        </div>
        <span className="muted-pill">{TOTAL_HID_BUTTONS} HID + POV + {ENCODER_COUNT} encoders</span>
      </div>

      <div className="gamepad-picker">
        <label className="field-label" htmlFor="gamepad">Gamepad selecionado</label>
        <select
          className="select-field wide"
          disabled={gamepads.length === 0}
          id="gamepad"
          onChange={(event) => setSelectedIndex(Number(event.target.value))}
          value={selectedIndex ?? ''}
        >
          {gamepads.length === 0 && <option value="">Nenhum gamepad detectado</option>}
          {gamepads.map((gamepad) => (
            <option key={gamepad.index} value={gamepad.index}>
              {gamepad.index} · {gamepad.id}
            </option>
          ))}
        </select>
        <p className="helper-text">
          {selectedGamepad
            ? `${selectedGamepad.id}. Pressione um botão se o navegador ainda não detectou o HID.`
            : 'Conecte o SIM-X e pressione qualquer botão para o Chromium reconhecer o HID.'}
        </p>
      </div>

      <div className="input-grid" aria-label="Estado dos 32 botões HID">
        {buttons.map((pressed, index) => (
          <div className={`input-cell ${pressed ? 'is-pressed' : ''}`} key={index + 1}>
            <span>{String(index + 1).padStart(2, '0')}</span>
          </div>
        ))}
      </div>

      <div className="divider" />
      <span className="panel-label">POV hat (D-pad)</span>
      <div className="input-grid" aria-label="Estado do POV hat">
        {HAT_DIRECTIONS.map((arrow, index) => (
          <div className={`input-cell ${hat[index] ? 'is-pressed' : ''}`} key={arrow}>
            <span>{arrow}</span>
          </div>
        ))}
      </div>

      <div className="divider" />
      <span className="panel-label">Encoders (via serial)</span>
      <p className="helper-text">
        Encoders chegam pela serial como <code>E&lt;idx&gt;:+1</code> ou <code>E&lt;idx&gt;:-1</code> e não aparecem no HID.
        Conecte o ButtonBox em Dispositivos para receber os eventos abaixo.
      </p>
      <div className="status-list" aria-label="Últimos eventos de encoder">
        {encoderTraces.length === 0 ? (
          <p className="helper-text">Aguardando eventos de encoder…</p>
        ) : (
          encoderTraces.map((trace, index) => (
            <div className="status-dot" key={`${trace.at}-${index}`}>
              <strong>Encoder {trace.index}</strong>
              <span>{trace.direction > 0 ? '+1 (CW)' : '-1 (CCW)'}</span>
              <small>{new Date(trace.at).toLocaleTimeString()}</small>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export default InputMonitorView
