import { describe, expect, it } from 'vitest'
import { EXPR_CHANNELS } from '../shared/expr'
import { STREAM_PRESENTATION_CHANNELS } from '../shared/stream-presentation'
import { STREAM_SOURCE_CHANNELS } from '../shared/stream-sources'
import { STREAMING_CHANNELS } from '../shared/streaming'
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

describe('exact Passport channel rejection boundaries', () => {
  it.each([
    ['prefix', `x${STINT_PASSPORT_CHANNELS.getSnapshot}`],
    ['suffix', `${STINT_PASSPORT_CHANNELS.getSnapshot}:extra`],
    ['case', STINT_PASSPORT_CHANNELS.getSnapshot.toUpperCase()],
    ['leading whitespace', ` ${STINT_PASSPORT_CHANNELS.getSnapshot}`],
    ['trailing whitespace', `${STINT_PASSPORT_CHANNELS.getSnapshot} `],
    ['NUL', `${STINT_PASSPORT_CHANNELS.getSnapshot}\0`],
    ['Cyrillic confusable', STINT_PASSPORT_CHANNELS.getSnapshot.replace('o', '\u043e')],
    ['full-width confusable', STINT_PASSPORT_CHANNELS.getSnapshot.replace(':', '\uff1a')],
    ['prototype name', '__proto__'],
    ['constructor name', 'constructor']
  ])('rejects an invoke channel with a %s mutation', (_case, channel) => {
    expect(channel).not.toBe(STINT_PASSPORT_CHANNELS.getSnapshot)
    expect(isMainPassportInvokeAllowed(channel)).toBe(false)
    expect(isMainPassportSubscribeAllowed(channel)).toBe(false)
  })

  it('rejects boxed, coercible, and prototype-inherited channel objects', () => {
    const coercion = {
      toString: () => STINT_PASSPORT_CHANNELS.getSnapshot,
      valueOf: () => STINT_PASSPORT_CHANNELS.getSnapshot
    }
    const inherited = Object.create({
      channel: STINT_PASSPORT_CHANNELS.getSnapshot
    })

    for (const channel of [
      new String(STINT_PASSPORT_CHANNELS.getSnapshot),
      coercion,
      inherited
    ]) {
      expect(isMainPassportInvokeAllowed(channel as unknown as string)).toBe(false)
      expect(isMainPassportSubscribeAllowed(channel as unknown as string)).toBe(false)
    }
  })

  it('keeps invoke and subscribe authority disjoint from each other and restricted windows', () => {
    const overlap = [...MAIN_PASSPORT_INVOKE_CHANNELS].filter((channel) =>
      MAIN_PASSPORT_SUBSCRIBE_CHANNELS.has(channel)
    )
    expect(overlap).toEqual([])

    for (const channel of [
      ...MAIN_PASSPORT_INVOKE_CHANNELS,
      ...MAIN_PASSPORT_SUBSCRIBE_CHANNELS
    ]) {
      expect(isOverlayIpcAllowed(channel), channel).toBe(false)
      expect(isTouchpanelIpcAllowed(channel), channel).toBe(false)
    }
  })

  it('exposes only the bounded authenticated import endpoint to the main window', () => {
    expect(isMainPassportInvokeAllowed(STINT_PASSPORT_CHANNELS.importPackage)).toBe(true)
    expect(isMainPassportSubscribeAllowed(STINT_PASSPORT_CHANNELS.importPackage)).toBe(false)
    expect(isOverlayIpcAllowed(STINT_PASSPORT_CHANNELS.importPackage)).toBe(false)
    expect(isTouchpanelIpcAllowed(STINT_PASSPORT_CHANNELS.importPackage)).toBe(false)
    for (const channel of [
      'stintPassport:import',
      'stintPassport:replayPackage',
      'stintPassport:importN1'
    ]) {
      expect(isMainPassportInvokeAllowed(channel), channel).toBe(false)
      expect(isMainPassportSubscribeAllowed(channel), channel).toBe(false)
      expect(isOverlayIpcAllowed(channel), channel).toBe(false)
      expect(isTouchpanelIpcAllowed(channel), channel).toBe(false)
    }
  })
})

describe('restricted renderer streaming mutation boundaries', () => {
  it('denies existing streaming mutations to overlay and touch-panel windows', () => {
    const mutationChannels = [
      STREAMING_CHANNELS.start,
      STREAMING_CHANNELS.stop,
      STREAMING_CHANNELS.startTunnel,
      STREAMING_CHANNELS.stopTunnel,
      STREAMING_CHANNELS.rotateReceiverPairing,
      STREAM_PRESENTATION_CHANNELS.save,
      STREAM_PRESENTATION_CHANNELS.delete,
      STREAM_PRESENTATION_CHANNELS.refreshTarget,
      STREAM_SOURCE_CHANNELS.add,
      STREAM_SOURCE_CHANNELS.remove,
      'app:setSettings'
    ]

    for (const channel of mutationChannels) {
      expect(isOverlayIpcAllowed(channel), channel).toBe(false)
      expect(isTouchpanelIpcAllowed(channel), channel).toBe(false)
    }
  })

  it('does not expose the source-management catalog or mutations to viewer windows', () => {
    for (const channel of Object.values(STREAM_SOURCE_CHANNELS)) {
      expect(isOverlayIpcAllowed(channel), channel).toBe(false)
      expect(isTouchpanelIpcAllowed(channel), channel).toBe(false)
    }
  })
})
