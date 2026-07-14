// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createButtonBoxPanel, type ButtonAction } from '../../../shared/touch-panel'
import { ButtonBoxRenderer } from './ButtonBoxRenderer'

const noAction: ButtonAction = { kind: 'none' }

afterEach(cleanup)

describe('touch control accessibility', () => {
  it('exposes non-color warning and active cues in the accessibility tree', () => {
    const panel = createButtonBoxPanel({
      columns: 2,
      rows: 1,
      buttons: [
        {
          id: 'warning',
          label: 'ENGINE',
          control: { kind: 'momentary', action: noAction },
          state: { warning: true }
        },
        {
          id: 'active',
          label: 'LIMITER',
          control: { kind: 'latching-toggle', onAction: noAction, offAction: noAction },
          state: { active: true }
        }
      ]
    })
    render(createElement(ButtonBoxRenderer, { panel, onAction: vi.fn() }))
    expect(screen.getByText(/warn/i)).toBeTruthy()
    expect(screen.getByText(/active/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /engine.*warning/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /limiter.*active/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('marks expression-disabled controls natively disabled and still labels their state', () => {
    const panel = createButtonBoxPanel({
      columns: 1,
      rows: 1,
      buttons: [
        {
          id: 'pit',
          label: 'PIT REQUEST',
          stateBindings: { disabled: { source: 'expression', expressionId: 'pit-lockout' } },
          control: { kind: 'momentary', action: noAction }
        }
      ]
    })
    render(createElement(ButtonBoxRenderer, { panel, expressionValues: { 'pit-lockout': true } }))
    const hit = screen.getByRole('button', { name: /pit request.*disabled/i }) as HTMLButtonElement
    expect(hit.disabled).toBe(true)
    expect(hit.closest('[aria-disabled="true"]')).toBeTruthy()
  })

  it('defines 44px hit zones and keyboard-only focus-visible treatment', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/touchpanel/buttonbox.css'), 'utf8')
    expect(css).toMatch(/\.bb-hit\s*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px;/)
    expect(css).toContain('.bb-hit:focus-visible')
    expect(css).toContain('@media (forced-colors: active)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})