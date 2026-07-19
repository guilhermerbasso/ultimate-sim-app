import { createButtonBoxPanel, type ButtonAction, type ButtonBoxButton, type ButtonBoxButtonInput, type ButtonBoxPanel, type KeyMaterial } from './touch-panel'

type MacroMode = 'press' | 'chord' | 'sequence' | 'hold' | 'toggle' | 'repeat'
type Palette = {
  car: string
  body: string
  accent: string
  accent2: string
  text: string
  dark: string
  tags: string[]
}

const key = (keys: string[], mode: MacroMode = 'press'): ButtonAction => ({ kind: 'keyboard', command: { mode, keys } })
const iracing = (name: 'pit:clearAll' | 'pit:addFuel' | 'blackBox:next' | 'blackBox:previous', fuelLiters?: number): ButtonAction => ({
  kind: 'iracing',
  command: fuelLiters === undefined ? { group: name.split(':')[0] as 'pit' | 'blackBox', name } : { group: 'pit', name, fuelLiters }
})
const overlay = (overlayId: string): ButtonAction => ({ kind: 'app', command: { name: 'overlays:toggle', overlayId } })

function button(
  label: string,
  material: KeyMaterial,
  icon: string | undefined,
  palette: Palette,
  action: ButtonAction,
  options: ButtonBoxButtonInput = {}
): ButtonBoxButtonInput {
  return {
    ...options,
    label,
    material,
    icon,
    bodyColor: options.bodyColor ?? palette.body,
    borderColor: options.borderColor ?? palette.accent,
    textColor: options.textColor ?? palette.text,
    activeColor: options.activeColor ?? palette.accent,
    activeTextColor: options.activeTextColor ?? '#020617',
    fontSize: options.fontSize ?? 25,
    borderWidth: options.borderWidth ?? 3,
    action
  }
}

const baseTags = ['touch', 'button-box', 'themed', 'gt3']

const referencePalette: Palette = {
  car: 'Reference',
  body: '#07151b',
  accent: '#22d3ee',
  accent2: '#f59e0b',
  text: '#e6fbff',
  dark: '#05070d',
  tags: ['showcase', 'styles', 'cyan', 'amber']
}

const carPalettes: Palette[] = [
  { car: 'Ferrari', body: '#240707', accent: '#ef1b2d', accent2: '#ffd21f', text: '#fff7ed', dark: '#070405', tags: ['ferrari', 'red', 'yellow'] },
  { car: 'Porsche', body: '#151515', accent: '#f8fafc', accent2: '#d5001c', text: '#ffffff', dark: '#050505', tags: ['porsche', 'white', 'red'] },
  { car: 'Mercedes-AMG', body: '#061719', accent: '#00a19b', accent2: '#d1d5db', text: '#ecfeff', dark: '#030707', tags: ['mercedes-amg', 'amg', 'teal'] },
  { car: 'McLaren', body: '#241006', accent: '#ff8700', accent2: '#22d3ee', text: '#fff7ed', dark: '#070402', tags: ['mclaren', 'papaya'] },
  { car: 'Corvette', body: '#211704', accent: '#ffd200', accent2: '#ef4444', text: '#fffbea', dark: '#060503', tags: ['corvette', 'yellow'] },
  { car: 'Lamborghini', body: '#0f1907', accent: '#7fff00', accent2: '#8b5cf6', text: '#f7ffe8', dark: '#030703', tags: ['lamborghini', 'lime', 'violet'] }
]

function panelTags(palette: Palette, extra: string[]): string[] {
  return [...baseTags, ...palette.tags, ...extra]
}

function themedButtons(palette: Palette): ButtonBoxButtonInput[] {
  return [
    button('PIT', 'rgb', 'pit-sign', palette, key(['P']), { bodyColor: palette.dark, borderColor: palette.accent, fontSize: 30 }),
    button('LIMITER', 'backlit', 'limiter', palette, key(['L'], 'toggle'), { fontSize: 23 }),
    button('TC+', 'toggle', 'settings', palette, key(['PageUp']), { bodyColor: palette.dark, borderColor: palette.accent }),
    button('TC', 'rocker', undefined, palette, key(['PageDown']), { bodyColor: palette.dark, borderColor: palette.accent, fontSize: 30, control: { kind: 'two-position-rocker', negativeAction: key(['PageDown']), positiveAction: key(['PageUp']), negativeLabel: 'TC decrease', positiveLabel: 'TC increase', repeat: { delayMs: 420, intervalMs: 120 } } }),
    button('ABS', 'rotary', 'brake-bias', palette, key([']']), { borderColor: palette.accent2, control: { kind: 'rotary', decrementAction: key(['[']), incrementAction: key([']']), decrementLabel: 'ABS decrease', incrementLabel: 'ABS increase', repeat: { delayMs: 420, intervalMs: 120 } } }),
    button('MAP 1-6', 'selector', 'map', palette, key(['1']), { bodyColor: palette.dark, borderColor: palette.accent2, control: { kind: 'selector', initialChoiceId: 'map-1', choices: [1, 2, 3, 4, 5, 6].map((value) => ({ id: 'map-' + value, label: 'MAP ' + value, value: String(value), action: key([String(value)]) })) } }),
    button('RADIO', 'led_ring', 'radio', palette, key(['V'], 'hold'), { bodyColor: palette.dark, borderColor: palette.accent2 }),
    button('BOOST', 'guarded', 'flash', palette, key(['B']), { bodyColor: '#2a1202', borderColor: palette.accent2 }),
    button('WIPER', 'toggle', 'wiper', palette, key(['W'], 'toggle'), { bodyColor: palette.dark }),
    button('LIGHTS', 'led_ring', 'headlight', palette, key(['H'], 'toggle'), { bodyColor: palette.dark, borderColor: palette.accent2 }),
    button('MARKER', 'backlit', 'mark', palette, key(['M']), { bodyColor: palette.body, borderColor: palette.accent }),
    button('NEUTRAL', 'guarded', 'power', palette, key(['N']), { bodyColor: '#16090b', borderColor: palette.accent2 })
  ]
}

export const TOUCH_PRESETS_THEMED: ButtonBoxPanel[] = [
  createButtonBoxPanel({
    id: 'tp-themed-style-reference',
    name: 'Touch Styles Reference',
    columns: 4,
    rows: 2,
    gap: 14,
    background: '#020407',
    tags: panelTags(referencePalette, ['round', 'momentary', 'toggle', 'rocker', 'rotary', 'led-ring', 'guarded', 'selector']),
    buttons: [
      button('PIT', 'rgb', 'pit-sign', referencePalette, key(['P']), { bodyColor: '#041015', borderColor: '#22d3ee', fontSize: 30 }),
      button('LIMITER', 'backlit', 'limiter', referencePalette, key(['L'], 'toggle'), { bodyColor: '#07151b', borderColor: '#22d3ee', fontSize: 23, control: { kind: 'latching-toggle', onAction: key(['L'], 'toggle'), offAction: key(['L'], 'toggle') } }),
      button('TC+', 'toggle', 'settings', referencePalette, key(['PageUp']), { bodyColor: '#07151b', borderColor: '#22d3ee' }),
      button('TC', 'rocker', undefined, referencePalette, key(['PageDown']), { bodyColor: '#07151b', borderColor: '#22d3ee', fontSize: 32, control: { kind: 'two-position-rocker', negativeAction: key(['PageDown']), positiveAction: key(['PageUp']), negativeLabel: 'TC decrease', positiveLabel: 'TC increase', repeat: { delayMs: 420, intervalMs: 120 } } }),
      button('ABS', 'rotary', 'brake-bias', referencePalette, key([']']), { bodyColor: '#090d12', borderColor: '#22d3ee', control: { kind: 'rotary', decrementAction: key(['[']), incrementAction: key([']']), decrementLabel: 'ABS decrease', incrementLabel: 'ABS increase', repeat: { delayMs: 420, intervalMs: 120 } } }),
      button('RADIO', 'led_ring', 'radio', referencePalette, key(['V'], 'hold'), { bodyColor: '#160d03', borderColor: '#f59e0b' }),
      button('BOOST', 'guarded', 'flash', referencePalette, key(['B']), { bodyColor: '#1a0b02', borderColor: '#f59e0b' }),
      button('MAP 1-6', 'selector', 'map', referencePalette, key(['1']), { bodyColor: '#090d12', borderColor: '#22d3ee', fontSize: 22, control: { kind: 'selector', initialChoiceId: 'map-1', choices: [1, 2, 3, 4, 5, 6].map((value) => ({ id: 'map-' + value, label: 'MAP ' + value, value: String(value), action: key([String(value)]) })) } })
    ]
  }),
  ...carPalettes.map((palette) =>
    createButtonBoxPanel({
      id: `tp-themed-${palette.car.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: `${palette.car} GT Touch Box`,
      columns: 4,
      rows: 3,
      gap: 12,
      background: palette.dark,
      tags: panelTags(palette, ['car', 'race', 'pit', 'tc', 'abs', 'map', 'radio']),
      buttons: themedButtons(palette)
    })
  )
]
