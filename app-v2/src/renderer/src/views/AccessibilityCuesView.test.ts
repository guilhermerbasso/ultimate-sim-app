// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { within } from '@testing-library/dom'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CUE_MODALITIES } from '../../../shared/accessibility-cues'
import type { AppViewProps } from '../App'
import AccessibilityCuesView from './AccessibilityCuesView'

function renderViewMarkup(): string {
  return renderToStaticMarkup(
    createElement(AccessibilityCuesView, {
      connectedDevice: null,
      showToast: vi.fn(),
      language: 'en'
    } as unknown as AppViewProps)
  )
}

function cssRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('AccessibilityCuesView accessibility and preview isolation', () => {
  it('renders keyboard-native controls, semantic regions, and a labelled override table', () => {
    const markup = renderViewMarkup()

    expect(markup).toContain('<h1>Accessibility cue profiles</h1>')
    expect(markup).toContain('<fieldset')
    expect(markup).toContain('<table class="accessibility-cues-table">')
    expect(markup).toContain('aria-describedby="cue-preview-help"')
    expect(markup).toContain('role="note"')
    expect(markup).toContain('The app does not detect or infer disability')
    expect(markup).toContain('do not replace preregistered blind/low-vision')
    expect(markup).toContain('no device command is sent')
    expect(markup).toContain('Loading the persisted profile')
    expect(markup).toContain('<strong>Audio</strong> unavailable')
    expect(markup).toContain('disabled=""')
  })

  it('keeps profile, modality-policy, and preview-event selects native and loading-disabled', () => {
    const host = document.createElement('div')
    host.innerHTML = renderViewMarkup()
    const view = within(host)

    const activeProfile = view.getByRole('combobox', {
      name: 'Active profile'
    }) as HTMLSelectElement
    expect(activeProfile.disabled).toBe(true)
    expect(activeProfile.options.length).toBeGreaterThan(1)

    const policyNames = [
      'Policy for Caption',
      'Policy for Audio',
      'Policy for Text symbol',
      'Policy for LED / OLED',
      'Policy for Haptic'
    ]
    const policySelects = policyNames.map(
      (name) => view.getByRole('combobox', { name }) as HTMLSelectElement
    )
    expect(policySelects).toHaveLength(CUE_MODALITIES.length)
    for (const select of policySelects) {
      expect(select.closest('fieldset')?.hasAttribute('disabled')).toBe(true)
      expect(select.matches(':disabled')).toBe(true)
    }

    const previewEvent = view.getByRole('combobox', {
      name: 'Cue to teach'
    }) as HTMLSelectElement
    expect(previewEvent.disabled).toBe(true)
    expect(previewEvent.options.length).toBeGreaterThan(1)
    expect(view.getAllByRole('combobox')).toHaveLength(CUE_MODALITIES.length + 2)
  })

  it('styles native select text, options, arrow, disabled state, and contrast modes', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/styles/accessibility-cues.css'),
      'utf8'
    )
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/views/AccessibilityCuesView.tsx'),
      'utf8'
    )

    const select = cssRule(css, '.accessibility-cues-view select')
    expect(select).toMatch(/appearance:\s*auto;/)
    expect(select).toMatch(/color-scheme:\s*dark;/)
    expect(select).toMatch(/border:\s*1px solid var\(--border-strong\);/)
    expect(select).toMatch(/background-color:\s*var\(--surface-sunken\);/)
    expect(select).toMatch(/color:\s*var\(--text-primary\);/)
    expect(select).toMatch(/-webkit-text-fill-color:\s*currentColor;/)

    const option = cssRule(css, '.accessibility-cues-view select option')
    expect(option).toMatch(/background-color:\s*var\(--surface-overlay\);/)
    expect(option).toMatch(/color:\s*var\(--text-primary\);/)

    const disabled = cssRule(css, '.accessibility-cues-view select:disabled')
    expect(disabled).toMatch(/opacity:\s*1;/)
    expect(disabled).toMatch(/color:\s*var\(--text-muted\);/)
    expect(disabled).toMatch(/-webkit-text-fill-color:\s*var\(--text-muted\);/)

    const contrastSelect = cssRule(
      css,
      '.accessibility-cues-view[data-high-contrast="true"] select'
    )
    expect(contrastSelect).toMatch(/border-color:\s*#fff;/)
    expect(contrastSelect).toMatch(/background-color:\s*#000;/)
    expect(contrastSelect).toMatch(/color:\s*#fff;/)

    const contrastOption = cssRule(
      css,
      '.accessibility-cues-view[data-high-contrast="true"] select option'
    )
    expect(contrastOption).toMatch(/background-color:\s*#000;/)
    expect(contrastOption).toMatch(/color:\s*#fff;/)

    const contrastDisabled = cssRule(
      css,
      '.accessibility-cues-view[data-high-contrast="true"] select:disabled'
    )
    expect(contrastDisabled).toMatch(/-webkit-text-fill-color:\s*#fff;/)
    expect(css).toContain('@media (forced-colors: active)')
    expect(css).toContain('forced-color-adjust: auto;')
    expect(source).toMatch(
      /className="accessibility-cues-view"\s+data-high-contrast=\{activeProfile\.highContrast/
    )
  })

  it('keeps teach preview code free of direct LED, OLED, and haptic actuation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/views/AccessibilityCuesView.tsx'),
      'utf8'
    )

    expect(source).not.toContain('window.api.send')
    expect(source).not.toContain('playAccessibilityHaptic')
    expect(source).not.toContain('testHapticsEffect')
    expect(source).toContain("source: 'preview'")
    expect(source).toContain("'accessibility-preview'")
    expect(source).toContain('CueProfileMutationQueue')
  })
})
