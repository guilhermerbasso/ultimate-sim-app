import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { AppViewProps } from '../App'
import AccessibilityCuesView from './AccessibilityCuesView'

describe('AccessibilityCuesView accessibility and preview isolation', () => {
  it('renders keyboard-native controls, semantic regions, and a labelled override table', () => {
    const markup = renderToStaticMarkup(
      createElement(AccessibilityCuesView, {
        connectedDevice: null,
        showToast: vi.fn(),
        language: 'en'
      } as unknown as AppViewProps)
    )

    expect(markup).toContain('<h1>Accessibility cue profiles</h1>')
    expect(markup).toContain('<fieldset>')
    expect(markup).toContain('<table class="accessibility-cues-table">')
    expect(markup).toContain('aria-describedby="cue-preview-help"')
    expect(markup).toContain('role="note"')
    expect(markup).toContain('The app does not detect or infer disability')
    expect(markup).toContain('do not replace preregistered blind/low-vision')
    expect(markup).toContain('No device command is sent')
  })

  it('keeps teach preview code free of direct LED, OLED, and haptic actuation', () => {
    const source = readFileSync(
      new URL('./AccessibilityCuesView.tsx', import.meta.url),
      'utf8'
    )

    expect(source).not.toContain('window.api.send')
    expect(source).not.toContain('playAccessibilityHaptic')
    expect(source).not.toContain('testHapticsEffect')
    expect(source).toContain("source: 'preview'")
  })
})
