// @vitest-environment jsdom

import { createElement, type ReactElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tt, type ResolvedLanguage } from '../i18n'
import { OVERLAY_EDITOR_PREVIEW_CHANNELS } from '../../../shared/overlay-editor-preview'
import {
  EDITOR_TRIGGER_PREVIEW_STORAGE_KEY
} from '../overlay/editor-trigger-preview'
import {
  TriggerPreviewToggle,
  useEditorTriggerPreviewPreference,
  useOverlayPositioningPreviewChannel
} from './TriggerPreviewToggle'

function Harness(): ReactElement {
  const [active, setActive] = useEditorTriggerPreviewPreference()
  return createElement(TriggerPreviewToggle, {
    checked: active,
    onChange: setActive,
    language: 'en'
  })
}

function PositioningChannelHarness({ active }: { active: boolean }): null {
  useOverlayPositioningPreviewChannel(active)
  return null
}

describe('TriggerPreviewToggle', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('has an accessible localized label and persists without IPC or broadcasts', () => {
    const invoke = vi.fn()
    const subscribe = vi.fn()
    const broadcast = vi.spyOn(window, 'dispatchEvent')
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: { invoke, subscribe }
    })

    const view = render(createElement(Harness))
    const toggle = screen.getByRole('checkbox', {
      name: 'Show trigger-only items active'
    }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(screen.getByText(/Editor and positioning preview only/)).toBeTruthy()

    fireEvent.click(toggle)
    expect(toggle.checked).toBe(false)
    expect(
      window.localStorage.getItem(EDITOR_TRIGGER_PREVIEW_STORAGE_KEY)
    ).toBe('false')
    expect(invoke).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()

    view.unmount()
    render(createElement(Harness))
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Show trigger-only items active'
        }) as HTMLInputElement
      ).checked
    ).toBe(false)
  })

  it('ships labels and editor-only help for every supported language', () => {
    const languages: ResolvedLanguage[] = [
      'en',
      'pt-BR',
      'es',
      'fr',
      'de',
      'zh',
      'ja'
    ]
    for (const language of languages) {
      expect(tt(language, 'triggerPreview.label')).not.toBe('triggerPreview.label')
      expect(tt(language, 'triggerPreview.help')).not.toBe('triggerPreview.help')
      expect(tt(language, 'triggerPreview.help').length).toBeGreaterThan(20)
    }
  })

  it('publishes the preference only through the isolated positioning preview channel', async () => {
    const invoke = vi.fn(async (_channel: string, _active: boolean) => true)
    Object.defineProperty(window, 'ipc', {
      configurable: true,
      value: { invoke, subscribe: vi.fn() }
    })

    const view = render(
      createElement(PositioningChannelHarness, { active: true })
    )
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        OVERLAY_EDITOR_PREVIEW_CHANNELS.setActive,
        true
      )
    })

    view.rerender(
      createElement(PositioningChannelHarness, { active: false })
    )
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        OVERLAY_EDITOR_PREVIEW_CHANNELS.setActive,
        false
      )
    })
    view.unmount()
    expect(
      invoke.mock.calls.every(
        ([channel]) => channel === OVERLAY_EDITOR_PREVIEW_CHANNELS.setActive
      )
    ).toBe(true)
  })
})
