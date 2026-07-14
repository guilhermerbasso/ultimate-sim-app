import { describe, expect, it } from 'vitest'
import { EXPR_CHANNELS } from '../shared/expr'
import {
  READ_ONLY_EXPRESSION_CHANNELS,
  TOUCH_READ_ONLY_EXPRESSION_CHANNELS,
  isOverlayIpcAllowed,
  isTouchpanelIpcAllowed
} from './ipc-allowlists'

describe('restricted renderer expression IPC allowlists', () => {
  it('allows only read/result expression channels in overlay windows', () => {
    for (const channel of READ_ONLY_EXPRESSION_CHANNELS) {
      expect(isOverlayIpcAllowed(channel), channel).toBe(true)
    }
    expect(isOverlayIpcAllowed(EXPR_CHANNELS.mutateStudio)).toBe(false)
    expect(isOverlayIpcAllowed(EXPR_CHANNELS.setExpressions)).toBe(false)
    expect(isOverlayIpcAllowed(EXPR_CHANNELS.setEnabledVars)).toBe(false)
    expect(isOverlayIpcAllowed('expr:any-future-setter')).toBe(false)
  })

  it('limits touch windows to expression results and no definitions or setters', () => {
    for (const channel of TOUCH_READ_ONLY_EXPRESSION_CHANNELS) {
      expect(isTouchpanelIpcAllowed(channel), channel).toBe(true)
    }
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.getStudio)).toBe(false)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.getPlacements)).toBe(false)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.getExpressions)).toBe(false)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.getEnabledVars)).toBe(false)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.studioChanged)).toBe(false)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.mutateStudio)).toBe(false)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.setExpressions)).toBe(false)
    expect(isTouchpanelIpcAllowed(EXPR_CHANNELS.setEnabledVars)).toBe(false)
  })
})
