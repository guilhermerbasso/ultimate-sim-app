import { describe, expect, it } from 'vitest'
import { EXPR_CHANNELS } from '../shared/expr'
import { isTouchpanelIpcAllowed } from './ipc-allowlists'

describe('touch panel preload least privilege', () => {
  it('allows only exact hold and read-only expression channels', () => {
    expect(isTouchpanelIpcAllowed('actions:touchKeyboardHold')).toBe(true)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.getResults)).toBe(true)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.results)).toBe(true)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.getExpressions)).toBe(false)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.setExpressions)).toBe(false)
  })

  it('does not grant the mutable touchpanel prefix or any gamepad API', () => {
    expect(isTouchpanelIpcAllowed('app:touchpanel:get')).toBe(true)
    expect(isTouchpanelIpcAllowed('app:touchpanel:close')).toBe(true)
    expect(isTouchpanelIpcAllowed('app:touchpanel:updated')).toBe(true)
    expect(isTouchpanelIpcAllowed('app:touchpanel:delete')).toBe(false)
    expect(isTouchpanelIpcAllowed('gamepad:connect')).toBe(false)
    expect(isTouchpanelIpcAllowed('actions:trigger')).toBe(false)
    expect(isTouchpanelIpcAllowed('actions:setBindings')).toBe(false)
  })
})
