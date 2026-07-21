import { EXPR_CHANNELS } from '../shared/expr'
import { TOUCH_ACTION_IPC_CHANNEL } from '../shared/touch-panel'
import { STINT_PASSPORT_CHANNELS } from '../shared/stint-passport'

export const READ_ONLY_EXPRESSION_CHANNELS = new Set<string>([
  EXPR_CHANNELS.getStudio,
  EXPR_CHANNELS.getPlacements,
  EXPR_CHANNELS.getExpressions,
  EXPR_CHANNELS.getEnabledVars,
  EXPR_CHANNELS.getResults,
  EXPR_CHANNELS.results,
  EXPR_CHANNELS.studioChanged
])

export const TOUCH_READ_ONLY_EXPRESSION_CHANNELS = new Set<string>([
  EXPR_CHANNELS.getResults,
  EXPR_CHANNELS.results
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
  TOUCH_ACTION_IPC_CHANNEL,
  'app:touchpanel:get',
  'app:touchpanel:close',
  'app:touchpanel:updated',
  ...TOUCH_READ_ONLY_EXPRESSION_CHANNELS
])

export const MAIN_PASSPORT_INVOKE_CHANNELS = new Set<string>(
  Object.values(STINT_PASSPORT_CHANNELS).filter(
    (channel) => channel !== STINT_PASSPORT_CHANNELS.updated
  )
)
export const MAIN_PASSPORT_SUBSCRIBE_CHANNELS = new Set<string>([
  STINT_PASSPORT_CHANNELS.updated
])

export function isOverlayIpcAllowed(channel: string): boolean {
  return (
    READ_ONLY_EXPRESSION_CHANNELS.has(channel) ||
    OVERLAY_APP_CHANNELS.has(channel) ||
    OVERLAY_PREFIXES.some((prefix) => channel.startsWith(prefix))
  )
}

export function isTouchpanelIpcAllowed(channel: string): boolean {
  return TOUCH_EXACT_CHANNELS.has(channel)
}

export function isMainPassportInvokeAllowed(channel: string): boolean {
  return MAIN_PASSPORT_INVOKE_CHANNELS.has(channel)
}

export function isMainPassportSubscribeAllowed(channel: string): boolean {
  return MAIN_PASSPORT_SUBSCRIBE_CHANNELS.has(channel)
}
