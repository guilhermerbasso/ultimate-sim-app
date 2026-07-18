import { describe, expect, it } from 'vitest'
import type { RgbMatrixComponent, RgbStripComponent, StartLedComponent } from '../../../shared/devices'
import { DEFAULT_REVLIGHTS_CONFIG } from '../../../shared/revlights'
import type { Flags, TelemetrySnapshot } from '../../../shared/telemetry'
import { matrixFrame, startLedOn, stripColors } from './render'

function snapshot(partial: Partial<TelemetrySnapshot>): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1,
    speedKmh: 0,
    rpm: 0,
    gear: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    ...partial
  }
}

function flags(partial: Partial<Flags>): Flags {
  return {
    green: false,
    yellow: false,
    blue: false,
    white: false,
    checkered: false,
    red: false,
    black: false,
    meatball: false,
    repair: false,
    disqualify: false,
    greenWhiteCheckered: false,
    ...partial
  }
}

const strip = {
  id: 'rev-strip',
  label: 'Rev strip',
  enabled: true,
  pins: {},
  type: 'rgbStrip',
  chip: 'ws2812',
  ledCount: 4,
  brightness: 255,
  mode: 'revlights',
  revlights: {
    ...DEFAULT_REVLIGHTS_CONFIG,
    enabled: true,
    ledCount: 4,
    shiftBlink: true,
    shiftRpmPct: 0.95,
    useShiftIndicatorPct: true,
    flagBlink: true
  },
  presetId: 'progressive',
  colorOrder: 'grb',
  gammaCorrection: false,
  refreshHz: 60,
  startupEffect: 'rev-gradient',
  testPattern: 'off',
  idleColor: '#000000',
  segments: []
} satisfies RgbStripComponent

const shiftLed = {
  id: 'shift-led',
  label: 'Shift',
  enabled: true,
  pins: {},
  type: 'startLed',
  trigger: 'shift',
  color: '#1f8dff',
  presetId: 'shift',
  offColor: '#000000',
  brightness: 255,
  blinkMode: 'steady',
  rules: []
} satisfies StartLedComponent

describe('hardware shift-now rendering', () => {
  it('never strobes for pct=.999 when provider blink is false', () => {
    const snap = snapshot({
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false }
    })

    expect(startLedOn(shiftLed, snap)).toBe(false)
    expect(stripColors(strip, snap, 0)).not.toEqual(new Array(4).fill('#1f8dff'))
  })

  it('strobes every LED strong blue for pct=.2 when provider blink is true', () => {
    const snap = snapshot({
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true }
    })

    const physicalStrip = {
      ...strip,
      ledCount: 7,
      revlights: { ...strip.revlights, ledCount: 4 }
    } satisfies RgbStripComponent

    expect(startLedOn(shiftLed, snap)).toBe(true)
    expect(stripColors(physicalStrip, snap, 0)).toEqual(new Array(7).fill('#1f8dff'))
    expect(stripColors(physicalStrip, snap, 90)).toEqual(new Array(7).fill('#000000'))
  })

  it('uses the percentage threshold only when blink is absent and preserves flags otherwise', () => {
    expect(startLedOn(shiftLed, snapshot({
      shiftIndicatorPct: 0.95,
      revLights: { pct: 0.95 }
    }))).toBe(true)

    expect(stripColors(strip, snapshot({
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false },
      flags: flags({ yellow: true })
    }), 0)).toEqual(new Array(4).fill(DEFAULT_REVLIGHTS_CONFIG.flagColors.yellow))
  })
})

describe('generic RGB matrix shift-now override', () => {
  const matrix = {
    id: 'iflag',
    label: 'iFlag',
    enabled: true,
    pins: {},
    type: 'rgbMatrix',
    chip: 'ws2812',
    width: 8,
    height: 8,
    brightness: 255,
    orientation: 0,
    serpentine: true,
    mode: 'iflag'
  } satisfies RgbMatrixComponent

  it('alternates every physical LED strong blue/off and supersedes flags', () => {
    const snap = snapshot({
      shiftIndicatorPct: 0.2,
      revLights: { pct: 0.2, blink: true },
      flags: flags({ yellow: true })
    })
    expect(matrixFrame(matrix, snap, 0).flat()).toEqual(new Array(64).fill('#1f8dff'))
    expect(matrixFrame(matrix, snap, 90).flat()).toEqual(new Array(64).fill('#000000'))
  })

  it('does not threshold-strobe when provider blink is explicitly false', () => {
    const frame = matrixFrame(matrix, snapshot({
      shiftIndicatorPct: 0.999,
      revLights: { pct: 0.999, blink: false },
      flags: flags({ yellow: true })
    }), 0)
    expect(new Set(frame.flat())).toEqual(new Set(['#ffcc00']))
  })
})
