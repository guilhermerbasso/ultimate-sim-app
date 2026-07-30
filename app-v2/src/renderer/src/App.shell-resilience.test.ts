// @vitest-environment jsdom

import { createElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_APP_SETTINGS } from '../../shared/settings'

const invoke = vi.fn(async (_channel: string) => undefined as unknown)
const subscribe = vi.fn(() => () => {})

function ExplodingView(): ReactElement {
  throw new Error('telemetry view exploded')
}

function CalmView(): ReactElement {
  return createElement('p', null, 'fuel view content')
}

// Background runtimes the shell starts on mount. None is under test here, and
// their bridges are not mocked, so stub the hooks that would otherwise poll.
vi.mock('./lib/action-runtime', () => ({ useGlobalActionRuntime: () => {} }))
vi.mock('./lib/engineer-action-runtime', () => ({ useEngineerActionRuntime: () => {} }))
vi.mock('./lib/spotter-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSpotterRuntime: () => {}
}))
vi.mock('./lib/tts-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTtsRuntime: () => {},
  speakViaTts: () => {}
}))

vi.mock('./views/registry', () => ({
  viewRegistry: [
    {
      id: 'telemetry',
      label: 'Telemetry',
      group: 'Live',
      eyebrow: 'Sim',
      description: 'Live telemetry source and overview.',
      Component: ExplodingView
    },
    {
      id: 'fuel',
      label: 'Fuel',
      group: 'Strategy',
      eyebrow: 'Strategy',
      description: 'Fuel calculation and strategy.',
      Component: CalmView
    }
  ]
}))

import App from './App'
import { DeviceRegistryProvider } from './lib/devices/DeviceRegistry'
import { UnitSystemProvider } from './lib/units'

const renderApp = (): void => {
  render(
    createElement(
      UnitSystemProvider,
      null,
      createElement(DeviceRegistryProvider, null, createElement(App))
    )
  )
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem('usa.onboardingCompleted', 'true')
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string) =>
    channel === 'app:getSettings' ? { ...DEFAULT_APP_SETTINGS } : ({} as unknown)
  )
  subscribe.mockReset()
  subscribe.mockReturnValue(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.defineProperty(window, 'ipc', {
    value: { invoke, subscribe, on: subscribe, send: vi.fn() },
    configurable: true,
    writable: true
  })
  // The shell touches many preload bridges on mount; none of them is under test
  // here. Answer every call with a value that is both awaitable and callable, so
  // `await api.getStatus()` and `const off = api.onConnection(cb)` both work.
  const bridgeResult = (): unknown => {
    const value = ((): void => {}) as unknown as Record<string, unknown>
    value.then = (onOk: (v: unknown) => unknown) => {
      onOk(undefined)
      return bridgeResult()
    }
    value.catch = () => bridgeResult()
    value.finally = (cb: () => void) => {
      cb()
      return bridgeResult()
    }
    return value
  }
  Object.defineProperty(window, 'api', {
    value: new Proxy({}, { get: () => () => bridgeResult() }),
    configurable: true,
    writable: true
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App shell resilience', () => {
  it('keeps navigation usable when the active view throws during render', async () => {
    renderApp()

    // The failing view is replaced by a recovery panel...
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('telemetry view exploded')

    // ...while the shell around it survives: navigation is still rendered and
    // still offers every other screen.
    const nav = screen.getByRole('navigation')
    expect(nav).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Fuel$/ })).toBeTruthy())
  })

  it('recovers when the user navigates to a healthy view', async () => {
    renderApp()
    await screen.findByRole('alert')

    screen.getByRole('button', { name: /^Fuel$/ }).click()

    await waitFor(() => expect(screen.getByText('fuel view content')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
