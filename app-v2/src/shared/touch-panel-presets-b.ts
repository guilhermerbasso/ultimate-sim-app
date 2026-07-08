import { createButtonBoxPanel, type ButtonBoxPanel } from './touch-panel'

export const TOUCH_PRESETS_B: ButtonBoxPanel[] = [
  createButtonBoxPanel({
    id: 'tp-b-camera-replay',
    name: 'Camera & Replay',
    columns: 4,
    rows: 3,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'CAM-', material: 'glass', icon: 'camera-prev', bodyColor: '#312e81', borderColor: '#a78bfa', textColor: '#f5f3ff', action: { kind: 'iracing', command: { group: 'camera', name: 'camera:previous' } } },
      { label: 'CAM+', material: 'glass', icon: 'camera-next', bodyColor: '#4c1d95', borderColor: '#c084fc', textColor: '#faf5ff', action: { kind: 'iracing', command: { group: 'camera', name: 'camera:next' } } },
      { label: 'BB-', material: 'backlit', icon: 'monitor', bodyColor: '#581c87', borderColor: '#d946ef', textColor: '#fdf4ff', action: { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:previous' } } },
      { label: 'BB+', material: 'backlit', icon: 'monitor', bodyColor: '#701a75', borderColor: '#f0abfc', textColor: '#fdf4ff', action: { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:next' } } },
      { label: 'REPLAY', material: 'solid', icon: 'replay', bodyColor: '#86198f', borderColor: '#f472b6', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'press', keys: ['R'] } } },
      { label: 'PAUSE', material: 'solid', icon: 'replay', bodyColor: '#9d174d', borderColor: '#fb7185', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'press', keys: ['Space'] } } },
      { label: 'RW', material: 'backlit', icon: 'camera-prev', bodyColor: '#831843', borderColor: '#f9a8d4', textColor: '#fdf2f8', action: { kind: 'keyboard', command: { mode: 'press', keys: ['ArrowLeft'] } } },
      { label: 'FF', material: 'backlit', icon: 'camera-next', bodyColor: '#be185d', borderColor: '#f472b6', textColor: '#fdf2f8', action: { kind: 'keyboard', command: { mode: 'press', keys: ['ArrowRight'] } } },
      { label: 'CAM 1', material: 'carbon', icon: 'camera', bodyColor: '#1e1b4b', borderColor: '#818cf8', textColor: '#eef2ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['1'] } } },
      { label: 'CAM 2', material: 'carbon', icon: 'camera', bodyColor: '#3730a3', borderColor: '#a78bfa', textColor: '#eef2ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['2'] } } },
      { label: 'CAM 3', material: 'carbon', icon: 'camera', bodyColor: '#6b21a8', borderColor: '#d8b4fe', textColor: '#faf5ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['3'] } } },
      { label: 'GG', material: 'glass', icon: 'good-race', bodyColor: '#db2777', borderColor: '#f9a8d4', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'press', keys: ['G'] } } }
    ]
  }),
  createButtonBoxPanel({
    id: 'tp-b-flags-marshal',
    name: 'Flags / Marshal',
    columns: 4,
    rows: 3,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'YELLOW', material: 'solid', icon: 'yellow-flag', bodyColor: '#ca8a04', borderColor: '#fde047', textColor: '#111827', action: { kind: 'keyboard', command: { mode: 'press', keys: ['Y'] } } },
      { label: 'BLUE', material: 'solid', icon: 'flag', bodyColor: '#1d4ed8', borderColor: '#93c5fd', textColor: '#eff6ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['B'] } } },
      { label: 'PASS L', material: 'backlit', icon: 'pass-left', bodyColor: '#0369a1', borderColor: '#7dd3fc', textColor: '#f0f9ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['ArrowLeft'] } } },
      { label: 'PASS R', material: 'backlit', icon: 'pass-right', bodyColor: '#075985', borderColor: '#38bdf8', textColor: '#f0f9ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['ArrowRight'] } } },
      { label: 'HORN', material: 'guarded', icon: 'horn', bodyColor: '#b91c1c', borderColor: '#fecaca', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'press', keys: ['H'] } } },
      { label: 'MARK', material: 'carbon', icon: 'mark', bodyColor: '#374151', borderColor: '#e5e7eb', textColor: '#f9fafb', action: { kind: 'keyboard', command: { mode: 'press', keys: ['M'] } } },
      { label: 'RADIO', material: 'toggle', icon: 'radio', bodyColor: '#0f766e', borderColor: '#5eead4', textColor: '#f0fdfa', action: { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } } },
      { label: 'GG', material: 'glass', icon: 'good-race', bodyColor: '#15803d', borderColor: '#86efac', textColor: '#f0fdf4', action: { kind: 'keyboard', command: { mode: 'press', keys: ['G'] } } },
      { label: 'THUMBS', material: 'glass', icon: 'good-race', bodyColor: '#f8fafc', borderColor: '#ffffff', textColor: '#0f172a', action: { kind: 'keyboard', command: { mode: 'press', keys: ['T'] } } },
      { label: 'BLACK', material: 'led_status', icon: 'flag', bodyColor: '#111827', borderColor: '#f8fafc', textColor: '#f9fafb', action: { kind: 'none' } },
      { label: 'WHITE', material: 'led_status', icon: 'flag', bodyColor: '#f8fafc', borderColor: '#cbd5e1', textColor: '#0f172a', action: { kind: 'none' } },
      { label: 'GREEN', material: 'led_status', icon: 'flag', bodyColor: '#16a34a', borderColor: '#bbf7d0', textColor: '#052e16', action: { kind: 'none' } }
    ]
  }),
  createButtonBoxPanel({
    id: 'tp-b-full-wheel-deck',
    name: 'Wheel Deck Completo',
    columns: 5,
    rows: 4,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'ENGINE', material: 'guarded', icon: 'power', bodyColor: '#991b1b', borderColor: '#fca5a5', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'toggle', keys: ['I'] } } },
      { label: 'TOW', material: 'guarded', icon: 'pit-sign', bodyColor: '#7f1d1d', borderColor: '#fecaca', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'press', keys: ['T'] } } },
      { label: 'DMG', material: 'led_status', icon: 'engine-warn', bodyColor: '#92400e', borderColor: '#fbbf24', textColor: '#fffbeb', action: { kind: 'app', command: { name: 'overlays:toggle', overlayId: 'damage' } } },
      { label: 'DASH-', material: 'backlit', icon: 'dash-prev', bodyColor: '#1e3a8a', borderColor: '#60a5fa', textColor: '#eff6ff', action: { kind: 'app', command: { name: 'dash:cyclePrev' } } },
      { label: 'DASH+', material: 'backlit', icon: 'dash-next', bodyColor: '#1d4ed8', borderColor: '#93c5fd', textColor: '#eff6ff', action: { kind: 'app', command: { name: 'dash:cycleNext' } } },
      { label: 'WIPER', material: 'toggle', icon: 'wiper', bodyColor: '#0f766e', borderColor: '#5eead4', textColor: '#ecfeff', action: { kind: 'keyboard', command: { mode: 'toggle', keys: ['W'] } } },
      { label: 'TEAR', material: 'backlit', icon: 'tear-off', bodyColor: '#0e7490', borderColor: '#67e8f9', textColor: '#ecfeff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['TearOff'] } } },
      { label: 'RESET', material: 'carbon', icon: 'reset', bodyColor: '#334155', borderColor: '#cbd5e1', textColor: '#f8fafc', action: { kind: 'keyboard', command: { mode: 'press', keys: ['Esc'] } } },
      { label: 'LIGHT', material: 'toggle', icon: 'headlight', bodyColor: '#854d0e', borderColor: '#fde68a', textColor: '#fffbeb', action: { kind: 'keyboard', command: { mode: 'toggle', keys: ['L'] } } },
      { label: 'WARNING', material: 'led_status', icon: 'engine-warn', bodyColor: '#b45309', borderColor: '#fbbf24', textColor: '#fffbeb', action: { kind: 'none' } },
      { label: 'FUEL!', material: 'led_status', icon: 'fuel-alarm', bodyColor: '#be123c', borderColor: '#fb7185', textColor: '#fff1f2', action: { kind: 'none' } },
      { label: '+10L', material: 'backlit', icon: 'fuel', bodyColor: '#166534', borderColor: '#86efac', textColor: '#f0fdf4', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 10 } } },
      { label: '+50L', material: 'backlit', icon: 'fuel', bodyColor: '#15803d', borderColor: '#bbf7d0', textColor: '#f0fdf4', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 50 } } },
      { label: 'FULL', material: 'solid', icon: 'fuel', bodyColor: '#22c55e', borderColor: '#dcfce7', textColor: '#052e16', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 200 } } },
      { label: 'MIC', material: 'toggle', icon: 'mic', bodyColor: '#4338ca', borderColor: '#a5b4fc', textColor: '#eef2ff', action: { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } } },
      { label: 'VOL-', material: 'rotary', icon: 'volume-down', bodyColor: '#312e81', borderColor: '#818cf8', textColor: '#eef2ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['VolumeDown'] } } },
      { label: 'VOL+', material: 'rotary', icon: 'volume-up', bodyColor: '#3730a3', borderColor: '#a5b4fc', textColor: '#eef2ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['VolumeUp'] } } },
      { label: 'RADIO', material: 'backlit', icon: 'radio', bodyColor: '#7c3aed', borderColor: '#c4b5fd', textColor: '#f5f3ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['R'] } } },
      { label: 'GG', material: 'glass', icon: 'good-race', bodyColor: '#db2777', borderColor: '#f9a8d4', textColor: '#fdf2f8', action: { kind: 'keyboard', command: { mode: 'press', keys: ['G'] } } },
      { label: 'PIT', material: 'guarded', icon: 'pit-sign', bodyColor: '#ea580c', borderColor: '#fdba74', textColor: '#fff7ed', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:clearAll' } } }
    ]
  }),
  createButtonBoxPanel({
    id: 'tp-b-sprint',
    name: 'Sprint',
    columns: 4,
    rows: 3,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'PIT', material: 'guarded', icon: 'pit-sign', bodyColor: '#c2410c', borderColor: '#fdba74', textColor: '#fff7ed', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:clearAll' } } },
      { label: '+5L', material: 'backlit', icon: 'fuel', bodyColor: '#166534', borderColor: '#86efac', textColor: '#f0fdf4', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 5 } } },
      { label: '+10L', material: 'backlit', icon: 'fuel', bodyColor: '#15803d', borderColor: '#bbf7d0', textColor: '#f0fdf4', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 10 } } },
      { label: 'TEAR', material: 'backlit', icon: 'tear-off', bodyColor: '#0e7490', borderColor: '#67e8f9', textColor: '#ecfeff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['TearOff'] } } },
      { label: 'TC-', material: 'rotary', icon: 'settings', bodyColor: '#1e40af', borderColor: '#93c5fd', textColor: '#eff6ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['PageDown'] } } },
      { label: 'TC+', material: 'rotary', icon: 'settings', bodyColor: '#2563eb', borderColor: '#bfdbfe', textColor: '#eff6ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['PageUp'] } } },
      { label: 'BBAL-', material: 'rotary', icon: 'brake-bias', bodyColor: '#7c2d12', borderColor: '#fdba74', textColor: '#fff7ed', action: { kind: 'keyboard', command: { mode: 'press', keys: ['['] } } },
      { label: 'BBAL+', material: 'rotary', icon: 'brake-bias', bodyColor: '#9a3412', borderColor: '#fed7aa', textColor: '#fff7ed', action: { kind: 'keyboard', command: { mode: 'press', keys: [']'] } } },
      { label: 'CAM', material: 'glass', icon: 'camera-next', bodyColor: '#581c87', borderColor: '#d8b4fe', textColor: '#faf5ff', action: { kind: 'iracing', command: { group: 'camera', name: 'camera:next' } } },
      { label: 'DASH+', material: 'backlit', icon: 'dash-next', bodyColor: '#1d4ed8', borderColor: '#93c5fd', textColor: '#eff6ff', action: { kind: 'app', command: { name: 'dash:cycleNext' } } },
      { label: 'RADIO', material: 'toggle', icon: 'radio', bodyColor: '#0f766e', borderColor: '#5eead4', textColor: '#f0fdfa', action: { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } } },
      { label: 'BB+', material: 'backlit', icon: 'monitor', bodyColor: '#334155', borderColor: '#cbd5e1', textColor: '#f8fafc', action: { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:next' } } }
    ]
  }),
  createButtonBoxPanel({
    id: 'tp-b-oval',
    name: 'Oval',
    columns: 4,
    rows: 2,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'FUEL+', material: 'backlit', icon: 'fuel', bodyColor: '#166534', borderColor: '#86efac', textColor: '#f0fdf4', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 15 } } },
      { label: 'TYRES', material: 'solid', icon: 'tyre', bodyColor: '#0369a1', borderColor: '#7dd3fc', textColor: '#f0f9ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['T'] } } },
      { label: 'TEAR', material: 'backlit', icon: 'tear-off', bodyColor: '#0e7490', borderColor: '#67e8f9', textColor: '#ecfeff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['TearOff'] } } },
      { label: 'BB+', material: 'backlit', icon: 'monitor', bodyColor: '#334155', borderColor: '#cbd5e1', textColor: '#f8fafc', action: { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:next' } } },
      { label: 'CAM', material: 'glass', icon: 'camera-next', bodyColor: '#581c87', borderColor: '#d8b4fe', textColor: '#faf5ff', action: { kind: 'iracing', command: { group: 'camera', name: 'camera:next' } } },
      { label: 'DASH+', material: 'backlit', icon: 'dash-next', bodyColor: '#1d4ed8', borderColor: '#93c5fd', textColor: '#eff6ff', action: { kind: 'app', command: { name: 'dash:cycleNext' } } },
      { label: 'RADIO', material: 'toggle', icon: 'radio', bodyColor: '#0f766e', borderColor: '#5eead4', textColor: '#f0fdfa', action: { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } } },
      { label: 'SPOTTER', material: 'glass', icon: 'mic', bodyColor: '#4338ca', borderColor: '#a5b4fc', textColor: '#eef2ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['S'] } } }
    ]
  }),
  createButtonBoxPanel({
    id: 'tp-b-rally',
    name: 'Rally',
    columns: 3,
    rows: 3,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'WIPER', material: 'toggle', icon: 'wiper', bodyColor: '#0f766e', borderColor: '#5eead4', textColor: '#ecfeff', action: { kind: 'keyboard', command: { mode: 'toggle', keys: ['W'] } } },
      { label: 'LIGHTS', material: 'toggle', icon: 'headlight', bodyColor: '#854d0e', borderColor: '#fde68a', textColor: '#fffbeb', action: { kind: 'keyboard', command: { mode: 'toggle', keys: ['L'] } } },
      { label: 'NOTES', material: 'backlit', icon: 'dash', bodyColor: '#1e3a8a', borderColor: '#93c5fd', textColor: '#eff6ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['N'] } } },
      { label: 'DIFF', material: 'rotary', icon: 'settings', bodyColor: '#4c1d95', borderColor: '#c084fc', textColor: '#faf5ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['D'] } } },
      { label: 'H-BRAKE', material: 'guarded', icon: 'brake-bias', bodyColor: '#991b1b', borderColor: '#fca5a5', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'hold', keys: ['Space'] } } },
      { label: 'RESET', material: 'carbon', icon: 'reset', bodyColor: '#334155', borderColor: '#cbd5e1', textColor: '#f8fafc', action: { kind: 'keyboard', command: { mode: 'press', keys: ['Esc'] } } },
      { label: 'RADIO', material: 'toggle', icon: 'radio', bodyColor: '#0f766e', borderColor: '#5eead4', textColor: '#f0fdfa', action: { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } } },
      { label: 'DASH', material: 'backlit', icon: 'dash-next', bodyColor: '#1d4ed8', borderColor: '#93c5fd', textColor: '#eff6ff', action: { kind: 'app', command: { name: 'dash:cycleNext' } } },
      { label: 'MARK', material: 'carbon', icon: 'mark', bodyColor: '#374151', borderColor: '#e5e7eb', textColor: '#f9fafb', action: { kind: 'keyboard', command: { mode: 'press', keys: ['M'] } } }
    ]
  }),
  createButtonBoxPanel({
    id: 'tp-b-minimal-2x2',
    name: 'Minimal 2×2',
    columns: 2,
    rows: 2,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'PIT', material: 'guarded', icon: 'pit-sign', bodyColor: '#c2410c', borderColor: '#fdba74', textColor: '#fff7ed', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:clearAll' } } },
      { label: 'FUEL+', material: 'backlit', icon: 'fuel', bodyColor: '#166534', borderColor: '#86efac', textColor: '#f0fdf4', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 10 } } },
      { label: 'TEAR', material: 'backlit', icon: 'tear-off', bodyColor: '#0e7490', borderColor: '#67e8f9', textColor: '#ecfeff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['TearOff'] } } },
      { label: 'CAM', material: 'glass', icon: 'camera-next', bodyColor: '#581c87', borderColor: '#d8b4fe', textColor: '#faf5ff', action: { kind: 'iracing', command: { group: 'camera', name: 'camera:next' } } }
    ]
  }),
  createButtonBoxPanel({
    id: 'tp-b-minimal-3x2',
    name: 'Minimal 3×2',
    columns: 3,
    rows: 2,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'PIT', material: 'guarded', icon: 'pit-sign', bodyColor: '#c2410c', borderColor: '#fdba74', textColor: '#fff7ed', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:clearAll' } } },
      { label: 'FUEL+', material: 'backlit', icon: 'fuel', bodyColor: '#166534', borderColor: '#86efac', textColor: '#f0fdf4', action: { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 10 } } },
      { label: 'TEAR', material: 'backlit', icon: 'tear-off', bodyColor: '#0e7490', borderColor: '#67e8f9', textColor: '#ecfeff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['TearOff'] } } },
      { label: 'CAM', material: 'glass', icon: 'camera-next', bodyColor: '#581c87', borderColor: '#d8b4fe', textColor: '#faf5ff', action: { kind: 'iracing', command: { group: 'camera', name: 'camera:next' } } },
      { label: 'DASH+', material: 'backlit', icon: 'dash-next', bodyColor: '#1d4ed8', borderColor: '#93c5fd', textColor: '#eff6ff', action: { kind: 'app', command: { name: 'dash:cycleNext' } } },
      { label: 'RADIO', material: 'toggle', icon: 'radio', bodyColor: '#0f766e', borderColor: '#5eead4', textColor: '#f0fdfa', action: { kind: 'keyboard', command: { mode: 'hold', keys: ['V'] } } }
    ]
  }),
  createButtonBoxPanel({
    id: 'tp-b-camera-pro',
    name: 'Pro Camera',
    columns: 3,
    rows: 3,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'CAM-', material: 'glass', icon: 'camera-prev', bodyColor: '#312e81', borderColor: '#a78bfa', textColor: '#f5f3ff', action: { kind: 'iracing', command: { group: 'camera', name: 'camera:previous' } } },
      { label: 'CAM+', material: 'glass', icon: 'camera-next', bodyColor: '#4c1d95', borderColor: '#c084fc', textColor: '#faf5ff', action: { kind: 'iracing', command: { group: 'camera', name: 'camera:next' } } },
      { label: 'COCKPIT', material: 'carbon', icon: 'camera', bodyColor: '#1e1b4b', borderColor: '#818cf8', textColor: '#eef2ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['1'] } } },
      { label: 'TV1', material: 'backlit', icon: 'monitor', bodyColor: '#3730a3', borderColor: '#a78bfa', textColor: '#eef2ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['2'] } } },
      { label: 'TV2', material: 'backlit', icon: 'monitor', bodyColor: '#6b21a8', borderColor: '#d8b4fe', textColor: '#faf5ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['3'] } } },
      { label: 'CHASE', material: 'backlit', icon: 'camera', bodyColor: '#86198f', borderColor: '#f0abfc', textColor: '#fdf4ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['4'] } } },
      { label: 'BB-', material: 'backlit', icon: 'monitor', bodyColor: '#581c87', borderColor: '#d946ef', textColor: '#fdf4ff', action: { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:previous' } } },
      { label: 'BB+', material: 'backlit', icon: 'monitor', bodyColor: '#701a75', borderColor: '#f0abfc', textColor: '#fdf4ff', action: { kind: 'iracing', command: { group: 'blackBox', name: 'blackBox:next' } } },
      { label: 'OVERLAY', material: 'glass', icon: 'overlay', bodyColor: '#db2777', borderColor: '#f9a8d4', textColor: '#fff1f2', action: { kind: 'app', command: { name: 'overlays:toggle', overlayId: 'camera' } } }
    ]
  }),
  createButtonBoxPanel({
    id: 'tp-b-replay-control',
    name: 'Replay Control',
    columns: 3,
    rows: 3,
    gap: 12,
    background: '#05070d',
    buttons: [
      { label: 'REPLAY', material: 'solid', icon: 'replay', bodyColor: '#86198f', borderColor: '#f472b6', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'press', keys: ['R'] } } },
      { label: 'PAUSE', material: 'solid', icon: 'replay', bodyColor: '#9d174d', borderColor: '#fb7185', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'press', keys: ['Space'] } } },
      { label: 'LIVE', material: 'glass', icon: 'monitor', bodyColor: '#1d4ed8', borderColor: '#93c5fd', textColor: '#eff6ff', action: { kind: 'keyboard', command: { mode: 'press', keys: ['L'] } } },
      { label: 'RW', material: 'backlit', icon: 'camera-prev', bodyColor: '#831843', borderColor: '#f9a8d4', textColor: '#fdf2f8', action: { kind: 'keyboard', command: { mode: 'press', keys: ['ArrowLeft'] } } },
      { label: 'SLOW', material: 'rotary', icon: 'replay', bodyColor: '#be185d', borderColor: '#f472b6', textColor: '#fdf2f8', action: { kind: 'keyboard', command: { mode: 'press', keys: ['S'] } } },
      { label: 'FF', material: 'backlit', icon: 'camera-next', bodyColor: '#be185d', borderColor: '#f472b6', textColor: '#fdf2f8', action: { kind: 'keyboard', command: { mode: 'press', keys: ['ArrowRight'] } } },
      { label: 'MARK', material: 'carbon', icon: 'mark', bodyColor: '#374151', borderColor: '#e5e7eb', textColor: '#f9fafb', action: { kind: 'keyboard', command: { mode: 'press', keys: ['M'] } } },
      { label: 'CAM+', material: 'glass', icon: 'camera-next', bodyColor: '#4c1d95', borderColor: '#c084fc', textColor: '#faf5ff', action: { kind: 'iracing', command: { group: 'camera', name: 'camera:next' } } },
      { label: 'GG', material: 'glass', icon: 'good-race', bodyColor: '#db2777', borderColor: '#f9a8d4', textColor: '#fff1f2', action: { kind: 'keyboard', command: { mode: 'press', keys: ['G'] } } }
    ]
  })
]
