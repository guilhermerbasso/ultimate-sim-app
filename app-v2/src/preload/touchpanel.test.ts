import { describe, expect, it } from 'vitest'
import { EXPR_CHANNELS } from '../shared/expr'
import { TOUCH_ACTION_IPC_CHANNEL } from '../shared/touch-panel'
import { isTouchpanelIpcAllowed } from './ipc-allowlists'

describe('touch panel preload least privilege', () => {
  it('allows one semantic action boundary and read-only expression results', () => {
    expect(isTouchpanelIpcAllowed(TOUCH_ACTION_IPC_CHANNEL)).toBe(true)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.getResults)).toBe(true)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.results)).toBe(true)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.getExpressions)).toBe(false)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.setExpressions)).toBe(false)
  })

  it('rejects every raw generic or feature-specific action channel', () => {
    for (const channel of [
      'iracing:command',
      'actions:testEmulation',
      'actions:touchKeyboardHold',
      'app:dash:cycle',
      'oled:setActivePage',
      'overlays:toggle',
      'actions:trigger',
      'actions:setBindings',
      'gamepad:connect'
    ]) {
      expect(isTouchpanelIpcAllowed(channel), channel).toBe(false)
    }
  })

  it('allows only exact panel read/close/update channels', () => {
    expect(isTouchpanelIpcAllowed('app:touchpanel:get')).toBe(true)
    expect(isTouchpanelIpcAllowed('app:touchpanel:close')).toBe(true)
    expect(isTouchpanelIpcAllowed('app:touchpanel:updated')).toBe(true)
    expect(isTouchpanelIpcAllowed('app:touchpanel:delete')).toBe(false)
  })
})