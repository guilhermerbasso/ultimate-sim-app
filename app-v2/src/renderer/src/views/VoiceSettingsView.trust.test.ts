import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PiperVoiceInfo } from '../../../shared/spotter'
import type { AppViewProps } from '../App'
import VoiceSettingsView, {
  piperVoiceNetworkActionSupported,
  piperVoiceUnavailableMessage
} from './VoiceSettingsView'

function voice(
  patch: Partial<PiperVoiceInfo> = {}
): PiperVoiceInfo {
  return {
    id: 'en_US-lessac-medium',
    name: 'Lessac',
    lang: 'en-US',
    quality: 'medium',
    installed: false,
    downloadSupported: false,
    repairSupported: false,
    unavailableReason: 'Trusted manifest unavailable for this voice.',
    ...patch
  }
}

describe('VoiceSettingsView trust gating', () => {
  it('disables unsupported network actions and exposes the trust reason', () => {
    expect(piperVoiceNetworkActionSupported(voice())).toBe(false)
    expect(
      piperVoiceNetworkActionSupported(
        voice({ downloadSupported: true })
      )
    ).toBe(true)
    expect(piperVoiceUnavailableMessage(voice())).toMatch(
      /Trusted manifest unavailable/
    )
  })

  it('renders unavailable catalog voices without enabled download/test actions', () => {
    const markup = renderToStaticMarkup(
      createElement(VoiceSettingsView, {
        connectedDevice: null,
        showToast: () => undefined,
        language: 'en'
      } as unknown as AppViewProps)
    )

    expect(markup).toContain('Trusted manifest unavailable')
    expect(markup).toContain('Trusted manifest unavailable</button>')
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*>Test voice<\/button>/
    )
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*>Trusted manifest unavailable<\/button>/
    )
  })
})
