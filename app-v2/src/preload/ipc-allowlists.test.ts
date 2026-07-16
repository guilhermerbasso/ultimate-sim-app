import { describe, expect, it } from 'vitest'
import { EXPR_CHANNELS } from '../shared/expr'
import { TOUCH_ACTION_IPC_CHANNEL } from '../shared/touch-panel'
import { STINT_PASSPORT_CHANNELS } from '../shared/stint-passport'
import {
  MAIN_PASSPORT_INVOKE_CHANNELS,
  MAIN_PASSPORT_SUBSCRIBE_CHANNELS,
  READ_ONLY_EXPRESSION_CHANNELS,
  TOUCH_READ_ONLY_EXPRESSION_CHANNELS,
  isMainPassportInvokeAllowed,
  isMainPassportSubscribeAllowed,
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

  it('exposes only the dedicated semantic Touch action channel', () => {
    expect(isTouchpanelIpcAllowed(TOUCH_ACTION_IPC_CHANNEL)).toBe(true)
    expect(isTouchpanelIpcAllowed('iracing:command')).toBe(false)
    expect(isTouchpanelIpcAllowed('actions:testEmulation')).toBe(false)
    expect(isTouchpanelIpcAllowed('actions:touchKeyboardHold')).toBe(false)
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

  it('grants Passport IPC by exact channel and direction only', () => {
    expect(MAIN_PASSPORT_SUBSCRIBE_CHANNELS).toEqual(new Set([STINT_PASSPORT_CHANNELS.updated]))
    for (const channel of Object.values(STINT_PASSPORT_CHANNELS)) {
      if (channel === STINT_PASSPORT_CHANNELS.updated) {
        expect(isMainPassportInvokeAllowed(channel)).toBe(false)
        expect(isMainPassportSubscribeAllowed(channel)).toBe(true)
      } else {
        expect(MAIN_PASSPORT_INVOKE_CHANNELS.has(channel), channel).toBe(true)
        expect(isMainPassportInvokeAllowed(channel), channel).toBe(true)
        expect(isMainPassportSubscribeAllowed(channel), channel).toBe(false)
      }
    }
    expect(isMainPassportInvokeAllowed('stintPassport:any-future-command')).toBe(false)
    expect(isMainPassportSubscribeAllowed('stintPassport:any-future-event')).toBe(false)
    expect(isOverlayIpcAllowed(STINT_PASSPORT_CHANNELS.getSnapshot)).toBe(false)
    expect(isTouchpanelIpcAllowed(STINT_PASSPORT_CHANNELS.completeChallenge)).toBe(false)
  })
})
