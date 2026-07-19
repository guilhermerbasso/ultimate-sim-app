// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MQTT_LOCAL_CONFIG, MQTT_CHANNELS } from '../../../shared/mqtt'
import { MqttSetupPanel } from './MqttSetupPanel'

async function defaultInvoke(channel: string): Promise<unknown> {
  if (channel === MQTT_CHANNELS.getConfig) return DEFAULT_MQTT_LOCAL_CONFIG
  if (channel === MQTT_CHANNELS.status) return null
  if (channel === MQTT_CHANNELS.contract) return null
  return null
}

const invoke = vi.fn(defaultInvoke)

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation(defaultInvoke)
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: { invoke, subscribe: vi.fn(() => () => {}) }
  })
})

afterEach(cleanup)

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
    expect(markup).toContain('No cloud URL or user-supplied credential is accepted')
    expect(markup).toContain('pattern="[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?"')
    expect(markup).not.toMatch(/type="password"|name="password"|cloud broker/i)
  })

  it('renders bracketed IPv6 fallback endpoints when the saved host is ::1', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === MQTT_CHANNELS.getConfig) {
        return { ...DEFAULT_MQTT_LOCAL_CONFIG, host: '::1' as const }
      }
      if (channel === MQTT_CHANNELS.status) return null
      if (channel === MQTT_CHANNELS.contract) return null
      return null
    })

    render(createElement(MqttSetupPanel, { language: 'en', showToast: vi.fn() }))

    await waitFor(() => {
      expect(screen.getByText(/mqtt:\/\/\[::1\]:1883/i)).toBeTruthy()
      expect(screen.getByText(/mqtt:\/\/\[::1\]:1884/i)).toBeTruthy()
      expect(screen.getByText(/mqtt:\/\/\[::1\]:1885/i)).toBeTruthy()
    })
  })
})
