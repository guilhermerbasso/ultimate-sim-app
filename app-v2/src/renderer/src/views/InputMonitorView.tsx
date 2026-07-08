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
          <h3>SIM-X input monitor</h3>
        </div>
        <span className="muted-pill">{TOTAL_HID_BUTTONS} HID + POV + {ENCODER_COUNT} encoders</span>
      </div>

      <div className="gamepad-picker">
        <label className="field-label" htmlFor="gamepad">Selected gamepad</label>
        <select
          className="select-field wide"
          disabled={gamepads.length === 0}
          id="gamepad"
          onChange={(event) => setSelectedIndex(Number(event.target.value))}
          value={selectedIndex ?? ''}
        >
          {gamepads.length === 0 && <option value="">No gamepad detected</option>}
          {gamepads.map((gamepad) => (
            <option key={gamepad.index} value={gamepad.index}>
              {gamepad.index} · {gamepad.id}
            </option>
          ))}
        </select>
        <p className="helper-text">
          {selectedGamepad
            ? `${selectedGamepad.id}. Press a button if the browser has not detected the HID yet.`
            : 'Connect SIM-X and press any button so Chromium recognizes the HID.'}
        </p>
      </div>

      <div className="input-grid" aria-label="Estado dos 32 HID buttons">
        {buttons.map((pressed, index) => (
          <div className={`input-cell ${pressed ? 'is-pressed' : ''}`} key={index + 1}>
            <span>{String(index + 1).padStart(2, '0')}</span>
          </div>
        ))}
      </div>

      <div className="divider" />
      <span className="panel-label">POV hat (D-pad)</span>
      <div className="input-grid" aria-label="POV hat state">
        {HAT_DIRECTIONS.map((arrow, index) => (
          <div className={`input-cell ${hat[index] ? 'is-pressed' : ''}`} key={arrow}>
            <span>{arrow}</span>
          </div>
        ))}
      </div>

      <div className="divider" />
      <span className="panel-label">Encoders (via serial)</span>
      <p className="helper-text">
        Encoders arrive over serial as <code>E&lt;idx&gt;:+1</code> or <code>E&lt;idx&gt;:-1</code> and are not shown in HID.
        Connect the ButtonBox in Devices to receive the events below.
      </p>
      <div className="status-list" aria-label="Last encoder events">
        {encoderTraces.length === 0 ? (
          <p className="helper-text">Waiting for encoder events?</p>
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
