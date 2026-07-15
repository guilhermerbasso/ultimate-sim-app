import {
  createButtonBoxButton,
  type ButtonAction,
  type ButtonBoxButton,
  type ButtonBoxButtonInput,
  type KeyMaterial
} from './touch-panel'

export interface TouchButtonGroup {
  id: string
  label: string
  buttons: ButtonBoxButton[]
}

let paletteIndex = 0

function button(partial: ButtonBoxButtonInput): ButtonBoxButton {
  return createButtonBoxButton(partial, paletteIndex++)
}

function key(
  id: string,
  label: string,
  material: KeyMaterial,
  icon: string | undefined,
  bodyColor: string,
  borderColor: string,
  fontSize: number,
  action: ButtonAction,
  textColor = '#f8fafc',
  borderWidth = 2
): ButtonBoxButton {
  return button({
    id,
    label,
    material,
    icon,
    bodyColor,
    borderColor,
    textColor,
    borderWidth,
    fontSize,
    action
  })
}

const none = { kind: 'none' } as const
const keyboard = (mode: 'press' | 'chord' | 'sequence' | 'hold' | 'toggle' | 'repeat', keys: string[]) =>
  ({ kind: 'keyboard', command: { mode, keys } }) as const
const iracing = (
  group: 'pit' | 'camera' | 'blackBox',
  name:
    | 'pit:addFuel'
    | 'pit:clearFuel'
    | 'pit:toggleTyreLf'
    | 'pit:toggleTyreRf'
    | 'pit:toggleTyreLr'
    | 'pit:toggleTyreRr'
    | 'pit:fastRepair'
    | 'pit:clearAll'
    | 'camera:next'
    | 'camera:previous'
    | 'blackBox:next'
    | 'blackBox:previous',
  fuelLiters?: number
) => ({ kind: 'iracing', command: fuelLiters === undefined ? { group, name } : { group, name, fuelLiters } }) as const
const app = (
  name: 'oled:setActivePage' | 'overlays:toggle' | 'dash:cycleNext' | 'dash:cyclePrev',
  options: { pageIndex?: number; overlayId?: string } = {}
) => ({ kind: 'app', command: { name, ...options } }) as const

export const TOUCH_BUTTON_CATALOG: TouchButtonGroup[] = [
  {
    id: 'system',
    label: 'System',
    buttons: [
      key('tb-system-engine-start', 'START', 'guarded', 'power', '#dc2626', '#f87171', 30, keyboard('toggle', ['i'])),
      key('tb-system-kill-leds', 'KILL', 'guarded', 'engine-warn', '#991b1b', '#f87171', 30, keyboard('press', ['k'])),
      key('tb-system-esc', 'ESC', 'backlit', 'esc', '#7f1d1d', '#f87171', 28, keyboard('press', ['escape'])),
      key('tb-system-reset', 'RESET', 'backlit', 'reset', '#0891b2', '#22d3ee', 26, keyboard('press', ['r'])),
      key('tb-system-mark', 'MARK', 'backlit', 'mark', '#0891b2', '#22d3ee', 26, keyboard('press', ['m'])),
      key('tb-system-delta', 'DELTA', 'rotary', 'delta', '#0e7490', '#67e8f9', 24, keyboard('press', ['d'])),
      button({ id: 'tb-system-settings', label: 'SESSION', material: 'glass', shape: 'status', icon: 'settings', bodyColor: '#334155', borderColor: '#94a3b8', textColor: '#f8fafc', fontSize: 22, borderWidth: 2, control: { kind: 'value-tile', value: 'READY' } })
    ]
  },
  {
    id: 'pit-fuel',
    label: 'Pit & Fuel',
    buttons: [
      key('tb-pit-fuel-pit-request', 'PIT REQ', 'toggle', 'pit-sign', '#ca8a04', '#facc15', 24, keyboard('toggle', ['p'])),
      key('tb-pit-fuel-fuel-plus-5', 'FUEL +5', 'backlit', 'fuel', '#ca8a04', '#facc15', 24, iracing('pit', 'pit:addFuel', 5)),
      key('tb-pit-fuel-fuel-plus-10', 'FUEL +10', 'backlit', 'fuel', '#ca8a04', '#facc15', 24, iracing('pit', 'pit:addFuel', 10)),
      key('tb-pit-fuel-fuel-25l', 'FUEL 25L', 'solid', undefined, '#ea580c', '#fb923c', 23, iracing('pit', 'pit:addFuel', 25)),
      key('tb-pit-fuel-fuel-50l', 'FUEL 50L', 'solid', undefined, '#ea580c', '#fb923c', 23, iracing('pit', 'pit:addFuel', 50)),
      key('tb-pit-fuel-clear', 'FUEL CLR', 'backlit', 'fuel-alarm', '#92400e', '#facc15', 22, iracing('pit', 'pit:clearFuel')),
      key('tb-pit-fuel-fast-repair', 'REPAIR', 'backlit', 'fast-repair', '#ea580c', '#fb923c', 24, iracing('pit', 'pit:fastRepair')),
      key('tb-pit-fuel-tear-off', 'TEAR OFF', 'backlit', 'tear-off', '#ca8a04', '#facc15', 22, keyboard('press', ['space'])),
      key('tb-pit-fuel-limiter', 'LIMITER', 'toggle', 'limiter', '#ea580c', '#fb923c', 22, keyboard('toggle', ['l']))
    ]
  },
  {
    id: 'tyres',
    label: 'Tyres',
    buttons: [
      key('tb-tyres-lf', 'TYRE LF', 'backlit', 'tyre', '#1d4ed8', '#60a5fa', 23, iracing('pit', 'pit:toggleTyreLf')),
      key('tb-tyres-rf', 'TYRE RF', 'backlit', 'tyre', '#1d4ed8', '#60a5fa', 23, iracing('pit', 'pit:toggleTyreRf')),
      key('tb-tyres-lr', 'TYRE LR', 'backlit', 'tyre', '#0891b2', '#22d3ee', 23, iracing('pit', 'pit:toggleTyreLr')),
      key('tb-tyres-rr', 'TYRE RR', 'backlit', 'tyre', '#0891b2', '#22d3ee', 23, iracing('pit', 'pit:toggleTyreRr')),
      key('tb-tyres-all', 'ALL TYRES', 'solid', 'tyre', '#1e40af', '#93c5fd', 22, keyboard('sequence', ['lf', 'rf', 'lr', 'rr'])),
      key('tb-tyres-cold', 'COLD PSI', 'led_status', 'cold', '#0369a1', '#7dd3fc', 22, none),
      key('tb-tyres-wet', 'WET SET', 'backlit', 'wet', '#0e7490', '#22d3ee', 22, keyboard('press', ['w'])),
      key('tb-tyres-clear-all', 'PIT CLR', 'backlit', 'reset', '#334155', '#94a3b8', 22, iracing('pit', 'pit:clearAll'))
    ]
  },
  {
    id: 'brakes-tc',
    label: 'Brakes, TC & ABS',
    buttons: [
      key('tb-brakes-tc-bb-plus', 'BB +', 'rotary', 'brake-bias', '#dc2626', '#f87171', 28, keyboard('press', [']'])),
      key('tb-brakes-tc-bb-minus', 'BB -', 'rotary', 'brake-bias', '#dc2626', '#f87171', 28, keyboard('press', ['['])),
      key('tb-brakes-tc-tc-plus', 'TC +', 'backlit', undefined, '#ea580c', '#fb923c', 30, keyboard('press', ['+'])),
      key('tb-brakes-tc-tc-minus', 'TC -', 'backlit', undefined, '#ea580c', '#fb923c', 30, keyboard('press', ['-'])),
      key('tb-brakes-tc-tc2-plus', 'TC2 +', 'backlit', undefined, '#c2410c', '#fed7aa', 28, keyboard('press', ['shift', '+'])),
      key('tb-brakes-tc-tc2-minus', 'TC2 -', 'backlit', undefined, '#c2410c', '#fed7aa', 28, keyboard('press', ['shift', '-'])),
      key('tb-brakes-tc-abs-plus', 'ABS +', 'backlit', undefined, '#dc2626', '#f87171', 28, keyboard('press', ['='])),
      key('tb-brakes-tc-abs-minus', 'ABS -', 'backlit', undefined, '#dc2626', '#f87171', 28, keyboard('press', ['_'])),
      key('tb-brakes-tc-diff', 'DIFF', 'rotary', 'settings', '#ea580c', '#fb923c', 28, keyboard('press', ['f']))
    ]
  },
  {
    id: 'lights-wipers',
    label: 'Lights & Wipers',
    buttons: [
      key('tb-lights-wipers-headlight', 'LIGHTS', 'toggle', 'headlight', '#ca8a04', '#facc15', 24, keyboard('toggle', ['h'])),
      key('tb-lights-wipers-highbeam', 'HIGH', 'toggle', 'highbeam', '#e5e7eb', '#ffffff', 28, keyboard('toggle', ['j']), '#111827'),
      key('tb-lights-wipers-wiper', 'WIPER', 'toggle', 'wiper', '#0891b2', '#22d3ee', 26, keyboard('toggle', ['v'])),
      key('tb-lights-wipers-rain-light', 'RAIN', 'toggle', 'rain', '#ca8a04', '#facc15', 28, keyboard('toggle', ['n'])),
      key('tb-lights-wipers-flash', 'FLASH', 'backlit', 'headlight', '#facc15', '#ffffff', 28, keyboard('repeat', ['h']), '#111827'),
      key('tb-lights-wipers-wet', 'WET', 'led_status', 'wet', '#0e7490', '#22d3ee', 30, none)
    ]
  },
  {
    id: 'radio-audio',
    label: 'Radio & Audio',
    buttons: [
      key('tb-radio-audio-ptt', 'RADIO', 'toggle', 'radio', '#16a34a', '#4ade80', 26, keyboard('hold', ['t'])),
      key('tb-radio-audio-mic', 'MIC', 'backlit', 'mic', '#15803d', '#86efac', 30, keyboard('toggle', ['m'])),
      key('tb-radio-audio-mic-mute', 'MUTE MIC', 'toggle', 'mic-mute', '#166534', '#4ade80', 22, keyboard('toggle', ['ctrl', 'm'])),
      key('tb-radio-audio-volume-up', 'VOL +', 'rotary', 'volume-up', '#16a34a', '#4ade80', 28, keyboard('press', ['volumeup'])),
      key('tb-radio-audio-volume-down', 'VOL -', 'rotary', 'volume-down', '#16a34a', '#4ade80', 28, keyboard('press', ['volumedown'])),
      key('tb-radio-audio-mute', 'MUTE', 'backlit', 'mute', '#14532d', '#86efac', 28, keyboard('toggle', ['volumemute']))
    ]
  },
  {
    id: 'camera-replay',
    label: 'Camera & Replay',
    buttons: [
      key('tb-camera-replay-cam-next', 'CAM +', 'backlit', 'camera-next', '#9333ea', '#c084fc', 28, iracing('camera', 'camera:next')),
      key('tb-camera-replay-cam-prev', 'CAM -', 'backlit', 'camera-prev', '#9333ea', '#c084fc', 28, iracing('camera', 'camera:previous')),
      key('tb-camera-replay-bb-next', 'BOX +', 'rotary', 'dash-next', '#7e22ce', '#d8b4fe', 28, iracing('blackBox', 'blackBox:next')),
      key('tb-camera-replay-bb-prev', 'BOX -', 'rotary', 'dash-prev', '#7e22ce', '#d8b4fe', 28, iracing('blackBox', 'blackBox:previous')),
      key('tb-camera-replay-replay', 'REPLAY', 'glass', 'replay', '#9333ea', '#c084fc', 24, keyboard('press', ['r'])),
      key('tb-camera-replay-monitor', 'MONITOR', 'glass', 'monitor', '#6d28d9', '#c084fc', 22, none)
    ]
  },
  {
    id: 'flags-marshal',
    label: 'Flags & Marshal',
    buttons: [
      key('tb-flags-marshal-yellow', 'YELLOW', 'led_status', 'yellow-flag', '#facc15', '#ffffff', 24, none, '#111827'),
      key('tb-flags-marshal-blue', 'BLUE', 'led_status', 'flag', '#3b82f6', '#93c5fd', 28, none),
      key('tb-flags-marshal-pass-left', 'PASS L', 'backlit', 'pass-left', '#f8fafc', '#ffffff', 24, keyboard('press', ['left']), '#111827'),
      key('tb-flags-marshal-pass-right', 'PASS R', 'backlit', 'pass-right', '#f8fafc', '#ffffff', 24, keyboard('press', ['right']), '#111827'),
      key('tb-flags-marshal-horn', 'HORN', 'backlit', 'horn', '#facc15', '#ffffff', 28, keyboard('press', ['b']), '#111827'),
      key('tb-flags-marshal-good-race', 'GG', 'glass', 'good-race', '#16a34a', '#4ade80', 34, keyboard('press', ['g']))
    ]
  },
  {
    id: 'dash-overlay',
    label: 'Dash & Overlay',
    buttons: [
      key('tb-dash-overlay-dash-next', 'DASH +', 'rotary', 'dash-next', '#0891b2', '#22d3ee', 26, app('dash:cycleNext')),
      key('tb-dash-overlay-dash-prev', 'DASH -', 'rotary', 'dash-prev', '#0891b2', '#22d3ee', 26, app('dash:cyclePrev')),
      key('tb-dash-overlay-toggle', 'OVERLAY', 'toggle', 'overlay', '#db2777', '#f472b6', 22, app('overlays:toggle', { overlayId: 'race' })),
      key('tb-dash-overlay-map', 'MAP', 'backlit', 'map', '#0e7490', '#67e8f9', 30, app('overlays:toggle', { overlayId: 'track-map' })),
      key('tb-dash-overlay-oled-1', 'OLED 1', 'glass', 'dash', '#0891b2', '#22d3ee', 24, app('oled:setActivePage', { pageIndex: 0 })),
      key('tb-dash-overlay-oled-2', 'OLED 2', 'glass', 'dash', '#db2777', '#f472b6', 24, app('oled:setActivePage', { pageIndex: 1 }))
    ]
  }
]

export const ALL_TOUCH_BUTTONS: ButtonBoxButton[] = TOUCH_BUTTON_CATALOG.flatMap(g => g.buttons)
