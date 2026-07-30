import type { KeyMaterial } from '../../../shared/touch-panel'

// Maps a key material to its CSS modifier class. The heavy visual treatment lives
// in buttonbox.css (`.bb-mat-<material>`); every material derives its colour from
// the per-button `--bb-body` / `--bb-border` custom properties set by the renderer.

export function materialClass(material: KeyMaterial): string {
  return `bb-mat-${material}`
}

/** English labels for the editor's material dropdown. */
export const MATERIAL_LABELS: Record<KeyMaterial, string> = {
  backlit: 'Backlit RGB',
  solid: 'Solid neon (solid fill)',
  glass: 'Glass',
  carbon: 'Carbon fiber',
  toggle: 'Toggle switch',
  rotary: 'Rotary (knob/encoder)',
  selector: 'Selector (multi-position)',
  rgb: 'RGB halo (round button)',
  rocker: 'Rocker (+ / −)',
  led_ring: 'LED-ring button',
  led_status: 'LED status',
  guarded: 'Guarded (emergency)'
}

/** Short one-line description shown under the dropdown. */
export const MATERIAL_HINTS: Record<KeyMaterial, string> = {
  backlit: 'Dark face + neon edge glow — physical button-box look.',
  solid: 'Solid fill in the body color (original look).',
  glass: 'Translucent glass with specular shine.',
  carbon: 'Carbon-fiber weave with neon accent.',
  toggle: 'Physical switch with illuminated position.',
  rotary: 'Rotary knob with indicator.',
  selector: 'Multi-position rotary/selector with track and arrows.',
  rgb: 'Round button with RGB/color halo.',
  rocker: 'Horizontal plus/minus rocker with a lit pressed side.',
  led_ring: 'Illuminated push button with a bright LED ring.',
  led_status: 'On/off LED indicator with small label.',
  guarded: 'Red safety cover (start/kill).'
}

/** Ordered list for the editor picker. */
export const MATERIAL_OPTIONS: ReadonlyArray<{ value: KeyMaterial; label: string; hint: string }> = (
  ['backlit', 'solid', 'glass', 'carbon', 'toggle', 'rocker', 'rotary', 'selector', 'rgb', 'led_ring', 'led_status', 'guarded'] as KeyMaterial[]
).map((m) => ({ value: m, label: MATERIAL_LABELS[m], hint: MATERIAL_HINTS[m] }))
