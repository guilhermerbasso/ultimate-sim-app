// Per-component editors for the Hardware Hub. One sub-editor per `ComponentType`
// in the `devices.ts` discriminated union, plus a shared pinout editor driven by
// `findComponentType(type).requiredPins`. Every editor narrows on
// `component.type` and emits a fully-typed replacement component via `onChange`.

import type { ReactElement, ReactNode } from 'react'
import {
  type AlertRule,
  type BoardInfo,
  type BuzzerComponent,
  type ControlButtonAction,
  type ControlComponent,
  type CustomSerialComponent,
  type DeviceComponent,
  type EncoderMode,
  type GaugeComponent,
  type GaugeCurve,
  type GaugeSweepDirection,
  type RgbMatrixComponent,
  type RgbStripComponent,
  type RgbStripSegment,
  type ScreenComponent,
  type ScreenField,
  type ScreenPage,
  type ScreenRotation,
  type SegDisplayComponent,
  type SegLedMapping,
  type StartLedComponent,
  findComponentType
} from '../../../../shared/devices'
import {
  Field,
  MatrixPreview,
  NumberField,
  SelectField,
  Slider,
  StripPreview,
  TextField,
  Toggle
} from './controls'
import type { SelectOption } from './controls'
import { ACCENT, card, helper, label, pinSuggestions, buttonStyle } from './styles'
import type { ResolvedLanguage } from '../../i18n'
import { tt } from '../../i18n'

const twoCol = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 } as const
const threeCol = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 } as const
const compactCard = { ...card, display: 'grid', gap: 12 } as const

interface Preset<T> {
  id: string
  name: string
  description: string
  apply: (component: T) => T
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): ReactElement {
  return (
    <div style={compactCard}>
      <div>
        <span style={label}>{title}</span>
        {description ? <p style={{ ...helper, margin: '4px 0 0' }}>{description}</p> : null}
      </div>
      {children}
    </div>
  )
}

function PresetGrid<T>({ presets, component, onApply }: { presets: ReadonlyArray<Preset<T>>; component: T; onApply: (next: T) => void }): ReactElement {
  return (
    <Section title="Ready-made presets" description="One-click starting points for common SimHub-style builds.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {presets.map((preset) => (
          <button key={preset.id} type="button" style={{ ...buttonStyle('soft'), textAlign: 'left', minHeight: 88 }} onClick={() => onApply(preset.apply(component))}>
            <strong style={{ display: 'block', fontSize: 13 }}>{preset.name}</strong>
            <small style={{ color: 'rgba(255,255,255,0.58)', lineHeight: 1.35 }}>{preset.description}</small>
          </button>
        ))}
      </div>
    </Section>
  )
}

function colorInput(value: string, onChange: (value: string) => void): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} style={{ width: 46, height: 34, border: 'none', background: 'transparent', cursor: 'pointer' }} />
      <TextField value={value} onChange={onChange} />
    </div>
  )
}

// ─── Option tables (kept in sync with the unions in devices.ts) ──────────────

const STRIP_CHIPS: ReadonlyArray<SelectOption<RgbStripComponent['chip']>> = [
  { value: 'ws2812', label: 'WS2812 / WS2812B' },
  { value: 'sk6812', label: 'SK6812' },
  { value: 'apa102', label: 'APA102 (Dotstar)' }
]
const STRIP_MODES: ReadonlyArray<SelectOption<RgbStripComponent['mode']>> = [
  { value: 'revlights', label: 'Rev lights' },
  { value: 'flags', label: 'Flags' },
  { value: 'custom', label: 'Custom' }
]
const STRIP_COLOR_ORDERS: ReadonlyArray<SelectOption<RgbStripComponent['colorOrder']>> = [
  { value: 'grb', label: 'GRB (WS2812 default)' },
  { value: 'rgb', label: 'RGB' },
  { value: 'brg', label: 'BRG' },
  { value: 'rbg', label: 'RBG' }
]
const STRIP_EFFECTS: ReadonlyArray<SelectOption<RgbStripComponent['startupEffect']>> = [
  { value: 'rev-gradient', label: 'Rev gradient' },
  { value: 'flag-bar', label: 'Flag bar' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'pit-limiter', label: 'Pit limiter' },
  { value: 'spotter', label: 'Spotter alert' },
  { value: 'custom', label: 'Custom' }
]
const STRIP_TEST_PATTERNS: ReadonlyArray<SelectOption<RgbStripComponent['testPattern']>> = [
  { value: 'rainbow', label: 'Rainbow sweep' },
  { value: 'chase', label: 'Chase' },
  { value: 'solid', label: 'Solid color' },
  { value: 'alternating', label: 'Alternating' },
  { value: 'off', label: 'Off' }
]
const MATRIX_CHIPS: ReadonlyArray<SelectOption<RgbMatrixComponent['chip']>> = [
  { value: 'ws2812', label: 'WS2812 (NeoPixel)' },
  { value: 'max7219', label: 'MAX7219' }
]
const MATRIX_MODES: ReadonlyArray<SelectOption<RgbMatrixComponent['mode']>> = [
  { value: 'iflag', label: 'iFlag (flags)' },
  { value: 'gear', label: 'Gear' },
  { value: 'custom', label: 'Custom' }
]
const ORIENTATIONS: ReadonlyArray<SelectOption<'0' | '90' | '180' | '270'>> = [
  { value: '0', label: '0°' },
  { value: '90', label: '90°' },
  { value: '180', label: '180°' },
  { value: '270', label: '270°' }
]
const matrixTwoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as const
const SCREEN_KINDS: ReadonlyArray<SelectOption<ScreenComponent['kind']>> = [
  { value: 'oled-ssd1306', label: 'OLED SSD1306' },
  { value: 'lcd-hd44780', label: 'LCD HD44780' },
  { value: 'tft', label: 'TFT' },
  { value: 'nextion', label: 'Nextion' }
]
const SCREEN_FIELDS: ReadonlyArray<ScreenField> = ['gear', 'speed', 'rpm', 'lap', 'delta', 'fuel', 'position', 'flags', 'tyres', 'brakes', 'custom']
const SCREEN_FONT_SIZES: ReadonlyArray<SelectOption<ScreenComponent['fontSize']>> = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' }
]
const SCREEN_LAYOUTS: ReadonlyArray<SelectOption<ScreenPage['layout']>> = [
  { value: 'stacked', label: 'Stacked rows' },
  { value: 'grid', label: 'Grid' },
  { value: 'hero', label: 'Hero metric' }
]
const SEG_CHIPS: ReadonlyArray<SelectOption<SegDisplayComponent['chip']>> = [
  { value: 'tm1637', label: 'TM1637' },
  { value: 'tm1638', label: 'TM1638' },
  { value: 'max7219', label: 'MAX7219' },
  { value: 'ht16k33', label: 'HT16K33' }
]
const SEG_METRICS: ReadonlyArray<SelectOption<SegDisplayComponent['metric']>> = [
  { value: 'gear', label: 'Gear' },
  { value: 'speed', label: 'Speed' },
  { value: 'rpm', label: 'RPM' },
  { value: 'lap', label: 'Lap' },
  { value: 'position', label: 'Position' },
  { value: 'custom', label: 'Custom' }
]
const SEG_LED_MODES: ReadonlyArray<SelectOption<SegDisplayComponent['ledMode']>> = [
  { value: 'telemetry', label: 'Telemetry bits' },
  { value: 'flags', label: 'Flags' },
  { value: 'rev', label: 'Rev LEDs' },
  { value: 'spotter', label: 'Spotter alerts' },
  { value: 'manual', label: 'Manual' }
]
const GAUGE_KINDS: ReadonlyArray<SelectOption<GaugeComponent['kind']>> = [
  { value: 'servo', label: 'Servo SG90' },
  { value: 'stepper-x27', label: 'Stepper X27.168' }
]
const GAUGE_METRICS: ReadonlyArray<SelectOption<GaugeComponent['metric']>> = [
  { value: 'speed', label: 'Speed' },
  { value: 'rpm', label: 'RPM' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'waterTemp', label: 'Water temp' },
  { value: 'oilTemp', label: 'Oil temp' },
  { value: 'custom', label: 'Custom' }
]
const GAUGE_CURLES: ReadonlyArray<SelectOption<GaugeCurve>> = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 's-curve', label: 'S-curve' }
]
const GAUGE_DIRECTIONS: ReadonlyArray<SelectOption<GaugeSweepDirection>> = [
  { value: 'clockwise', label: 'Clockwise' },
  { value: 'counterclockwise', label: 'Counter-clockwise' }
]
const BUTTON_ACTIONS: ReadonlyArray<SelectOption<ControlButtonAction>> = [
  { value: 'keyboard', label: 'Keyboard key' },
  { value: 'joystickButton', label: 'Joystick button' },
  { value: 'toggle', label: 'Toggle' },
  { value: 'pitLimiter', label: 'Pit limiter' },
  { value: 'tractionControl', label: 'Traction control' },
  { value: 'brakeBias', label: 'Brake bias' },
  { value: 'blackBox', label: 'Black box' },
  { value: 'custom', label: 'Custom' }
]
const ENCODER_MODES: ReadonlyArray<SelectOption<EncoderMode>> = [
  { value: 'incremental', label: 'Incremental' },
  { value: 'absolute', label: 'Absolute' },
  { value: 'dual-button', label: 'Dual virtual buttons' }
]
const START_LED_TRIGGERS: ReadonlyArray<SelectOption<StartLedComponent['trigger']>> = [
  { value: 'pitLimiter', label: 'Pit limiter' },
  { value: 'drs', label: 'DRS' },
  { value: 'shift', label: 'Shift' },
  { value: 'custom', label: 'Custom' }
]
const BLINK_MODES: ReadonlyArray<SelectOption<StartLedComponent['blinkMode']>> = [
  { value: 'steady', label: 'Steady' },
  { value: 'slow', label: 'Slow blink' },
  { value: 'fast', label: 'Fast blink' },
  { value: 'pulse', label: 'Pulse' }
]

// ─── Presets ─────────────────────────────────────────────────────────────────

const stripSegment = (id: string, labelText: string, start: number, length: number, effect: RgbStripSegment['effect'], color: string): RgbStripSegment => ({ id, label: labelText, start, length, effect, color })

const RGB_STRIP_PRESETS: ReadonlyArray<Preset<RgbStripComponent>> = [
  {
    id: 'rev-lights-4',
    name: '4 LED rev bar',
    description: 'Small SIM-X style rev strip with left/right banks.',
    apply: (c) => ({ ...c, presetId: 'rev-lights-4', label: 'Rev Lights', mode: 'revlights', ledCount: 4, brightness: 200, startupEffect: 'rev-gradient', segments: [stripSegment('left', 'Left bank', 0, 2, 'rev-gradient', '#00ff55'), stripSegment('right', 'Right bank', 2, 2, 'rev-gradient', '#ff2200')] })
  },
  {
    id: 'gt3-16-rev-flags',
    name: 'GT3 16 LED dash',
    description: 'Rev gradient plus two flag/spotter side zones.',
    apply: (c) => ({ ...c, presetId: 'gt3-16-rev-flags', label: 'GT3 Rev + Flags', mode: 'revlights', ledCount: 16, brightness: 220, refreshHz: 30, startupEffect: 'flag-bar', segments: [stripSegment('rev', 'Center rev bar', 2, 12, 'rev-gradient', '#00ff55'), stripSegment('left-flag', 'Left flag', 0, 2, 'flag-bar', '#ffcc00'), stripSegment('right-spotter', 'Right spotter', 14, 2, 'spotter', '#1f8dff')] })
  },
  {
    id: 'ambient-24',
    name: '24 LED ambient',
    description: 'Low brightness cockpit ambient / status strip.',
    apply: (c) => ({ ...c, presetId: 'ambient-24', label: 'Ambient Strip', mode: 'custom', ledCount: 24, brightness: 80, idleColor: '#0b3d91', startupEffect: 'ambient', testPattern: 'chase', segments: [stripSegment('ambient', 'Ambient glow', 0, 24, 'ambient', '#0b3d91')] })
  }
]

const SCREEN_PRESETS: ReadonlyArray<Preset<ScreenComponent>> = [
  {
    id: 'oled-race-dashboard',
    name: 'OLED race dashboard',
    description: 'Gear/speed/RPM hero page plus lap timing.',
    apply: (c) => ({ ...c, presetId: 'oled-race-dashboard', label: 'OLED Race Dashboard', kind: 'oled-ssd1306', cols: 21, rows: 4, fontSize: 'medium', pageCycleMs: 3500, pages: [{ id: 'race', label: 'Race', fields: ['gear', 'speed', 'rpm', 'delta'], layout: 'hero', durationMs: 3500 }, { id: 'laps', label: 'Laps', fields: ['lap', 'delta', 'position'], layout: 'stacked', durationMs: 3500 }] })
  },
  {
    id: 'lcd-endurance',
    name: '20x4 endurance LCD',
    description: 'Fuel, laps, delta and position for long races.',
    apply: (c) => ({ ...c, presetId: 'lcd-endurance', label: 'Endurance LCD', kind: 'lcd-hd44780', cols: 20, rows: 4, i2cAddress: '0x27', fontSize: 'small', pageCycleMs: 5000, pages: [{ id: 'stint', label: 'Stint', fields: ['fuel', 'lap', 'delta', 'position'], layout: 'stacked', durationMs: 5000 }, { id: 'car', label: 'Car health', fields: ['tyres', 'brakes', 'flags'], layout: 'grid', durationMs: 5000 }] })
  },
  {
    id: 'nextion-alerts',
    name: 'Nextion alerts',
    description: 'Dedicated alert/status screen with larger text.',
    apply: (c) => ({ ...c, presetId: 'nextion-alerts', label: 'Alerts Screen', kind: 'nextion', cols: 32, rows: 6, fontSize: 'large', contrast: 230, pages: [{ id: 'alerts', label: 'Alerts', fields: ['flags', 'fuel', 'custom'], layout: 'hero', durationMs: 2500 }] })
  }
]

const SEG_PRESETS: ReadonlyArray<Preset<SegDisplayComponent>> = [
  {
    id: 'tm1638-gear-flags',
    name: 'TM1638 gear + flags',
    description: 'Gear on 7-seg, onboard LEDs for flags/pit/DRS.',
    apply: (c) => ({ ...c, presetId: 'tm1638-gear-flags', label: 'TM1638 Gear + Flags', chip: 'tm1638', digits: 8, metric: 'gear', alternateMetric: 'speed', ledMode: 'flags', ledMappings: defaultSegMappings() })
  },
  {
    id: 'tm1637-speed',
    name: 'TM1637 speed',
    description: 'Compact 4-digit speed module.',
    apply: (c) => ({ ...c, presetId: 'tm1637-speed', label: 'Speed Display', chip: 'tm1637', digits: 4, metric: 'speed', brightness: 5, alternateEveryMs: 0, ledMode: 'manual', ledMappings: [] })
  },
  {
    id: 'max7219-rpm',
    name: 'MAX7219 RPM/lap',
    description: '8-digit RPM with timed lap fallback.',
    apply: (c) => ({ ...c, presetId: 'max7219-rpm', label: 'RPM / Lap Display', chip: 'max7219', digits: 8, metric: 'rpm', alternateMetric: 'lap', alternateEveryMs: 3000, brightness: 7, ledMode: 'rev' })
  }
]

const GAUGE_PRESETS: ReadonlyArray<Preset<GaugeComponent>> = [
  { id: 'gt-speedometer', name: 'GT speedometer', description: '0–300 km/h servo sweep.', apply: (c) => ({ ...c, presetId: 'gt-speedometer', label: 'Speedometer', kind: 'servo', metric: 'speed', minValue: 0, maxValue: 300, minAngle: 0, maxAngle: 180, smoothingMs: 120, warningValue: 0 }) },
  { id: 'rpm-x27', name: 'X27 tachometer', description: '0–10k RPM stepper gauge.', apply: (c) => ({ ...c, presetId: 'rpm-x27', label: 'Tachometer', kind: 'stepper-x27', metric: 'rpm', minValue: 0, maxValue: 10000, minAngle: 20, maxAngle: 320, smoothingMs: 80, warningValue: 8500 }) },
  { id: 'fuel-servo', name: 'Fuel gauge', description: '0–100 fuel scale with low warning.', apply: (c) => ({ ...c, presetId: 'fuel-servo', label: 'Fuel Gauge', kind: 'servo', metric: 'fuel', minValue: 0, maxValue: 100, minAngle: 15, maxAngle: 165, warningValue: 10 }) }
]

const CONTROL_PRESETS: ReadonlyArray<Preset<ControlComponent>> = [
  { id: 'buttonbox-12-encoders', name: '12 buttons + 2 encoders', description: 'Common GT button box mapping.', apply: (c) => ({ ...c, presetId: 'buttonbox-12-encoders', label: 'GT Button Box', buttons: 12, encoders: 2, analogs: 0, debounceMs: 20, usePullups: true, encoderMode: 'incremental', buttonMappings: defaultButtonMappings(12), encoderMappings: defaultEncoderMappings(2), analogMappings: [] }) },
  { id: 'wheel-plate', name: 'Wheel plate', description: '8 buttons, 4 encoders and 2 paddles/axes.', apply: (c) => ({ ...c, presetId: 'wheel-plate', label: 'Wheel Plate Inputs', buttons: 8, encoders: 4, analogs: 2, debounceMs: 15, usePullups: true, encoderMode: 'dual-button', buttonMappings: defaultButtonMappings(8), encoderMappings: defaultEncoderMappings(4), analogMappings: [{ index: 0, label: 'Clutch left', axis: 'slider', min: 0, max: 1023, invert: false }, { index: 1, label: 'Clutch right', axis: 'dial', min: 0, max: 1023, invert: false }] }) },
  { id: 'pedal-axes', name: 'Analog axes', description: 'Three analog inputs for pedals or trim pots.', apply: (c) => ({ ...c, presetId: 'pedal-axes', label: 'Analog Axes', buttons: 0, encoders: 0, analogs: 3, analogMappings: [{ index: 0, label: 'Throttle', axis: 'x', min: 0, max: 1023, invert: false }, { index: 1, label: 'Brake', axis: 'y', min: 0, max: 1023, invert: false }, { index: 2, label: 'Clutch', axis: 'z', min: 0, max: 1023, invert: false }] }) }
]

const BUZZER_PRESETS: ReadonlyArray<Preset<BuzzerComponent>> = [
  { id: 'shift-warning-beeps', name: 'Shift beeps', description: 'Short high-pitch shift and low-fuel beeps.', apply: (c) => ({ ...c, presetId: 'shift-warning-beeps', label: 'Shift Buzzer', toneHz: 2200, durationMs: 120, repeat: 1, volume: 70, rules: defaultAlertRules() }) },
  { id: 'critical-alert', name: 'Critical alerts', description: 'Longer repeated alert for flags/fuel.', apply: (c) => ({ ...c, presetId: 'critical-alert', label: 'Critical Alert Buzzer', toneHz: 1500, durationMs: 280, repeat: 3, volume: 90, rules: [{ id: 'yellow', label: 'Yellow flag', condition: 'yellowFlag', severity: 'critical', message: 'YELLOW', blink: true }, { id: 'fuel', label: 'Low fuel', condition: 'lowFuel', severity: 'critical', message: 'LOW FUEL', blink: true }] }) }
]

const START_LED_PRESETS: ReadonlyArray<Preset<StartLedComponent>> = [
  { id: 'pit-drs-status', name: 'Pit / DRS status', description: 'Blue pit limiter and green DRS status LED.', apply: (c) => ({ ...c, presetId: 'pit-drs-status', label: 'Pit / DRS LED', trigger: 'pitLimiter', color: '#1F8DFF', offColor: '#000000', brightness: 180, blinkMode: 'steady', rules: [{ id: 'pit', label: 'Pit limiter', condition: 'pitLimiter', severity: 'warning', message: 'PIT', blink: false }, { id: 'drs', label: 'DRS', condition: 'drs', severity: 'info', message: 'DRS', blink: false }] }) },
  { id: 'shift-flash', name: 'Shift flash', description: 'Fast red shift indicator.', apply: (c) => ({ ...c, presetId: 'shift-flash', label: 'Shift Flash LED', trigger: 'shift', color: '#ff2d2d', brightness: 255, blinkMode: 'fast', rules: [{ id: 'shift', label: 'Shift point', condition: 'shift', severity: 'warning', message: 'SHIFT', blink: true }] }) }
]

function defaultSegMappings(): SegLedMapping[] {
  return [
    { index: 0, label: 'Yellow flag', metric: 'flag', color: '#ffcc00', blink: true },
    { index: 1, label: 'Blue flag', metric: 'flag', color: '#1f8dff', blink: true },
    { index: 2, label: 'Pit limiter', metric: 'pitLimiter', color: '#ff2d2d', blink: false },
    { index: 3, label: 'DRS', metric: 'drs', color: '#36d17c', blink: false }
  ]
}

function defaultButtonMappings(count: number): ControlComponent['buttonMappings'] {
  const labels = ['Pit limiter', 'Radio', 'Wipers', 'Lights', 'ABS up', 'ABS down', 'TC up', 'TC down', 'Black box', 'Relative', 'Fuel map', 'Reset']
  return Array.from({ length: count }, (_, index) => ({ index, label: labels[index] ?? `Button ${index + 1}`, action: index === 0 ? 'pitLimiter' : 'keyboard', value: labels[index]?.slice(0, 1).toUpperCase() ?? '', momentary: true }))
}

function defaultEncoderMappings(count: number): ControlComponent['encoderMappings'] {
  const labels = ['Brake bias', 'TC', 'ABS', 'Fuel map']
  return Array.from({ length: count }, (_, index) => ({ index, label: labels[index] ?? `Encoder ${index + 1}`, mode: 'incremental', clockwise: `${labels[index] ?? 'value'}+`, counterClockwise: `${labels[index] ?? 'value'}-`, pushAction: `${labels[index] ?? 'value'} reset` }))
}

function defaultAlertRules(): AlertRule[] {
  return [
    { id: 'shift', label: 'Shift point', condition: 'shift', severity: 'warning', message: 'SHIFT', blink: true },
    { id: 'fuel', label: 'Low fuel', condition: 'lowFuel', severity: 'critical', message: 'LOW FUEL', blink: true }
  ]
}

function fieldsToText(fields: ScreenField[]): string {
  return fields.join(', ')
}

function textToFields(value: string): ScreenField[] {
  return value.split(',').map((part) => part.trim()).filter((part): part is ScreenField => SCREEN_FIELDS.includes(part as ScreenField))
}

// ─── Type-specific editors ───────────────────────────────────────────────────

function RgbStripEditor({ component, onChange }: { component: RgbStripComponent; onChange: (next: RgbStripComponent) => void }): ReactElement {
  const updateSegment = (id: string, patch: Partial<RgbStripSegment>): void => {
    onChange({ ...component, segments: component.segments.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)) })
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PresetGrid presets={RGB_STRIP_PRESETS} component={component} onApply={onChange} />
      <Section title="Hardware and output" description="Configure chip timing, LED count, color order and safe test behavior.">
        <div style={twoCol}>
          <Field caption="Chip"><SelectField value={component.chip} options={STRIP_CHIPS} onChange={(chip) => onChange({ ...component, chip })} /></Field>
          <Field caption="Mode"><SelectField value={component.mode} options={STRIP_MODES} onChange={(mode) => onChange({ ...component, mode })} /></Field>
          <Field caption="LED count"><NumberField value={component.ledCount} min={1} max={512} onChange={(ledCount) => onChange({ ...component, ledCount })} /></Field>
          <Field caption="Color order"><SelectField value={component.colorOrder} options={STRIP_COLOR_ORDERS} onChange={(colorOrder) => onChange({ ...component, colorOrder })} /></Field>
          <Field caption="Refresh limit (Hz)"><NumberField value={component.refreshHz} min={1} max={60} onChange={(refreshHz) => onChange({ ...component, refreshHz })} /></Field>
          <Field caption="Test pattern"><SelectField value={component.testPattern} options={STRIP_TEST_PATTERNS} onChange={(testPattern) => onChange({ ...component, testPattern })} /></Field>
        </div>
        <Field caption="Brightness"><Slider value={component.brightness} min={0} max={255} onChange={(brightness) => onChange({ ...component, brightness })} /></Field>
        <div style={twoCol}>
          <Field caption="Startup effect"><SelectField value={component.startupEffect} options={STRIP_EFFECTS} onChange={(startupEffect) => onChange({ ...component, startupEffect })} /></Field>
          <Field caption="Idle color">{colorInput(component.idleColor, (idleColor) => onChange({ ...component, idleColor }))}</Field>
        </div>
        <Toggle caption="Gamma correction" checked={component.gammaCorrection} onChange={(gammaCorrection) => onChange({ ...component, gammaCorrection })} />
      </Section>
      <Section title="Segments" description="Split the strip into logical zones: rev bar, flag LEDs, spotter LEDs or ambient zones.">
        <div style={{ display: 'grid', gap: 10 }}>
          {component.segments.map((segment) => (
            <div key={segment.id} style={{ ...card, padding: 10 }}>
              <div style={threeCol}>
                <Field caption="Label"><TextField value={segment.label} onChange={(value) => updateSegment(segment.id, { label: value })} /></Field>
                <Field caption="Start LED"><NumberField value={segment.start} min={0} max={511} onChange={(start) => updateSegment(segment.id, { start })} /></Field>
                <Field caption="Length"><NumberField value={segment.length} min={1} max={512} onChange={(length) => updateSegment(segment.id, { length })} /></Field>
                <Field caption="Effect"><SelectField value={segment.effect} options={STRIP_EFFECTS} onChange={(effect) => updateSegment(segment.id, { effect })} /></Field>
                <Field caption="Color">{colorInput(segment.color, (color) => updateSegment(segment.id, { color }))}</Field>
              </div>
            </div>
          ))}
          <button type="button" style={buttonStyle('ghost')} onClick={() => onChange({ ...component, segments: [...component.segments, stripSegment(`segment-${component.segments.length + 1}`, `Segment ${component.segments.length + 1}`, 0, 1, 'custom', '#ffffff')] })}>+ Add segment</button>
        </div>
      </Section>
      <Section title="Preview"><StripPreview count={component.ledCount} brightness={component.brightness} /></Section>
    </div>
  )
}

function RgbMatrixEditor({
  component,
  onChange,
  language
}: {
  component: RgbMatrixComponent
  onChange: (next: RgbMatrixComponent) => void
  language?: ResolvedLanguage
}): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={matrixTwoCol}>
        <Field caption="Chip">
          <SelectField value={component.chip} options={MATRIX_CHIPS} onChange={(chip) => onChange({ ...component, chip })} />
        </Field>
        <Field caption="Mode">
          <SelectField value={component.mode} options={MATRIX_MODES} onChange={(mode) => onChange({ ...component, mode })} />
        </Field>
      </div>
      <div style={matrixTwoCol}>
        <Field caption="Width">
          <NumberField value={component.width} min={1} max={32} onChange={(width) => onChange({ ...component, width })} />
        </Field>
        <Field caption="Height">
          <NumberField value={component.height} min={1} max={32} onChange={(height) => onChange({ ...component, height })} />
        </Field>
      </div>
      <div style={matrixTwoCol}>
        <Field caption="Orientacao">
          <SelectField
            value={String(component.orientation) as '0' | '90' | '180' | '270'}
            options={ORIENTATIONS}
            onChange={(value) => onChange({ ...component, orientation: Number(value) as RgbMatrixComponent['orientation'] })}
          />
        </Field>
        <Field caption="Brightness">
          <Slider
            value={component.brightness}
            min={0}
            max={255}
            onChange={(brightness) => onChange({ ...component, brightness })}
          />
        </Field>
      </div>
      <Toggle
        caption={tt(language, 'arduinos.component.matrix.serpentine')}
        checked={component.serpentine}
        onChange={(serpentine) => onChange({ ...component, serpentine })}
      />
      <div style={card}>
        <span style={label}>Matrix preview {component.width}×{component.height}</span>
        <MatrixPreview width={component.width} height={component.height} brightness={component.brightness} />
      </div>
    </div>
  )
}

function ScreenEditor({ component, onChange }: { component: ScreenComponent; onChange: (next: ScreenComponent) => void }): ReactElement {
  const updatePage = (id: string, patch: Partial<ScreenPage>): void => onChange({ ...component, pages: component.pages.map((page) => (page.id === id ? { ...page, ...patch } : page)) })
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PresetGrid presets={SCREEN_PRESETS} component={component} onApply={onChange} />
      <Section title="Display hardware" description="OLED/LCD dimensions, address, rotation and readability settings.">
        <div style={twoCol}>
          <Field caption="Screen type"><SelectField value={component.kind} options={SCREEN_KINDS} onChange={(kind) => onChange({ ...component, kind })} /></Field>
          <Field caption="I2C / device address"><TextField value={component.i2cAddress} onChange={(i2cAddress) => onChange({ ...component, i2cAddress })} /></Field>
          <Field caption="Columns"><NumberField value={component.cols} min={1} max={64} onChange={(cols) => onChange({ ...component, cols })} /></Field>
          <Field caption="Rows"><NumberField value={component.rows} min={1} max={16} onChange={(rows) => onChange({ ...component, rows })} /></Field>
          <Field caption="Rotation"><SelectField value={String(component.rotation) as '0' | '90' | '180' | '270'} options={ORIENTATIONS} onChange={(value) => onChange({ ...component, rotation: Number(value) as ScreenRotation })} /></Field>
          <Field caption="Font size"><SelectField value={component.fontSize} options={SCREEN_FONT_SIZES} onChange={(fontSize) => onChange({ ...component, fontSize })} /></Field>
        </div>
        <Field caption="Contrast"><Slider value={component.contrast} min={0} max={255} onChange={(contrast) => onChange({ ...component, contrast })} /></Field>
        <div style={twoCol}>
          <Toggle caption="Invert pixels" checked={component.invert} onChange={(invert) => onChange({ ...component, invert })} />
          <Toggle caption="Show units" checked={component.showUnits} onChange={(showUnits) => onChange({ ...component, showUnits })} />
          <Toggle caption="Use OLED Dashboard page engine" checked={component.useOledDashboard} onChange={(useOledDashboard) => onChange({ ...component, useOledDashboard })} />
        </div>
      </Section>
      <Section title="Pages and fields" description="Choose page rotation and field layout. Current firmware renders the default rows; richer page rendering may need a firmware channel.">
        <Field caption="Default page cycle (ms)"><NumberField value={component.pageCycleMs} min={500} max={30000} onChange={(pageCycleMs) => onChange({ ...component, pageCycleMs })} /></Field>
        <div style={{ display: 'grid', gap: 10 }}>
          {component.pages.map((page) => (
            <div key={page.id} style={{ ...card, padding: 10 }}>
              <div style={threeCol}>
                <Field caption="Page label"><TextField value={page.label} onChange={(value) => updatePage(page.id, { label: value })} /></Field>
                <Field caption="Layout"><SelectField value={page.layout} options={SCREEN_LAYOUTS} onChange={(layout) => updatePage(page.id, { layout })} /></Field>
                <Field caption="Duration (ms)"><NumberField value={page.durationMs} min={500} max={30000} onChange={(durationMs) => updatePage(page.id, { durationMs })} /></Field>
              </div>
              <Field caption="Fields (comma separated)" hint={`Allowed: ${SCREEN_FIELDS.join(', ')}`}><TextField value={fieldsToText(page.fields)} onChange={(value) => updatePage(page.id, { fields: textToFields(value) })} /></Field>
            </div>
          ))}
          <button type="button" style={buttonStyle('ghost')} onClick={() => onChange({ ...component, pages: [...component.pages, { id: `page-${component.pages.length + 1}`, label: `Page ${component.pages.length + 1}`, fields: ['gear', 'speed'], layout: 'stacked', durationMs: component.pageCycleMs }] })}>+ Add page</button>
        </div>
      </Section>
    </div>
  )
}

function SegDisplayEditor({ component, onChange }: { component: SegDisplayComponent; onChange: (next: SegDisplayComponent) => void }): ReactElement {
  const updateLed = (index: number, patch: Partial<SegLedMapping>): void => onChange({ ...component, ledMappings: component.ledMappings.map((item) => (item.index === index ? { ...item, ...patch } : item)) })
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PresetGrid presets={SEG_PRESETS} component={component} onApply={onChange} />
      <Section title="7-segment content" description="Primary/alternate metric, brightness and formatting.">
        <div style={twoCol}>
          <Field caption="Chip"><SelectField value={component.chip} options={SEG_CHIPS} onChange={(chip) => onChange({ ...component, chip })} /></Field>
          <Field caption="Digits"><NumberField value={component.digits} min={1} max={8} onChange={(digits) => onChange({ ...component, digits })} /></Field>
          <Field caption="Primary metric"><SelectField value={component.metric} options={SEG_METRICS} onChange={(metric) => onChange({ ...component, metric })} /></Field>
          <Field caption="Alternate metric"><SelectField value={component.alternateMetric} options={SEG_METRICS} onChange={(alternateMetric) => onChange({ ...component, alternateMetric })} /></Field>
          <Field caption="Alternate every (ms)"><NumberField value={component.alternateEveryMs} min={0} max={60000} onChange={(alternateEveryMs) => onChange({ ...component, alternateEveryMs })} /></Field>
          <Field caption="Decimal places"><NumberField value={component.decimalPlaces} min={0} max={3} onChange={(decimalPlaces) => onChange({ ...component, decimalPlaces })} /></Field>
        </div>
        <Field caption="Brightness"><Slider value={component.brightness} min={0} max={7} onChange={(brightness) => onChange({ ...component, brightness })} /></Field>
        <Toggle caption="Leading zeros" checked={component.leadingZeros} onChange={(leadingZeros) => onChange({ ...component, leadingZeros })} />
      </Section>
      <Section title="TM1638 LEDs" description="Map the 8 onboard LEDs to flags, rev bands, DRS, pit limiter or custom states.">
        <Field caption="LED mode"><SelectField value={component.ledMode} options={SEG_LED_MODES} onChange={(ledMode) => onChange({ ...component, ledMode })} /></Field>
        <div style={{ display: 'grid', gap: 8 }}>
          {component.ledMappings.map((item) => (
            <div key={item.index} style={threeCol}>
              <Field caption={`LED ${item.index + 1}`}><TextField value={item.label} onChange={(value) => updateLed(item.index, { label: value })} /></Field>
              <Field caption="Color">{colorInput(item.color, (color) => updateLed(item.index, { color }))}</Field>
              <Toggle caption="Blink" checked={item.blink} onChange={(blink) => updateLed(item.index, { blink })} />
            </div>
          ))}
          <button type="button" style={buttonStyle('ghost')} onClick={() => onChange({ ...component, ledMappings: [...component.ledMappings, { index: component.ledMappings.length, label: `LED ${component.ledMappings.length + 1}`, metric: 'custom', color: '#ffffff', blink: false }] })}>+ Add LED mapping</button>
        </div>
      </Section>
    </div>
  )
}

function GaugeEditor({ component, onChange }: { component: GaugeComponent; onChange: (next: GaugeComponent) => void }): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PresetGrid presets={GAUGE_PRESETS} component={component} onApply={onChange} />
      <Section title="Telemetry mapping" description="Map telemetry values into the physical sweep range.">
        <div style={twoCol}>
          <Field caption="Gauge type"><SelectField value={component.kind} options={GAUGE_KINDS} onChange={(kind) => onChange({ ...component, kind })} /></Field>
          <Field caption="Metric"><SelectField value={component.metric} options={GAUGE_METRICS} onChange={(metric) => onChange({ ...component, metric })} /></Field>
          <Field caption="Minimum value"><NumberField value={component.minValue} onChange={(minValue) => onChange({ ...component, minValue })} /></Field>
          <Field caption="Maximum value"><NumberField value={component.maxValue} onChange={(maxValue) => onChange({ ...component, maxValue })} /></Field>
          <Field caption="Minimum angle (°)"><NumberField value={component.minAngle} min={0} max={360} onChange={(minAngle) => onChange({ ...component, minAngle })} /></Field>
          <Field caption="Maximum angle (°)"><NumberField value={component.maxAngle} min={0} max={360} onChange={(maxAngle) => onChange({ ...component, maxAngle })} /></Field>
        </div>
      </Section>
      <Section title="Calibration" description="Servo/stepper direction, curve, smoothing and startup behavior.">
        <div style={twoCol}>
          <Field caption="Sweep direction"><SelectField value={component.sweepDirection} options={GAUGE_DIRECTIONS} onChange={(sweepDirection) => onChange({ ...component, sweepDirection })} /></Field>
          <Field caption="Curve"><SelectField value={component.curve} options={GAUGE_CURLES} onChange={(curve) => onChange({ ...component, curve })} /></Field>
          <Field caption="Smoothing (ms)"><NumberField value={component.smoothingMs} min={0} max={2000} onChange={(smoothingMs) => onChange({ ...component, smoothingMs })} /></Field>
          <Field caption="Calibration offset (°)"><NumberField value={component.calibrationOffset} min={-180} max={180} onChange={(calibrationOffset) => onChange({ ...component, calibrationOffset })} /></Field>
          <Field caption="Warning value"><NumberField value={component.warningValue} onChange={(warningValue) => onChange({ ...component, warningValue })} /></Field>
        </div>
        <div style={twoCol}>
          <Toggle caption="Home on startup" checked={component.homeOnStartup} onChange={(homeOnStartup) => onChange({ ...component, homeOnStartup })} />
          <Toggle caption="Run test sweep after flash" checked={component.testSweep} onChange={(testSweep) => onChange({ ...component, testSweep })} />
        </div>
      </Section>
    </div>
  )
}

function ControlEditor({ component, onChange }: { component: ControlComponent; onChange: (next: ControlComponent) => void }): ReactElement {
  const updateButton = (index: number, patch: Partial<ControlComponent['buttonMappings'][number]>): void => onChange({ ...component, buttonMappings: component.buttonMappings.map((item) => (item.index === index ? { ...item, ...patch } : item)) })
  const updateEncoder = (index: number, patch: Partial<ControlComponent['encoderMappings'][number]>): void => onChange({ ...component, encoderMappings: component.encoderMappings.map((item) => (item.index === index ? { ...item, ...patch } : item)) })
  const updateAnalog = (index: number, patch: Partial<ControlComponent['analogMappings'][number]>): void => onChange({ ...component, analogMappings: component.analogMappings.map((item) => (item.index === index ? { ...item, ...patch } : item)) })
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PresetGrid presets={CONTROL_PRESETS} component={component} onApply={onChange} />
      <Section title="Input counts and scan behavior">
        <div style={twoCol}>
          <Field caption="Buttons"><NumberField value={component.buttons} min={0} max={128} onChange={(buttons) => onChange({ ...component, buttons })} /></Field>
          <Field caption="Encoders"><NumberField value={component.encoders} min={0} max={32} onChange={(encoders) => onChange({ ...component, encoders })} /></Field>
          <Field caption="Analog axes"><NumberField value={component.analogs} min={0} max={16} onChange={(analogs) => onChange({ ...component, analogs })} /></Field>
          <Field caption="Debounce (ms)"><NumberField value={component.debounceMs} min={0} max={250} onChange={(debounceMs) => onChange({ ...component, debounceMs })} /></Field>
          <Field caption="Default encoder mode"><SelectField value={component.encoderMode} options={ENCODER_MODES} onChange={(encoderMode) => onChange({ ...component, encoderMode })} /></Field>
        </div>
        <Toggle caption="Use internal pull-ups" checked={component.usePullups} onChange={(usePullups) => onChange({ ...component, usePullups })} />
      </Section>
      <Section title="Button mappings">
        <div style={{ display: 'grid', gap: 10 }}>
          {component.buttonMappings.map((item) => (
            <div key={item.index} style={threeCol}>
              <Field caption={`Button ${item.index + 1}`}><TextField value={item.label} onChange={(value) => updateButton(item.index, { label: value })} /></Field>
              <Field caption="Action"><SelectField value={item.action} options={BUTTON_ACTIONS} onChange={(action) => updateButton(item.index, { action })} /></Field>
              <Field caption="Value"><TextField value={item.value} onChange={(value) => updateButton(item.index, { value })} /></Field>
              <Toggle caption="Momentary" checked={item.momentary} onChange={(momentary) => updateButton(item.index, { momentary })} />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Encoder mappings">
        <div style={{ display: 'grid', gap: 10 }}>
          {component.encoderMappings.map((item) => (
            <div key={item.index} style={threeCol}>
              <Field caption={`Encoder ${item.index + 1}`}><TextField value={item.label} onChange={(value) => updateEncoder(item.index, { label: value })} /></Field>
              <Field caption="Mode"><SelectField value={item.mode} options={ENCODER_MODES} onChange={(mode) => updateEncoder(item.index, { mode })} /></Field>
              <Field caption="Clockwise"><TextField value={item.clockwise} onChange={(clockwise) => updateEncoder(item.index, { clockwise })} /></Field>
              <Field caption="Counter-clockwise"><TextField value={item.counterClockwise} onChange={(counterClockwise) => updateEncoder(item.index, { counterClockwise })} /></Field>
              <Field caption="Push"><TextField value={item.pushAction} onChange={(pushAction) => updateEncoder(item.index, { pushAction })} /></Field>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Analog mappings">
        <div style={{ display: 'grid', gap: 10 }}>
          {component.analogMappings.map((item) => (
            <div key={item.index} style={threeCol}>
              <Field caption={`Analog ${item.index + 1}`}><TextField value={item.label} onChange={(value) => updateAnalog(item.index, { label: value })} /></Field>
              <Field caption="Min"><NumberField value={item.min} min={0} max={1023} onChange={(min) => updateAnalog(item.index, { min })} /></Field>
              <Field caption="Max"><NumberField value={item.max} min={0} max={1023} onChange={(max) => updateAnalog(item.index, { max })} /></Field>
              <Toggle caption="Invert" checked={item.invert} onChange={(invert) => updateAnalog(item.index, { invert })} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function BuzzerEditor({ component, onChange }: { component: BuzzerComponent; onChange: (next: BuzzerComponent) => void }): ReactElement {
  const updateRule = (id: string, patch: Partial<AlertRule>): void => onChange({ ...component, rules: component.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) })
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PresetGrid presets={BUZZER_PRESETS} component={component} onApply={onChange} />
      <Section title="Buzzer output">
        <div style={twoCol}>
          <Field caption="Tone (Hz)"><NumberField value={component.toneHz} min={20} max={12000} onChange={(toneHz) => onChange({ ...component, toneHz })} /></Field>
          <Field caption="Duration (ms)"><NumberField value={component.durationMs} min={20} max={5000} onChange={(durationMs) => onChange({ ...component, durationMs })} /></Field>
          <Field caption="Repeat"><NumberField value={component.repeat} min={1} max={10} onChange={(repeat) => onChange({ ...component, repeat })} /></Field>
        </div>
        <Field caption="Volume"><Slider value={component.volume} min={0} max={100} onChange={(volume) => onChange({ ...component, volume })} format={(value) => `${value}%`} /></Field>
        <Toggle caption="Active high" checked={component.activeHigh} onChange={(activeHigh) => onChange({ ...component, activeHigh })} />
      </Section>
      <AlertRulesEditor rules={component.rules} onChangeRule={updateRule} />
    </div>
  )
}

function StartLedEditor({ component, onChange }: { component: StartLedComponent; onChange: (next: StartLedComponent) => void }): ReactElement {
  const updateRule = (id: string, patch: Partial<AlertRule>): void => onChange({ ...component, rules: component.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) })
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <PresetGrid presets={START_LED_PRESETS} component={component} onApply={onChange} />
      <Section title="Status LED output">
        <div style={twoCol}>
          <Field caption="Trigger"><SelectField value={component.trigger} options={START_LED_TRIGGERS} onChange={(trigger) => onChange({ ...component, trigger })} /></Field>
          <Field caption="Blink mode"><SelectField value={component.blinkMode} options={BLINK_MODES} onChange={(blinkMode) => onChange({ ...component, blinkMode })} /></Field>
          <Field caption="On color">{colorInput(component.color, (color) => onChange({ ...component, color }))}</Field>
          <Field caption="Off color">{colorInput(component.offColor, (offColor) => onChange({ ...component, offColor }))}</Field>
        </div>
        <Field caption="Brightness"><Slider value={component.brightness} min={0} max={255} onChange={(brightness) => onChange({ ...component, brightness })} /></Field>
      </Section>
      <AlertRulesEditor rules={component.rules} onChangeRule={updateRule} />
    </div>
  )
}


function CustomSerialComponentEditor({ component, onChange, language }: { component: CustomSerialComponent; onChange: (next: CustomSerialComponent) => void; language?: ResolvedLanguage }): ReactElement {
  const fieldsText = component.telemetryFields.join(', ')
  const previewValue = component.sampleValue || '123'
  const preview = component.template.replace(/\$\{\s*value\s*\}/g, previewValue).replace(/\$\{\s*field\s*\}/g, component.telemetryFields[0] ?? '')
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Section title={tt(language, 'arduinos.component.customSerial.title')} description={tt(language, 'arduinos.component.customSerial.description')}>
        <div style={twoCol}>
          <Field caption={tt(language, 'arduinos.component.customSerial.template')} hint="Use ${value} and ${field} placeholders.">
            <TextField value={component.template} onChange={(template) => onChange({ ...component, template })} placeholder="T:${value}" />
          </Field>
          <Field caption={tt(language, 'arduinos.component.customSerial.fields')} hint="Comma-separated telemetry paths.">
            <TextField
              value={fieldsText}
              onChange={(value) => onChange({ ...component, telemetryFields: value.split(',').map((field) => field.trim()).filter(Boolean) })}
              placeholder="speedKmh, rpm"
            />
          </Field>
          <Field caption={tt(language, 'arduinos.component.customSerial.sample')}>
            <TextField value={component.sampleValue} onChange={(sampleValue) => onChange({ ...component, sampleValue })} />
          </Field>
          <Field caption={tt(language, 'arduinos.component.customSerial.rate')}>
            <NumberField value={component.sendRateHz} min={1} max={60} onChange={(sendRateHz) => onChange({ ...component, sendRateHz })} />
          </Field>
        </div>
        <Toggle caption={tt(language, 'arduinos.component.customSerial.newline')} checked={component.appendNewline} onChange={(appendNewline) => onChange({ ...component, appendNewline })} />
        <div style={card}>
          <span style={label}>{tt(language, 'arduinos.component.customSerial.preview')}</span>
          <code style={{ display: 'block', marginTop: 8, color: ACCENT }}>{preview}{component.appendNewline ? '\\n' : ''}</code>
          <p style={{ ...helper, margin: '8px 0 0' }}>{tt(language, 'arduinos.component.customSerial.stub')}</p>
        </div>
      </Section>
    </div>
  )
}

function AlertRulesEditor({ rules, onChangeRule }: { rules: AlertRule[]; onChangeRule: (id: string, patch: Partial<AlertRule>) => void }): ReactElement {
  return (
    <Section title="Alert pages and conditions" description="Reusable alert conditions for Display & Alerts. Existing output channels drive buzzer/status LED; richer alert pages may need firmware support.">
      <div style={{ display: 'grid', gap: 10 }}>
        {rules.map((rule) => (
          <div key={rule.id} style={threeCol}>
            <Field caption="Rule"><TextField value={rule.label} onChange={(labelText) => onChangeRule(rule.id, { label: labelText })} /></Field>
            <Field caption="Message"><TextField value={rule.message} onChange={(message) => onChangeRule(rule.id, { message })} /></Field>
            <Field caption="Condition"><TextField value={rule.condition} onChange={(condition) => onChangeRule(rule.id, { condition: condition as AlertRule['condition'] })} /></Field>
            <Toggle caption="Blink" checked={rule.blink} onChange={(blink) => onChangeRule(rule.id, { blink })} />
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Shared pinout editor ────────────────────────────────────────────────────

function PinoutEditor({ component, board, conflicts, onChange }: { component: DeviceComponent; board: BoardInfo; conflicts: Set<string>; onChange: (next: DeviceComponent) => void }): ReactElement {
  const roles = findComponentType(component.type).requiredPins
  return (
    <div style={card}>
      <span style={label}>Pinout · {board.name}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 10 }}>
        {roles.map((role) => {
          const value = component.pins[role.role] ?? ''
          const suggestions = pinSuggestions(board, role)
          const listId = `hub-pins-${component.id}-${role.role}`
          const invalid = value !== '' && conflicts.has(value)
          return (
            <Field key={role.role} caption={`${role.label}${role.optional ? ' (optional)' : ''}`} hint={invalid ? '⚠ pin conflict' : role.kind.toUpperCase()}>
              <TextField value={value} invalid={invalid} list={suggestions.length > 0 ? listId : undefined} placeholder={suggestions[0] ?? '—'} onChange={(next) => onChange({ ...component, pins: { ...component.pins, [role.role]: next } })} />
              {suggestions.length > 0 ? <datalist id={listId}>{suggestions.map((pin) => <option key={pin} value={pin} />)}</datalist> : null}
            </Field>
          )
        })}
      </div>
    </div>
  )
}

// ─── Public entry point ──────────────────────────────────────────────────────

interface ComponentEditorProps {
  component: DeviceComponent
  board: BoardInfo
  conflicts: Set<string>
  onChange: (next: DeviceComponent) => void
  language?: ResolvedLanguage
}

function renderTypeFields(component: DeviceComponent, onChange: (next: DeviceComponent) => void, language?: ResolvedLanguage): ReactElement {
  switch (component.type) {
    case 'rgbStrip':
      return <RgbStripEditor component={component} onChange={onChange} />
    case 'rgbMatrix':
      return <RgbMatrixEditor component={component} onChange={onChange} language={language} />
    case 'screen':
      return <ScreenEditor component={component} onChange={onChange} />
    case 'segDisplay':
      return <SegDisplayEditor component={component} onChange={onChange} />
    case 'gauge':
      return <GaugeEditor component={component} onChange={onChange} />
    case 'control':
      return <ControlEditor component={component} onChange={onChange} />
    case 'buzzer':
      return <BuzzerEditor component={component} onChange={onChange} />
    case 'startLed':
      return <StartLedEditor component={component} onChange={onChange} />
    case 'customSerial':
      return <CustomSerialComponentEditor component={component} onChange={onChange} language={language} />
    default:
      return <span style={{ color: ACCENT }}>Unsupported type</span>
  }
}

export function ComponentEditor({ component, board, conflicts, onChange, language }: ComponentEditorProps): ReactElement {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {renderTypeFields(component, onChange, language)}
      <PinoutEditor component={component} board={board} conflicts={conflicts} onChange={onChange} />
    </div>
  )
}
