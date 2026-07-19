// @vitest-environment jsdom
import { createElement } from 'react'
import { fireEvent, cleanup, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createStreamPresentationProfile,
  type StreamPresentationTargetDescriptor
} from '../../../shared/stream-presentation'
import { createButtonBoxPanel, type ButtonAction } from '../../../shared/touch-panel'
import { StreamPresentationRenderer } from './StreamPresentationRenderer'

afterEach(cleanup)

const noAction: ButtonAction = { kind: 'none' }
const target: StreamPresentationTargetDescriptor = {
  kind: 'touch',
  id: 'pit',
  name: 'Pit controls',
  revision: 'touch:1:2x1:2',
  itemCount: 2,
  hidden: false
}

function fixture() {
  const profile = createStreamPresentationProfile(target, {
    id: 'stream-profile-pit',
    presetId: 'android-phone',
    now: 10
  })
  profile.settings.visibilityOverrides = [{ elementId: 'hidden', visible: false }]
  profile.settings.minimumTouchTarget = 52
  const panel = createButtonBoxPanel({
    id: 'pit',
    name: 'Pit controls',
    columns: 2,
    rows: 1,
    buttons: [
      {
        id: 'limiter',
        label: 'LIMITER',
        control: { kind: 'latching-toggle', onAction: noAction, offAction: noAction }
      },
      {
        id: 'hidden',
        label: 'HIDDEN',
        control: { kind: 'momentary', action: noAction }
      }
    ]
  })
  return { profile, panel }
}

function signature(html: string): string {
  const match = html.match(/data-presentation-signature="([^"]+)"/)
  if (!match) throw new Error('missing presentation signature')
  return match[1]
}

describe('stream presentation renderer parity', () => {
  it('uses the same resolved viewport, safe area, visibility, and touch size in preview and runtime', () => {
    const { profile, panel } = fixture()
    const preview = renderToStaticMarkup(createElement(StreamPresentationRenderer, {
      profile,
      touchPanel: panel,
      mode: 'preview',
      interactiveTouch: true
    }))
    const runtime = renderToStaticMarkup(createElement(StreamPresentationRenderer, {
      profile,
      touchPanel: panel,
      mode: 'runtime',
      interactiveTouch: false
    }))

    expect(signature(preview)).toBe(signature(runtime))
    expect(preview).toContain('data-viewport="412x915"')
    expect(runtime).toContain('data-viewport="412x915"')
    expect(preview).toContain('data-hidden-control="hidden"')
    expect(runtime).toContain('data-hidden-control="hidden"')
    expect(preview).toContain('data-minimum-touch-target="52"')
    expect(runtime).toContain('data-minimum-touch-target="52"')
  })

  it('simulates touch state locally without invoking a network or IPC command', () => {
    const { profile, panel } = fixture()
    const invoke = vi.fn()
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: { invoke, subscribe: vi.fn(() => () => undefined) }
    })
    render(createElement(StreamPresentationRenderer, {
      profile,
      touchPanel: panel,
      mode: 'preview',
      interactiveTouch: true
    }))
    const limiter = screen.getByRole('button', { name: /limiter/i })

    expect(limiter.getAttribute('aria-pressed')).toBe('false')
    fireEvent.keyDown(limiter, { key: 'Enter' })
    fireEvent.keyUp(limiter, { key: 'Enter' })
    expect(limiter.getAttribute('aria-pressed')).toBe('true')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('forwards runtime touch actions when an authenticated receiver enables interaction', () => {
    const { profile, panel } = fixture()
    const limiter = panel.buttons.find((button) => button.id === 'limiter')
    if (!limiter || limiter.control.kind !== 'latching-toggle') throw new Error('limiter fixture missing')
    limiter.control.onAction = { kind: 'keyboard', command: { mode: 'press', keys: ['L'] } }
    limiter.control.offAction = { kind: 'keyboard', command: { mode: 'press', keys: ['O'] } }
    const onTouchAction = vi.fn().mockResolvedValue({ ok: true })
    render(createElement(StreamPresentationRenderer, {
      profile,
      touchPanel: panel,
      mode: 'runtime',
      interactiveTouch: true,
      onTouchAction,
      reportTouchLifecycle: true
    }))

    const control = screen.getByRole('button', { name: /limiter/i })
    fireEvent.keyDown(control, { key: 'Enter' })
    fireEvent.keyUp(control, { key: 'Enter' })
    expect(onTouchAction).toHaveBeenCalledWith(expect.objectContaining({
      button: expect.objectContaining({ id: 'limiter' }),
      phase: 'trigger',
      zone: 'on'
    }))
  })
})
