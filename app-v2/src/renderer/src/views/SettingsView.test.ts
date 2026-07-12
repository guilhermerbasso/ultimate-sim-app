import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { AppViewProps } from '../App'
import SettingsView from './SettingsView'

describe('SettingsView full-profile import containment', () => {
  it('renders an inaccessible full-import control with localized accessible guidance', () => {
    const markup = renderToStaticMarkup(createElement(SettingsView, {
      showToast: vi.fn(),
      language: 'en'
    } as unknown as AppViewProps))
    const importButton = markup.match(/<button[^>]*aria-describedby="full-profile-import-disabled"[^>]*>[\s\S]*?<\/button>/)?.[0]

    expect(importButton).toContain('disabled=""')
    expect(importButton).toContain('Import profile')
    expect(markup).toContain('id="full-profile-import-disabled"')
    expect(markup).toContain('temporarily unavailable to protect your existing configuration')

    const source = readFileSync(new URL('./SettingsView.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('CONFIG_IO_CHANNELS.importAll')
  })
})
