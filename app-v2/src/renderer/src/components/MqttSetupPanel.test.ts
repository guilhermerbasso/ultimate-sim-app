import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MqttSetupPanel } from './MqttSetupPanel'

describe('MqttSetupPanel', () => {
  it('renders the disabled loopback safety posture without credential controls', () => {
    const markup = renderToStaticMarkup(
      createElement(MqttSetupPanel, {
        language: 'en',
        showToast: vi.fn()
      })
    )

    expect(markup).toContain('MQTT pit-wall bridge')
    expect(markup).toContain('127.0.0.1')
    expect(markup).toContain('Default off')
    expect(markup).toContain('No cloud URL or credential is accepted')
    expect(markup).not.toMatch(/type="password"|name="password"|cloud broker/i)
  })
})
