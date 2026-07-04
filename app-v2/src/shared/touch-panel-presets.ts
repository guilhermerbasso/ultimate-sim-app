import type { ButtonBoxPanel, ButtonBoxSummary } from './touch-panel'
import { summarizeButtonBoxPanel } from './touch-panel'
import { TOUCH_PRESETS_A } from './touch-panel-presets-a'
import { TOUCH_PRESETS_B } from './touch-panel-presets-b'

// Curated, ready-to-use touch-panel presets (like BUILTIN_PRESETS for dashboards).
// A user can open any of these fullscreen on a touch screen or add it to the dashboard
// playlist. Assembled from the two generation groups (A: pit/fuel/tyre/brake/endurance,
// B: camera/flags/full-deck/sprint/oval/rally/minimal).

export const TOUCH_PANEL_PRESETS: ReadonlyArray<ButtonBoxPanel> = [...TOUCH_PRESETS_A, ...TOUCH_PRESETS_B]

export const TOUCH_PANEL_PRESET_SUMMARIES: ReadonlyArray<ButtonBoxSummary> =
  TOUCH_PANEL_PRESETS.map(summarizeButtonBoxPanel)

/** Deep-clone a preset with fresh ids so it can be saved as the user's own panel. */
export function findTouchPreset(id: string): ButtonBoxPanel | undefined {
  return TOUCH_PANEL_PRESETS.find((p) => p.id === id)
}
