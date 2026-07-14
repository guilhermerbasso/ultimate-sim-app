import { EXPR_CHANNELS } from '../shared/expr'

export const READ_ONLY_EXPRESSION_CHANNELS = new Set<string>([
  EXPR_CHANNELS.getStudio,
  EXPR_CHANNELS.getPlacements,
  EXPR_CHANNELS.getExpressions,
  EXPR_CHANNELS.getEnabledVars,
  EXPR_CHANNELS.getResults,
  EXPR_CHANNELS.results,
  EXPR_CHANNELS.studioChanged
])

const OVERLAY_PREFIXES = [
  'telemetry:',
  'overlays:',
  'fuel:',
  'lap:',
  'alerts:',
  'outputs:',
  'trackmap:',
  'coach:',
  'predictions:',
  'tire:',
  'teamfuel:'
]

const OVERLAY_APP_CHANNELS = new Set([
  'app:getSettings',
  'app:settingsChanged',
  'app:dash:get',
  'app:dash:updated',
  'app:dash:cycle',
  'app:dash:cycleControl',
  'app:dash:cycleControl:get',
  'app:dash:close'
])

const TOUCH_EXACT_CHANNELS = new Set<string>([
  'iracing:command',
  'actions:testEmulation',
  'app:getSettings',
  'app:settingsChanged',
  'app:dash:cycle',
  'oled:setActivePage',
  'overlays:toggle',
  ...READ_ONLY_EXPRESSION_CHANNELS
])

export function isOverlayIpcAllowed(channel: string): boolean {
  return (
    READ_ONLY_EXPRESSION_CHANNELS.has(channel) ||
    OVERLAY_APP_CHANNELS.has(channel) ||
    OVERLAY_PREFIXES.some((prefix) => channel.startsWith(prefix))
  )
}

export function isTouchpanelIpcAllowed(channel: string): boolean {
  return TOUCH_EXACT_CHANNELS.has(channel) || channel.startsWith('app:touchpanel:')
}
