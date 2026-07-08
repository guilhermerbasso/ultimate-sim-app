import type { KeyMaterial } from '../../../shared/touch-panel'

// Maps a key material to its CSS modifier class. The heavy visual treatment lives
// in buttonbox.css (`.bb-mat-<material>`); every material derives its colour from
// the per-button `--bb-body` / `--bb-border` custom properties set by the renderer.

export function materialClass(material: KeyMaterial): string {
  return `bb-mat-${material}`
}

/** PT-BR labels for the editor's material dropdown. */
export const MATERIAL_LABELS: Record<KeyMaterial, string> = {
  backlit: 'Backlit RGB (retroiluminado)',
  solid: 'Solid neon (fill sólido)',
  glass: 'Glass (vidro)',
  carbon: 'Carbon (fibra)',
  toggle: 'Toggle (interruptor)',
  rotary: 'Rotary (knob/encoder)',
  selector: 'Selector (multi-posição)',
  rgb: 'RGB halo (botão redondo)',
  led_status: 'LED status',
  guarded: 'Guarded (emergência)'
}

/** Short one-line description shown under the dropdown. */
export const MATERIAL_HINTS: Record<KeyMaterial, string> = {
  backlit: 'Face escura + glow neon na borda — visual de button-box físico.',
  solid: 'Preenchimento sólido na cor do corpo (visual original).',
  glass: 'Vidro translúcido com brilho especular.',
  carbon: 'Trama de fibra de carbono com acento neon.',
  toggle: 'Interruptor físico com posição iluminada.',
  rotary: 'Knob rotativo com indicador.',
  selector: 'Rotary/selector multi-posição com trilho e setas.',
  rgb: 'Botão redondo com halo RGB/colorido.',
  led_status: 'Indicador LED on/off com rótulo pequeno.',
  guarded: 'Tampa de segurança vermelha (start/kill).'
}

/** Ordered list for the editor picker. */
export const MATERIAL_OPTIONS: ReadonlyArray<{ value: KeyMaterial; label: string; hint: string }> = (
  ['backlit', 'solid', 'glass', 'carbon', 'toggle', 'rotary', 'selector', 'rgb', 'led_status', 'guarded'] as KeyMaterial[]
).map((m) => ({ value: m, label: MATERIAL_LABELS[m], hint: MATERIAL_HINTS[m] }))
