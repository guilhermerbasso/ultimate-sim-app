// @vitest-environment jsdom

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const setTelemetrySource = vi.fn<(source: string) => Promise<unknown>>()

vi.mock('../lib/telemetry', () => ({
  setTelemetrySource: (source: string) => setTelemetrySource(source)
}))

import { OnboardingFlow } from './OnboardingFlow'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderFlow(): { onNavigate: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onNavigate = vi.fn()
  const onClose = vi.fn()
  render(createElement(OnboardingFlow, { onClose, onNavigate }))
  return { onNavigate, onClose }
}

const demoButton = (): HTMLButtonElement => screen.getByRole('button', { name: /use demo mode/i })

beforeEach(() => {
  window.localStorage.clear()
  setTelemetrySource.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('OnboardingFlow "Use Demo mode"', () => {
  it('waits for setTelemetrySource before leaving the welcome step', async () => {
    const pending = deferred<void>()
    setTelemetrySource.mockReturnValue(pending.promise)

    renderFlow()
    demoButton().click()

    // Still on welcome while the source is being applied.
    await waitFor(() => expect(demoButton().disabled).toBe(true))
    expect(setTelemetrySource).toHaveBeenCalledWith('mock')
    expect(screen.queryByText(/connect sim-x when ready/i)).toBeNull()

    pending.resolve()
    await waitFor(() => expect(screen.getByText(/connect sim-x when ready/i)).toBeTruthy())
  })

  it('stays on the welcome step and shows the failure when the source cannot be applied', async () => {
    setTelemetrySource.mockRejectedValue(new Error('mock provider unavailable'))

    renderFlow()
    demoButton().click()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('mock provider unavailable')
    // The demo step must not silently advance past the failure.
    expect(screen.queryByText(/connect sim-x when ready/i)).toBeNull()
    expect(demoButton().disabled).toBe(false)
  })

  it('does not start a second attempt while one is in flight', async () => {
    const pending = deferred<void>()
    setTelemetrySource.mockReturnValue(pending.promise)

    renderFlow()
    demoButton().click()
    await waitFor(() => expect(demoButton().disabled).toBe(true))
    demoButton().click()

    expect(setTelemetrySource).toHaveBeenCalledTimes(1)
    pending.resolve()
    await waitFor(() => expect(screen.getByText(/connect sim-x when ready/i)).toBeTruthy())
  })
})
