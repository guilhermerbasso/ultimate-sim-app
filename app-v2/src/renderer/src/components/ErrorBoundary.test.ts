// @vitest-environment jsdom

import { createElement, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'
import { ErrorRecoveryPanel } from './ErrorRecoveryPanel'

const invoke = vi.fn()

function Boom({ explode }: { explode: boolean }): ReactElement {
  if (explode) throw new Error('view exploded')
  return createElement('p', null, 'view content')
}

function renderBoundary(props: { explode: boolean; resetKey?: string; scope?: string }): void {
  render(
    createElement(ErrorBoundary, {
      scope: props.scope ?? 'telemetry',
      resetKey: props.resetKey,
      fallback: (fallbackProps) =>
        createElement(ErrorRecoveryPanel, {
          ...fallbackProps,
          variant: 'view',
          title: 'Telemetry could not be displayed',
          detail: 'The rest of the app is still running.'
        }),
      children: createElement(Boom, { explode: props.explode })
    })
  )
}

beforeEach(() => {
  invoke.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.defineProperty(window, 'ipc', { value: { invoke }, configurable: true, writable: true })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    renderBoundary({ explode: false })
    expect(screen.getByText('view content')).toBeTruthy()
  })

  it('replaces only the failing subtree with a recovery panel', () => {
    renderBoundary({ explode: true })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Telemetry could not be displayed')
    expect(alert.textContent).toContain('view exploded')
    expect(screen.queryByText('view content')).toBeNull()
  })

  it('offers a retry and a diagnostic export from the error state', () => {
    renderBoundary({ explode: true })
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /export diagnostics/i })).toBeTruthy()
  })

  it('exports a diagnostic bundle and reports where it was saved', async () => {
    invoke.mockResolvedValue({ ok: true, bundlePath: 'C:/logs/bundle.zip' })
    renderBoundary({ explode: true })

    screen.getByRole('button', { name: /export diagnostics/i }).click()

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('C:/logs/bundle.zip'))
    expect(invoke).toHaveBeenCalledWith('bug:report')
  })

  it('reports a failed diagnostic export instead of throwing', async () => {
    invoke.mockResolvedValue({ ok: false, message: 'log folder unavailable' })
    renderBoundary({ explode: true })

    screen.getByRole('button', { name: /export diagnostics/i }).click()

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('log folder unavailable'))
  })

  it('clears the error when the reset key changes, so navigating away recovers', () => {
    const boundary = (resetKey: string, explode: boolean): ReactElement =>
      createElement(ErrorBoundary, {
        scope: resetKey,
        resetKey,
        fallback: (p) =>
          createElement(ErrorRecoveryPanel, { ...p, variant: 'view', title: 'failed', detail: 'detail' }),
        children: createElement(Boom, { explode })
      })

    const { rerender } = render(boundary('telemetry', true))
    expect(screen.getByRole('alert')).toBeTruthy()

    rerender(boundary('fuel', false))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('view content')).toBeTruthy()
  })
})
